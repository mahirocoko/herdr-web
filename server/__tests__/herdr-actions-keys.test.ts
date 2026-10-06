import { describe, expect, it } from 'bun:test'
import { validateActionRequest } from '../security.ts'
import { TerminalControlLeaseManager } from '../terminal-control.ts'
import { OperationCoordinator } from '../operation-coordinator.ts'
import { CANONICAL_TERMINAL_KEYS } from '../../src/utils/terminal-keys.ts'

describe('server: actions with canonical terminal keys and lease gating', () => {
  describe('1. validateActionRequest canonical keys validation', () => {
    it('accepts every canonical terminal key', () => {
      for (const key of CANONICAL_TERMINAL_KEYS) {
        const res = validateActionRequest({
          type: 'keys',
          operationId: `op-key-${key.replace('+', '-')}`,
          target: {
            paneId: 'w1:p1',
            terminalId: 'term-1',
            expectedMode: 'shell',
          },
          keys: [key],
        })
        expect(res.valid).toBe(true)
        expect(res.data?.type).toBe('keys')
        if (res.data?.type === 'keys') {
          expect(res.data.keys).toEqual([key])
        }
      }
    })

    it('accepts a combo of newly extended safe keys', () => {
      const combo = [
        'shift+tab',
        'ctrl+d',
        'ctrl+l',
        'ctrl+z',
        'ctrl+r',
        'ctrl+a',
        'ctrl+e',
        'ctrl+w',
        'ctrl+u',
        'space',
        'backspace',
      ]
      const res = validateActionRequest({
        type: 'keys',
        operationId: 'op-combo-1',
        target: {
          paneId: 'w1:p1',
          terminalId: 'term-1',
          expectedMode: 'agent',
        },
        keys: combo,
      })
      expect(res.valid).toBe(true)
    })

    it('strictly rejects "delete" and "del" as unauthorized (upstream Herdr 0.9.3 lacks parser support)', () => {
      const deleteRes = validateActionRequest({
        type: 'keys',
        operationId: 'op-del-1',
        target: {
          paneId: 'w1:p1',
          terminalId: 'term-1',
          expectedMode: 'agent',
        },
        keys: ['delete'],
      })
      expect(deleteRes.valid).toBe(false)
      expect(deleteRes.error).toContain('Unauthorized key: "delete"')

      const delRes = validateActionRequest({
        type: 'keys',
        operationId: 'op-del-2',
        target: {
          paneId: 'w1:p1',
          terminalId: 'term-1',
          expectedMode: 'shell',
        },
        keys: ['del'],
      })
      expect(delRes.valid).toBe(false)
      expect(delRes.error).toContain('Unauthorized key: "del"')
    })

    it('rejects arbitrary or unknown key combos', () => {
      const unknownKeys = [
        'f1',
        'f12',
        'alt+f4',
        'command+c',
        'super+a',
        'ctrl+x',
        '',
      ]
      for (const k of unknownKeys) {
        const res = validateActionRequest({
          type: 'keys',
          operationId: `op-unknown-${k}`,
          target: {
            paneId: 'w1:p1',
            terminalId: 'term-1',
            expectedMode: 'agent',
          },
          keys: [k],
        })
        expect(res.valid).toBe(false)
        expect(res.error).toBeDefined()
      }
    })

    it('rejects empty keys array', () => {
      const res = validateActionRequest({
        type: 'keys',
        operationId: 'op-empty-keys',
        target: {
          paneId: 'w1:p1',
          terminalId: 'term-1',
          expectedMode: 'agent',
        },
        keys: [],
      })
      expect(res.valid).toBe(false)
      expect(res.error).toContain('non-empty array')
    })

    it('rejects keys array exceeding 16 keys limit', () => {
      const keys = Array(17).fill('enter')
      const res = validateActionRequest({
        type: 'keys',
        operationId: 'op-too-many',
        target: {
          paneId: 'w1:p1',
          terminalId: 'term-1',
          expectedMode: 'agent',
        },
        keys,
      })
      expect(res.valid).toBe(false)
      expect(res.error).toContain('maximum size of 16 keys')
    })
  })

  describe('2. Lease Gating and Operation Coordination Invariants', () => {
    it('rejects keys action when target pane is leased by Terminal Control', () => {
      const leaseManager = new TerminalControlLeaseManager()
      const coordinator = new OperationCoordinator()

      const paneId = 'w1:p1'
      // Reserve lease for pane
      const reserve = leaseManager.reserveLease(paneId)
      expect(reserve.ok).toBe(true)
      if (!reserve.ok) throw new Error('reserve failed')
      expect(leaseManager.isPaneLeased(paneId)).toBe(true)

      // When checking pane lease status before action admission
      const isLeased = leaseManager.isPaneLeased(paneId)
      expect(isLeased).toBe(true)

      // Coordinator claim check
      const claim = coordinator.claimPaneForControl(paneId, reserve.lease.id)
      expect(claim.ok).toBe(true)
      if (!claim.ok) throw new Error('claim failed')

      // Attempting to begin action on leased pane should fail or be rejected
      const actionResult = coordinator.beginAction(
        'op-keys-on-leased',
        paneId,
        'fp-keys-1',
      )
      expect(actionResult.kind).toBe('contention')

      // Release lease
      coordinator.releaseControlPane(claim.token)
      leaseManager.releaseLease(reserve.lease.id, 'test_done')
      expect(leaseManager.isPaneLeased(paneId)).toBe(false)

      // After release, action is admitted
      const admitted = coordinator.beginAction(
        'op-keys-after-release',
        paneId,
        'fp-keys-2',
      )
      expect(admitted.kind).toBe('admitted')
      if (admitted.kind === 'admitted') {
        coordinator.abandonAction(admitted.token)
      }
    })

    it('replays identical operationId for keys actions and rejects conflicting payloads', () => {
      const coordinator = new OperationCoordinator()
      const paneId = 'w1:p2'
      const opId = 'op-keys-idempotent'
      const fp1 = 'fingerprint-keys-ctrl-c'

      // First call: admitted
      const first = coordinator.beginAction(opId, paneId, fp1)
      expect(first.kind).toBe('admitted')

      // Simulate action completion and caching
      if (first.kind === 'admitted') {
        coordinator.completeAction(first.token, 200, { ok: true, type: 'keys' })
      }

      // Second call with same payload: replayed
      const second = coordinator.beginAction(opId, paneId, fp1)
      expect(second.kind).toBe('replay')
      if (second.kind === 'replay') {
        expect(second.body).toEqual({ ok: true, type: 'keys' })
      }

      // Third call with conflicting payload for same operationId: conflict
      const fp2 = 'fingerprint-keys-ctrl-l'
      const third = coordinator.beginAction(opId, paneId, fp2)
      expect(third.kind).toBe('conflict')
    })
  })
})
