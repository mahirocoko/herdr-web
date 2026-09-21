import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  validateOwnerAuth,
  validateActionRequest,
  verifyTargetAgainstSnapshot,
  isAgentPane
} from '../security.ts'
import {
  OperationCoordinator,
  computePayloadFingerprint,
  getSharedOperationCoordinator
} from '../operation-coordinator.ts'
import {
  resolveNearestRepoCatalog
} from '../catalog.ts'
import {
  DORMANT_AGENT_PRESETS,
  getAgentPreset,
  validateAgentPresetExecution
} from '../agent-presets.ts'
import {
  executeTabCreate
} from '../herdr-adapter.ts'
import {
  TerminalControlLeaseManager,
  getSharedTerminalControlLeaseManager
} from '../terminal-control.ts'
import { createServer } from '../index.ts'
import type {
  ISnapshotResult,
  IActionRequest,
  INativeInteractionEnvelope,
  INativeChoiceResponse,
  IPane
} from '../types.ts'

describe('Core Pack Backend Foundation', () => {
  describe('1. Shared Mutation Owner Auth', () => {
    it('allows loopback dev requests when host and origin are approved loopback', () => {
      const req = new Request('http://127.0.0.1:8787/api/action', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:8787',
          origin: 'http://127.0.0.1:8787'
        }
      })
      const res = validateOwnerAuth(req, '127.0.0.1:8787', 'http://127.0.0.1:8787', undefined)
      expect(res.allowed).toBe(true)
      expect(res.status).toBe(200)
    })

    it('fails closed with 500 when owner login is not set on Tailnet request', () => {
      const req = new Request('https://my-node.ts.net/api/action', {
        method: 'POST',
        headers: {
          host: 'my-node.ts.net:8787',
          origin: 'https://my-node.ts.net:8787',
          'tailscale-user-login': 'owner@example.com'
        }
      })
      const res = validateOwnerAuth(req, 'my-node.ts.net:8787', 'https://my-node.ts.net:8787', undefined)
      expect(res.allowed).toBe(false)
      expect(res.status).toBe(500)
      expect(res.error).toContain('Server misconfigured: owner login not set')
    })

    it('fails closed with 403 when Tailnet user login mismatches configured ownerLogin', () => {
      const req = new Request('https://my-node.ts.net/api/action', {
        method: 'POST',
        headers: {
          host: 'my-node.ts.net:8787',
          origin: 'https://my-node.ts.net:8787',
          'tailscale-user-login': 'unauthorized@example.com'
        }
      })
      const res = validateOwnerAuth(req, 'my-node.ts.net:8787', 'https://my-node.ts.net:8787', 'owner@example.com')
      expect(res.allowed).toBe(false)
      expect(res.status).toBe(403)
      expect(res.error).toContain('Tailnet user not authorized')
    })

    it('allows Tailnet request when Tailscale-User-Login matches configured ownerLogin', () => {
      const req = new Request('https://my-node.ts.net/api/action', {
        method: 'POST',
        headers: {
          host: 'my-node.ts.net:8787',
          origin: 'https://my-node.ts.net:8787',
          'tailscale-user-login': 'owner@example.com'
        }
      })
      const res = validateOwnerAuth(req, 'my-node.ts.net:8787', 'https://my-node.ts.net:8787', 'owner@example.com')
      expect(res.allowed).toBe(true)
      expect(res.status).toBe(200)
    })

    it('rejects unauthorized external origin with 403', () => {
      const req = new Request('http://127.0.0.1:8787/api/action', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:8787',
          origin: 'http://malicious.evil'
        }
      })
      const res = validateOwnerAuth(req, '127.0.0.1:8787', 'http://malicious.evil', 'owner@example.com')
      expect(res.allowed).toBe(false)
      expect(res.status).toBe(403)
      expect(res.error).toContain('origin not authorized')
    })
  })

  describe('2. Exact Target Replacement / Status / Session Verification', () => {
    const baseSnapshot: ISnapshotResult = {
      protocol: 22,
      version: '0.9.1',
      workspaces: [{ workspace_id: 'ws-1', label: 'Main', number: 1, agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
      tabs: [{ tab_id: 'tab-1', workspace_id: 'ws-1', label: 'T1', number: 1, pane_count: 1, focused: true, agent_status: 'idle' }],
      panes: [
        {
          pane_id: 'ws-1:p-shell',
          workspace_id: 'ws-1',
          tab_id: 'tab-1',
          terminal_id: 'term-shell-1',
          agent_status: 'idle',
          cwd: '/workspace/project',
          focused: true
        },
        {
          pane_id: 'ws-1:p-agent',
          workspace_id: 'ws-1',
          tab_id: 'tab-1',
          terminal_id: 'term-agent-1',
          agent: 'gemini',
          agent_session: { source: 'local', agent: 'gemini', kind: 'id', value: 'sess-abc' },
          agent_status: 'working',
          cwd: '/workspace/project',
          focused: false
        },
        {
          pane_id: 'ws-1:p-agent-nosess',
          workspace_id: 'ws-1',
          tab_id: 'tab-1',
          terminal_id: 'term-agent-2',
          agent: 'gemini',
          agent_status: 'working',
          cwd: '/workspace/project',
          focused: false
        },
        {
          pane_id: 'ws-1:p-blocked',
          workspace_id: 'ws-1',
          tab_id: 'tab-1',
          terminal_id: 'term-blocked-1',
          agent: 'gemini',
          agent_session: { source: 'local', agent: 'gemini', kind: 'id', value: 'sess-xyz' },
          agent_status: 'blocked',
          cwd: '/workspace/project',
          focused: false
        }
      ],
      agents: [
        { target: 'ws-1:p-agent', agent: 'gemini', agent_session: { value: 'sess-abc' } }
      ]
    }

    it('rejects target when pane does not exist in snapshot (404)', () => {
      const res = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-missing',
        terminalId: 'term-any',
        expectedMode: 'shell'
      })
      expect(res.ok).toBe(false)
      expect(res.status).toBe(404)
      expect(res.error).toContain('not found')
    })

    it('rejects target when terminal ID has been replaced (409)', () => {
      const res = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-shell',
        terminalId: 'term-old-replaced',
        expectedMode: 'shell'
      })
      expect(res.ok).toBe(false)
      expect(res.status).toBe(409)
      expect(res.error).toContain('Terminal replacement detected')
    })

    it('rejects target when expectedMode mismatches actual pane occupant mode (409)', () => {
      // Expected shell, but actual is agent
      const res1 = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-agent',
        terminalId: 'term-agent-1',
        expectedMode: 'shell'
      })
      expect(res1.ok).toBe(false)
      expect(res1.status).toBe(409)
      expect(res1.error).toContain('Expected mode mismatch')

      // Expected agent, but actual is shell
      const res2 = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-shell',
        terminalId: 'term-shell-1',
        expectedMode: 'agent'
      })
      expect(res2.ok).toBe(false)
      expect(res2.status).toBe(409)
      expect(res2.error).toContain('Expected mode mismatch')

      // Expected blocked-agent, but actual is normal agent
      const res3 = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-agent',
        terminalId: 'term-agent-1',
        expectedMode: 'blocked-agent',
        agentSessionId: 'sess-abc'
      })
      expect(res3.ok).toBe(false)
      expect(res3.status).toBe(409)
    })

    it('requires agentSessionId and rejects omission (409) when authoritative pane has session', () => {
      const res = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-agent',
        terminalId: 'term-agent-1',
        expectedMode: 'agent'
        // omitted agentSessionId
      })
      expect(res.ok).toBe(false)
      expect(res.status).toBe(409)
      expect(res.error).toContain('Missing required agentSessionId')
    })

    it('rejects target when agentSessionId has been replaced (409)', () => {
      const res = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-agent',
        terminalId: 'term-agent-1',
        expectedMode: 'agent',
        agentSessionId: 'sess-stale-previous'
      })
      expect(res.ok).toBe(false)
      expect(res.status).toBe(409)
      expect(res.error).toContain('Agent session replacement detected')
    })

    it('allows omission of agentSessionId when pane has no authoritative session', () => {
      const res = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-agent-nosess',
        terminalId: 'term-agent-2',
        expectedMode: 'agent'
      })
      expect(res.ok).toBe(true)
    })

    it('rejects agentSessionId when pane has no active session (409)', () => {
      const res = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-agent-nosess',
        terminalId: 'term-agent-2',
        expectedMode: 'agent',
        agentSessionId: 'unexpected-session'
      })
      expect(res.ok).toBe(false)
      expect(res.status).toBe(409)
      expect(res.error).toContain('Agent session mismatch')
    })

    it('rejects agentSessionId on shell pane (409)', () => {
      const res = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-shell',
        terminalId: 'term-shell-1',
        expectedMode: 'shell',
        agentSessionId: 'any-session'
      })
      expect(res.ok).toBe(false)
      expect(res.status).toBe(409)
      expect(res.error).toContain('Agent session mismatch')
    })

    it('accepts target when terminal, mode, and session ID match fresh snapshot', () => {
      const res = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-agent',
        terminalId: 'term-agent-1',
        expectedMode: 'agent',
        agentSessionId: 'sess-abc'
      })
      expect(res.ok).toBe(true)
      expect(res.pane?.pane_id).toBe('ws-1:p-agent')
      expect(res.derivedCwd).toBe('/workspace/project')
    })

    it('fails closed on action type/mode mismatch before dispatch', () => {
      // prompt only expectedMode agent:
      const resPromptShell = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-shell',
        terminalId: 'term-shell-1',
        expectedMode: 'shell'
      }, { actionType: 'prompt' })
      expect(resPromptShell.ok).toBe(false)
      expect(resPromptShell.status).toBe(409)
      expect(resPromptShell.error).toContain('Action type "prompt" requires expectedMode "agent"')

      const resPromptBlocked = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-blocked',
        terminalId: 'term-blocked-1',
        expectedMode: 'blocked-agent',
        agentSessionId: 'sess-xyz'
      }, { actionType: 'prompt' })
      expect(resPromptBlocked.ok).toBe(false)
      expect(resPromptBlocked.status).toBe(409)
      expect(resPromptBlocked.error).toContain('Action type "prompt" requires expectedMode "agent"')

      const resPromptAgent = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-agent',
        terminalId: 'term-agent-1',
        expectedMode: 'agent',
        agentSessionId: 'sess-abc'
      }, { actionType: 'prompt' })
      expect(resPromptAgent.ok).toBe(true)

      // terminal-input only expectedMode blocked-agent or shell:
      const resInputAgent = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-agent',
        terminalId: 'term-agent-1',
        expectedMode: 'agent',
        agentSessionId: 'sess-abc'
      }, { actionType: 'terminal-input' })
      expect(resInputAgent.ok).toBe(false)
      expect(resInputAgent.status).toBe(409)
      expect(resInputAgent.error).toContain('Action type "terminal-input" requires expectedMode "blocked-agent" or "shell"')

      const resInputBlocked = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-blocked',
        terminalId: 'term-blocked-1',
        expectedMode: 'blocked-agent',
        agentSessionId: 'sess-xyz'
      }, { actionType: 'terminal-input' })
      expect(resInputBlocked.ok).toBe(true)

      const resInputShell = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-shell',
        terminalId: 'term-shell-1',
        expectedMode: 'shell'
      }, { actionType: 'terminal-input' })
      expect(resInputShell.ok).toBe(true)

      // keys allowed for all three modes:
      const resKeysAgent = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-agent',
        terminalId: 'term-agent-1',
        expectedMode: 'agent',
        agentSessionId: 'sess-abc'
      }, { actionType: 'keys' })
      expect(resKeysAgent.ok).toBe(true)

      const resKeysBlocked = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-blocked',
        terminalId: 'term-blocked-1',
        expectedMode: 'blocked-agent',
        agentSessionId: 'sess-xyz'
      }, { actionType: 'keys' })
      expect(resKeysBlocked.ok).toBe(true)

      const resKeysShell = verifyTargetAgainstSnapshot(baseSnapshot, {
        paneId: 'ws-1:p-shell',
        terminalId: 'term-shell-1',
        expectedMode: 'shell'
      }, { actionType: 'keys' })
      expect(resKeysShell.ok).toBe(true)
    })

    it('canonical isAgentPane treats literal "shell" as shell, but session/agents overrides it', () => {
      // 1. Literal "shell" in agent or display_agent without session or snapshot agents => false (shell pane)
      const shellPaneLiteral: IPane = {
        pane_id: 'ws-1:p-shell-lit',
        workspace_id: 'ws-1',
        tab_id: 'tab-1',
        terminal_id: 'term-lit',
        agent: 'shell',
        display_agent: 'SHELL',
        agent_status: 'idle',
        cwd: '/workspace',
        focused: false
      }
      expect(isAgentPane(shellPaneLiteral)).toBe(false)
      const v1 = verifyTargetAgainstSnapshot({ ...baseSnapshot, panes: [shellPaneLiteral] }, {
        paneId: shellPaneLiteral.pane_id,
        terminalId: shellPaneLiteral.terminal_id!,
        expectedMode: 'shell'
      })
      expect(v1.ok).toBe(true)

      // 2. Literal "shell" in agent BUT with agent_session => true (agent pane)
      const shellWithSession: IPane = {
        ...shellPaneLiteral,
        agent_session: { source: 'local', agent: 'custom', kind: 'id', value: 'sess-1' }
      }
      expect(isAgentPane(shellWithSession)).toBe(true)
      const v2 = verifyTargetAgainstSnapshot({ ...baseSnapshot, panes: [shellWithSession] }, {
        paneId: shellWithSession.pane_id,
        terminalId: shellWithSession.terminal_id!,
        expectedMode: 'shell'
      })
      expect(v2.ok).toBe(false)
      expect(v2.status).toBe(409)

      // 3. Literal "shell" in agent BUT matching entry in snapshot.agents => true (agent pane)
      const shellWithSnapshotAgent: IPane = {
        pane_id: 'ws-1:p-shell-snap',
        workspace_id: 'ws-1',
        tab_id: 'tab-1',
        terminal_id: 'term-snap',
        agent: 'shell',
        agent_status: 'idle',
        cwd: '/workspace',
        focused: false
      }
      const snapshotAgents = [
        { target: 'ws-1:p-shell-snap', agent: 'my-agent' }
      ]
      expect(isAgentPane(shellWithSnapshotAgent, snapshotAgents)).toBe(true)

      // 4. Recognized agent name (e.g. 'gemini') => true
      const normalAgentPane: IPane = {
        pane_id: 'ws-1:p-gemini',
        workspace_id: 'ws-1',
        tab_id: 'tab-1',
        terminal_id: 'term-gemini',
        agent: 'gemini',
        agent_status: 'idle',
        cwd: '/workspace',
        focused: false
      }
      expect(isAgentPane(normalAgentPane)).toBe(true)

      // 5. No agent fields => false
      const plainPane: IPane = {
        pane_id: 'ws-1:p-plain',
        workspace_id: 'ws-1',
        tab_id: 'tab-1',
        terminal_id: 'term-plain',
        agent_status: 'idle',
        cwd: '/workspace',
        focused: false
      }
      expect(isAgentPane(plainPane)).toBe(false)
    })
  })

  describe('3. Token Pattern and Safe ID Bounds', () => {
    it('accepts valid UUID operationId (such as crypto.randomUUID)', () => {
      const res = validateActionRequest({
        type: 'terminal-input',
        operationId: '018f2d53-7b3e-7a1a-8c9d-4e5f6a7b8c9d',
        target: {
          paneId: 'ws:p1',
          terminalId: 'term-1',
          expectedMode: 'shell'
        },
        text: 'ls'
      })
      expect(res.valid).toBe(true)
    })

    it('rejects operationId with control characters or unsafe bytes', () => {
      const res1 = validateActionRequest({
        type: 'prompt',
        operationId: 'op\x00evil',
        target: { paneId: 'ws:p1', terminalId: 'term-1', expectedMode: 'agent' },
        text: 'hello'
      })
      expect(res1.valid).toBe(false)
      expect(res1.error).toContain('Invalid "operationId"')

      const res2 = validateActionRequest({
        type: 'prompt',
        operationId: 'op evil with spaces',
        target: { paneId: 'ws:p1', terminalId: 'term-1', expectedMode: 'agent' },
        text: 'hello'
      })
      expect(res2.valid).toBe(false)
    })

    it('validates action type and expectedMode compatibility', () => {
      const res1 = validateActionRequest({
        type: 'prompt',
        operationId: 'op-valid-1',
        target: { paneId: 'ws:p1', terminalId: 'term-1', expectedMode: 'shell' },
        text: 'hello'
      })
      expect(res1.valid).toBe(false)
      expect(res1.error).toContain('Action type "prompt" requires target expectedMode "agent"')

      const res2 = validateActionRequest({
        type: 'prompt',
        operationId: 'op-valid-2',
        target: { paneId: 'ws:p1', terminalId: 'term-1', expectedMode: 'blocked-agent' },
        text: 'hello'
      })
      expect(res2.valid).toBe(false)
      expect(res2.error).toContain('Action type "prompt" requires target expectedMode "agent"')

      const res3 = validateActionRequest({
        type: 'terminal-input',
        operationId: 'op-valid-3',
        target: { paneId: 'ws:p1', terminalId: 'term-1', expectedMode: 'agent' },
        text: 'ls'
      })
      expect(res3.valid).toBe(false)
      expect(res3.error).toContain('Action type "terminal-input" requires target expectedMode "blocked-agent" or "shell"')

      const res4 = validateActionRequest({
        type: 'keys',
        operationId: 'op-valid-4',
        target: { paneId: 'ws:p1', terminalId: 'term-1', expectedMode: 'agent' },
        keys: ['ctrl+c']
      })
      expect(res4.valid).toBe(true)
    })

    it('rejects terminalId with unsafe characters', () => {
      const res = validateActionRequest({
        type: 'terminal-input',
        operationId: 'op-1',
        target: {
          paneId: 'ws:p1',
          terminalId: 'term/unsafe/path',
          expectedMode: 'shell'
        },
        text: 'pwd'
      })
      expect(res.valid).toBe(false)
      expect(res.error).toContain('Invalid target "terminalId"')
    })

    it('rejects tab-create label with control characters', () => {
      const res = validateActionRequest({
        type: 'tab-create',
        operationId: 'op-tab-1',
        workspaceId: 'ws-1',
        target: { paneId: 'ws:p1', terminalId: 'term-1' },
        label: 'bad\x1b[31mlabel'
      })
      expect(res.valid).toBe(false)
      expect(res.error).toContain('control characters')
    })
  })

  describe('4. Terminal Control Lease Conflicts', () => {
    it('reports pane is leased when lease is pending, active, or releasing', async () => {
      const leaseManager = new TerminalControlLeaseManager()
      expect(leaseManager.isPaneLeased('ws1:p1')).toBe(false)

      const reserve = leaseManager.reserveLease('ws1:p1')
      expect(reserve.ok).toBe(true)
      if (!reserve.ok) return

      // Pending
      expect(leaseManager.isPaneLeased('ws1:p1')).toBe(true)
      expect(leaseManager.isPaneLeased('ws1:p2')).toBe(false) // unrelated pane independent

      // Active
      leaseManager.activateLease(reserve.lease.id, undefined as any, undefined as any)
      expect(leaseManager.isPaneLeased('ws1:p1')).toBe(true)

      // Releasing
      const releasePromise = leaseManager.releaseLease(reserve.lease.id, 'test_release')
      expect(reserve.lease.status === 'releasing' || reserve.lease.status === 'released').toBe(true)
      await releasePromise
      expect(leaseManager.isPaneLeased('ws1:p1')).toBe(false)
    })
  })

  describe('5. Concurrency, Idempotency & Outcome Caching', () => {
    let coordinator: OperationCoordinator

    beforeEach(() => {
      coordinator = new OperationCoordinator({ ttlMs: 1000, maxEntries: 10 })
    })

    it('in-flight duplicate returns 409 immediately without awaiting', () => {
      const paneId = 'ws:p1'
      const opId = 'op-100'

      const adm1 = coordinator.beginAction(opId, paneId, 'fp-1')
      expect(adm1.kind).toBe('admitted')

      // Second check with same opId returns in_flight immediately
      const check = coordinator.beginAction(opId, paneId, 'fp-1')
      expect(check.kind).toBe('in_flight')
      if (check.kind === 'in_flight') {
        expect(check.status).toBe(409)
        expect(check.error).toContain('already in-flight')
      }
    })

    it('serializes mutations on the same target while permitting different targets concurrently', () => {
      const paneA = 'ws:p1'
      const paneB = 'ws:p2'

      const adm1 = coordinator.beginAction('op-1', paneA, 'fp-1')
      expect(adm1.kind).toBe('admitted')
      if (adm1.kind !== 'admitted') return

      const adm2 = coordinator.beginAction('op-2', paneA, 'fp-2')
      expect(adm2.kind).toBe('contention') // target A locked

      const adm3 = coordinator.beginAction('op-3', paneB, 'fp-3')
      expect(adm3.kind).toBe('admitted') // target B independent
      if (adm3.kind !== 'admitted') return

      coordinator.abandonAction(adm1.token)
      const adm2Retry = coordinator.beginAction('op-2', paneA, 'fp-2')
      expect(adm2Retry.kind).toBe('admitted') // now unlocked
    })

    it('replays cached terminal response for duplicate operation ID within TTL', () => {
      const paneId = 'ws:p1'
      const opId = 'op-replay-1'
      const action: IActionRequest = {
        type: 'terminal-input',
        operationId: opId,
        target: { paneId: 'ws:p1', terminalId: 'term-200', expectedMode: 'shell' },
        text: 'echo 42'
      }
      const fingerprint = computePayloadFingerprint(action)
      const cachedResult = { ok: true, outcome: 'acknowledged', result: { output: '42\n' } }

      const adm = coordinator.beginAction(opId, paneId, fingerprint)
      expect(adm.kind).toBe('admitted')
      if (adm.kind === 'admitted') {
        coordinator.completeAction(adm.token, 200, cachedResult)
      }

      const check = coordinator.beginAction(opId, paneId, fingerprint)
      expect(check.kind).toBe('replay')
      if (check.kind === 'replay') {
        expect(check.status).toBe(200)
        expect(check.body).toEqual(cachedResult)
      }
    })

    it('tab-create 504 unknown exact replay returns cached 504 unknown and does not invoke tab.create again', () => {
      const paneId = 'ws:p1'
      const opId = 'op-tab-504'
      const action: IActionRequest = {
        type: 'tab-create',
        operationId: opId,
        workspaceId: 'ws-1',
        target: { paneId: 'ws:p1', terminalId: 'term-tab' },
        label: 'My Tab'
      }
      const fingerprint = computePayloadFingerprint(action)
      const unknownResult = {
        ok: false,
        status: 504,
        outcome: 'unknown',
        error: 'Tab creation outcome unknown: operation may have timed out or resulted in ambiguous state'
      }

      const adm = coordinator.beginAction(opId, paneId, fingerprint)
      expect(adm.kind).toBe('admitted')
      if (adm.kind === 'admitted') {
        coordinator.completeAction(adm.token, 504, unknownResult)
      }

      // Exact replay check
      const check = coordinator.beginAction(opId, paneId, fingerprint)
      expect(check.kind).toBe('replay')
      if (check.kind === 'replay') {
        expect(check.status).toBe(504)
        expect(check.body.outcome).toBe('unknown')
        expect(check.body.ok).toBe(false)
      }
    })

    it('input transport timeout returns and caches outcome unknown; exact replay returns cached response', () => {
      const paneId = 'ws:p1'
      const opId = 'op-input-timeout'
      const action: IActionRequest = {
        type: 'terminal-input',
        operationId: opId,
        target: { paneId: 'ws:p1', terminalId: 'term-timeout', expectedMode: 'shell' },
        text: 'long running command'
      }
      const fingerprint = computePayloadFingerprint(action)
      const timeoutResult = {
        ok: false,
        outcome: 'unknown',
        error: 'Socket timeout while calling pane.send_input'
      }

      const adm = coordinator.beginAction(opId, paneId, fingerprint)
      expect(adm.kind).toBe('admitted')
      if (adm.kind === 'admitted') {
        coordinator.completeAction(adm.token, 504, timeoutResult)
      }

      const check = coordinator.beginAction(opId, paneId, fingerprint)
      expect(check.kind).toBe('replay')
      if (check.kind === 'replay') {
        expect(check.status).toBe(504)
        expect(check.body.outcome).toBe('unknown')
        expect(check.body.ok).toBe(false)
      }
    })

    it('rejects operationId reuse with differing payload as 409 conflict', () => {
      const paneId = 'ws:p1'
      const opId = 'op-conflict-1'
      const actionOriginal: IActionRequest = {
        type: 'prompt',
        operationId: opId,
        target: { paneId: 'ws:p1', terminalId: 'term-301', expectedMode: 'agent' },
        text: 'hello'
      }
      const actionConflicting: IActionRequest = {
        type: 'prompt',
        operationId: opId,
        target: { paneId: 'ws:p1', terminalId: 'term-301', expectedMode: 'agent' },
        text: 'different prompt'
      }

      const adm = coordinator.beginAction(opId, paneId, computePayloadFingerprint(actionOriginal))
      expect(adm.kind).toBe('admitted')
      if (adm.kind === 'admitted') {
        coordinator.completeAction(adm.token, 200, { ok: true })
      }

      const check = coordinator.beginAction(opId, paneId, computePayloadFingerprint(actionConflicting))
      expect(check.kind).toBe('conflict')
      if (check.kind === 'conflict') {
        expect(check.status).toBe(409)
        expect(check.error).toContain('Operation ID reuse conflict')
      }
    })

    it('rejects active in-flight same-operation with conflicting fingerprint as 409 conflict', () => {
      const paneId = 'ws:p1'
      const opId = 'op-active-conflict'
      const adm1 = coordinator.beginAction(opId, paneId, 'fp-original')
      expect(adm1.kind).toBe('admitted')

      const adm2 = coordinator.beginAction(opId, paneId, 'fp-conflicting')
      expect(adm2.kind).toBe('conflict')
      if (adm2.kind === 'conflict') {
        expect(adm2.status).toBe(409)
        expect(adm2.error).toContain('is currently in-flight with a different payload')
      }
    })

    it('returns contention 409 when different terminal IDs target the same physical pane', () => {
      const paneId = 'ws:p1'
      const adm1 = coordinator.beginAction('op-pane-t1', paneId, 'fp-term1')
      expect(adm1.kind).toBe('admitted')

      const adm2 = coordinator.beginAction('op-pane-t2', paneId, 'fp-term2')
      expect(adm2.kind).toBe('contention')
      if (adm2.kind === 'contention') {
        expect(adm2.status).toBe(409)
        expect(adm2.error).toContain('already in-flight for terminal target')
      }
    })

    it('permits concurrent actions on different physical panes', () => {
      const adm1 = coordinator.beginAction('op-diff-1', 'pane-A', 'fp-1')
      const adm2 = coordinator.beginAction('op-diff-2', 'pane-B', 'fp-2')
      expect(adm1.kind).toBe('admitted')
      expect(adm2.kind).toBe('admitted')
    })

    it('prevents stale token from completing, abandoning, or releasing newer attempt and claim', () => {
      // 1. Action attempt token fencing
      const adm1 = coordinator.beginAction('op-stale-1', 'pane-1', 'fp-1')
      expect(adm1.kind).toBe('admitted')
      if (adm1.kind !== 'admitted') return
      const token1 = adm1.token

      // Op 1 abandons
      expect(coordinator.abandonAction(token1)).toBe(true)

      // Op 2 starts on same pane with new token
      const adm2 = coordinator.beginAction('op-newer-2', 'pane-1', 'fp-2')
      expect(adm2.kind).toBe('admitted')
      if (adm2.kind !== 'admitted') return
      const token2 = adm2.token

      // Stale token1 attempts to complete or abandon -> both return false!
      expect(coordinator.completeAction(token1, 200, { ok: true })).toBe(false)
      expect(coordinator.abandonAction(token1)).toBe(false)

      // Newer attempt is still active and claim is still held
      expect(coordinator.isPaneClaimed('pane-1')).toBe(true)

      // Newer token2 completes successfully
      expect(coordinator.completeAction(token2, 200, { ok: true })).toBe(true)
      expect(coordinator.isPaneClaimed('pane-1')).toBe(false)

      // 2. Terminal Control pane claim token fencing
      const c1 = coordinator.claimPaneForControl('pane-ctrl-1', 'lease-1')
      expect(c1.ok).toBe(true)
      if (!c1.ok) return
      const cToken1 = c1.token

      expect(coordinator.releaseControlPane(cToken1)).toBe(true)

      const c2 = coordinator.claimPaneForControl('pane-ctrl-1', 'lease-2')
      expect(c2.ok).toBe(true)
      if (!c2.ok) return
      const cToken2 = c2.token

      // Stale control token cannot release newer control claim
      expect(coordinator.releaseControlPane(cToken1)).toBe(false)
      expect(coordinator.isPaneClaimed('pane-ctrl-1')).toBe(true)

      // Valid newer control token releases claim
      expect(coordinator.releaseControlPane(cToken2)).toBe(true)
      expect(coordinator.isPaneClaimed('pane-ctrl-1')).toBe(false)
    })

    it('maintains genuine LRU order: replay access touches entry and prevents eviction', () => {
      const lruCoordinator = new OperationCoordinator({ maxEntries: 3 })
      const paneId = 'ws:p1'
      const makeAction = (id: string): IActionRequest => ({
        type: 'terminal-input',
        operationId: id,
        target: { paneId: 'ws:p1', terminalId: 'term-1', expectedMode: 'shell' },
        text: 'echo ' + id
      })

      const op1 = makeAction('op-lru-1')
      const op2 = makeAction('op-lru-2')
      const op3 = makeAction('op-lru-3')
      const op4 = makeAction('op-lru-4')

      const fp1 = computePayloadFingerprint(op1)
      const fp2 = computePayloadFingerprint(op2)
      const fp3 = computePayloadFingerprint(op3)
      const fp4 = computePayloadFingerprint(op4)

      // 1. Fill cache to capacity (3 items) using beginAction -> completeAction
      const a1 = lruCoordinator.beginAction(op1.operationId, paneId, fp1)
      expect(a1.kind).toBe('admitted')
      if (a1.kind === 'admitted') lruCoordinator.completeAction(a1.token, 200, { ok: true, id: 1 })

      const a2 = lruCoordinator.beginAction(op2.operationId, paneId, fp2)
      expect(a2.kind).toBe('admitted')
      if (a2.kind === 'admitted') lruCoordinator.completeAction(a2.token, 200, { ok: true, id: 2 })

      const a3 = lruCoordinator.beginAction(op3.operationId, paneId, fp3)
      expect(a3.kind).toBe('admitted')
      if (a3.kind === 'admitted') lruCoordinator.completeAction(a3.token, 200, { ok: true, id: 3 })

      // At this point, LRU order is: op1 (oldest), op2, op3 (newest)
      // 2. Touch op1 via beginAction (replay hit)
      const touchCheck = lruCoordinator.beginAction(op1.operationId, paneId, fp1)
      expect(touchCheck.kind).toBe('replay')

      // Now LRU order must be: op2 (oldest), op3, op1 (most recently accessed)
      // 3. Insert op4
      const a4 = lruCoordinator.beginAction(op4.operationId, paneId, fp4)
      expect(a4.kind).toBe('admitted')
      if (a4.kind === 'admitted') lruCoordinator.completeAction(a4.token, 200, { ok: true, id: 4 })

      // 4. op2 should have been evicted, while op1, op3, op4 remain in cache
      const checkOp2 = lruCoordinator.beginAction(op2.operationId, paneId, fp2)
      expect(checkOp2.kind).toBe('admitted') // evicted from cache, so admitted fresh!
      if (checkOp2.kind === 'admitted') lruCoordinator.abandonAction(checkOp2.token)

      const checkOp1 = lruCoordinator.beginAction(op1.operationId, paneId, fp1)
      expect(checkOp1.kind).toBe('replay') // preserved because touched!

      const checkOp3 = lruCoordinator.beginAction(op3.operationId, paneId, fp3)
      expect(checkOp3.kind).toBe('replay')

      const checkOp4 = lruCoordinator.beginAction(op4.operationId, paneId, fp4)
      expect(checkOp4.kind).toBe('replay')
    })
  })

  describe('6. Tab Creation (tab.create) Guarantees & Explicit Outcomes', () => {
    it('refuses tab creation in CLI transport mode with 409 and outcome: rejected', async () => {
      const original = process.env.HERDR_TRANSPORT
      process.env.HERDR_TRANSPORT = 'cli'
      try {
        const res = await executeTabCreate('ws-1', { paneId: 'ws-1:p1', terminalId: 'term-1' })
        expect(res.ok).toBe(false)
        expect(res.status).toBe(409)
        expect(res.outcome).toBe('rejected')
        expect(res.error).toContain('CLI transport mode')
      } finally {
        if (original !== undefined) process.env.HERDR_TRANSPORT = original
        else delete process.env.HERDR_TRANSPORT
      }
    })

    it('returns outcome: observed on successfully verified tab creation', async () => {
      const fakePreSnapshot: ISnapshotResult = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-main', label: 'Main', number: 1, agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't-1', workspace_id: 'ws-main', label: 'T1', number: 1, pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: [{
          pane_id: 'ws-main:p1',
          workspace_id: 'ws-main',
          tab_id: 't-1',
          terminal_id: 'term-src-1',
          cwd: '/home/user/base',
          foreground_cwd: '/home/user/base/subdir',
          focused: true,
          agent_status: 'idle'
        }]
      }

      const fakePostSnapshot: ISnapshotResult = {
        ...fakePreSnapshot,
        tabs: [
          ...fakePreSnapshot.tabs,
          { tab_id: 't-2-new', workspace_id: 'ws-main', label: 'Shell', number: 2, pane_count: 1, focused: false, agent_status: 'idle' }
        ],
        panes: [
          ...fakePreSnapshot.panes,
          {
            pane_id: 'ws-main:p2-root',
            workspace_id: 'ws-main',
            tab_id: 't-2-new',
            terminal_id: 'term-new-root',
            cwd: '/home/user/base/subdir',
            focused: false,
            agent_status: 'idle'
          }
        ]
      }

      let fetchCount = 0
      const mockFetchSnapshot = async (): Promise<ISnapshotResult> => {
        fetchCount++
        return fetchCount === 1 ? fakePreSnapshot : fakePostSnapshot
      }

      const mockSendSocket = async <T>(): Promise<T> => {
        return {
          ok: true,
          type: 'tab_created',
          tab: {
            tab_id: 't-2-new',
            workspace_id: 'ws-main'
          },
          root_pane: 'ws-main:p2-root'
        } as any
      }

      const res = await executeTabCreate(
        'ws-main',
        { paneId: 'ws-main:p1', terminalId: 'term-src-1' },
        'Custom Tab',
        {
          deps: {
            fetchSnapshot: mockFetchSnapshot,
            sendSocketRequest: mockSendSocket
          }
        }
      )

      expect(res.ok).toBe(true)
      expect(res.outcome).toBe('observed')
      expect(res.result).toEqual({
        tabId: 't-2-new',
        paneId: 'ws-main:p2-root'
      })
    })

    it('response X with unrelated Y => returns outcome: unknown', async () => {
      const fakePreSnapshot: ISnapshotResult = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-main', label: 'Main', number: 1, agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't-1', workspace_id: 'ws-main', label: 'T1', number: 1, pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: [{
          pane_id: 'ws-main:p1',
          workspace_id: 'ws-main',
          tab_id: 't-1',
          terminal_id: 'term-src-1',
          cwd: '/home/user/base',
          focused: true,
          agent_status: 'idle'
        }]
      }

      // Snapshot only contains unrelated tab Y
      const fakePostSnapshot: ISnapshotResult = {
        ...fakePreSnapshot,
        tabs: [
          ...fakePreSnapshot.tabs,
          { tab_id: 't-unrelated-Y', workspace_id: 'ws-main', label: 'Y', number: 2, pane_count: 1, focused: false, agent_status: 'idle' }
        ],
        panes: [
          ...fakePreSnapshot.panes,
          {
            pane_id: 'ws-main:p-Y',
            workspace_id: 'ws-main',
            tab_id: 't-unrelated-Y',
            terminal_id: 'term-Y',
            cwd: '/home/user/base',
            focused: false,
            agent_status: 'idle'
          }
        ]
      }

      let fetchCount = 0
      const mockFetchSnapshot = async () => {
        fetchCount++
        return fetchCount === 1 ? fakePreSnapshot : fakePostSnapshot
      }

      // Daemon responds with tab X
      const mockSendSocket = async <T>(): Promise<T> => {
        return {
          ok: true,
          type: 'tab_created',
          tab: { tab_id: 't-returned-X', workspace_id: 'ws-main' },
          root_pane: 'ws-main:p-X'
        } as any
      }

      const res = await executeTabCreate(
        'ws-main',
        { paneId: 'ws-main:p1', terminalId: 'term-src-1' },
        undefined,
        {
          deps: {
            fetchSnapshot: mockFetchSnapshot,
            sendSocketRequest: mockSendSocket
          }
        }
      )

      expect(res.ok).toBe(false)
      expect(res.status).toBe(504)
      expect(res.outcome).toBe('unknown')
      expect(res.error).toContain('not found in post-creation snapshot')
    })

    it('response X plus Y => observes exact returned X', async () => {
      const fakePreSnapshot: ISnapshotResult = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-main', label: 'Main', number: 1, agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't-1', workspace_id: 'ws-main', label: 'T1', number: 1, pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: [{
          pane_id: 'ws-main:p1',
          workspace_id: 'ws-main',
          tab_id: 't-1',
          terminal_id: 'term-src-1',
          cwd: '/home/user/base',
          focused: true,
          agent_status: 'idle'
        }]
      }

      // Snapshot contains BOTH tab X and unrelated tab Y
      const fakePostSnapshot: ISnapshotResult = {
        ...fakePreSnapshot,
        tabs: [
          ...fakePreSnapshot.tabs,
          { tab_id: 't-returned-X', workspace_id: 'ws-main', label: 'X', number: 2, pane_count: 1, focused: false, agent_status: 'idle' },
          { tab_id: 't-concurrent-Y', workspace_id: 'ws-main', label: 'Y', number: 3, pane_count: 1, focused: false, agent_status: 'idle' }
        ],
        panes: [
          ...fakePreSnapshot.panes,
          {
            pane_id: 'ws-main:p-X',
            workspace_id: 'ws-main',
            tab_id: 't-returned-X',
            terminal_id: 'term-X',
            cwd: '/home/user/base',
            focused: false,
            agent_status: 'idle'
          },
          {
            pane_id: 'ws-main:p-Y',
            workspace_id: 'ws-main',
            tab_id: 't-concurrent-Y',
            terminal_id: 'term-Y',
            cwd: '/home/user/base',
            focused: false,
            agent_status: 'idle'
          }
        ]
      }

      let fetchCount = 0
      const mockFetchSnapshot = async () => {
        fetchCount++
        return fetchCount === 1 ? fakePreSnapshot : fakePostSnapshot
      }

      const mockSendSocket = async <T>(): Promise<T> => {
        return {
          ok: true,
          type: 'tab_created',
          tab: { tab_id: 't-returned-X', workspace_id: 'ws-main' },
          root_pane: 'ws-main:p-X'
        } as any
      }

      const res = await executeTabCreate(
        'ws-main',
        { paneId: 'ws-main:p1', terminalId: 'term-src-1' },
        undefined,
        {
          deps: {
            fetchSnapshot: mockFetchSnapshot,
            sendSocketRequest: mockSendSocket
          }
        }
      )

      expect(res.ok).toBe(true)
      expect(res.outcome).toBe('observed')
      expect(res.result).toEqual({
        tabId: 't-returned-X',
        paneId: 'ws-main:p-X'
      })
    })

    it('timeout plus one perfect match => returns outcome: unknown without inferring causation', async () => {
      const fakePreSnapshot: ISnapshotResult = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-main', label: 'Main', number: 1, agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't-1', workspace_id: 'ws-main', label: 'T1', number: 1, pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: [{
          pane_id: 'ws-main:p1',
          workspace_id: 'ws-main',
          tab_id: 't-1',
          terminal_id: 'term-src-1',
          cwd: '/home/user/base',
          focused: true,
          agent_status: 'idle'
        }]
      }

      // Even if post-snapshot happens to contain one perfect new tab matching CWD:
      const fakePostSnapshot: ISnapshotResult = {
        ...fakePreSnapshot,
        tabs: [
          ...fakePreSnapshot.tabs,
          { tab_id: 't-new-perfect', workspace_id: 'ws-main', label: 'Shell', number: 2, pane_count: 1, focused: false, agent_status: 'idle' }
        ],
        panes: [
          ...fakePreSnapshot.panes,
          {
            pane_id: 'ws-main:p-perfect',
            workspace_id: 'ws-main',
            tab_id: 't-new-perfect',
            terminal_id: 'term-perfect',
            cwd: '/home/user/base',
            focused: false,
            agent_status: 'idle'
          }
        ]
      }

      let fetchCount = 0
      const mockFetchSnapshot = async () => {
        fetchCount++
        return fetchCount === 1 ? fakePreSnapshot : fakePostSnapshot
      }

      const mockSendTimeout = async () => {
        const err = new Error('Socket timeout while calling tab.create')
        err.name = 'TimeoutError'
        throw err
      }

      const res = await executeTabCreate(
        'ws-main',
        { paneId: 'ws-main:p1', terminalId: 'term-src-1' },
        undefined,
        {
          deps: {
            fetchSnapshot: mockFetchSnapshot,
            sendSocketRequest: mockSendTimeout
          }
        }
      )

      // Must return unknown, NEVER infer causation by matching CWD/delta
      expect(res.ok).toBe(false)
      expect(res.status).toBe(504)
      expect(res.outcome).toBe('unknown')
      expect(res.error).toContain('operation may have timed out')
    })

    it('tab-only X + one pane => observed', async () => {
      const fakePreSnapshot: ISnapshotResult = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-main', label: 'Main', number: 1, agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't-1', workspace_id: 'ws-main', label: 'T1', number: 1, pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: [{
          pane_id: 'ws-main:p1',
          workspace_id: 'ws-main',
          tab_id: 't-1',
          terminal_id: 'term-src-1',
          cwd: '/home/user/base',
          focused: true,
          agent_status: 'idle'
        }]
      }

      const fakePostSnapshot: ISnapshotResult = {
        ...fakePreSnapshot,
        tabs: [
          ...fakePreSnapshot.tabs,
          { tab_id: 't-tab-only', workspace_id: 'ws-main', label: 'TabOnly', number: 2, pane_count: 1, focused: false, agent_status: 'idle' }
        ],
        panes: [
          ...fakePreSnapshot.panes,
          {
            pane_id: 'ws-main:p-sole',
            workspace_id: 'ws-main',
            tab_id: 't-tab-only',
            terminal_id: 'term-sole',
            cwd: '/home/user/base',
            focused: false,
            agent_status: 'idle'
          }
        ]
      }

      let fetchCount = 0
      const mockFetchSnapshot = async () => {
        fetchCount++
        return fetchCount === 1 ? fakePreSnapshot : fakePostSnapshot
      }

      // Daemon returns tab identity without root_pane
      const mockSendSocket = async <T>(): Promise<T> => {
        return {
          ok: true,
          type: 'tab_created',
          tab: { tab_id: 't-tab-only', workspace_id: 'ws-main' }
        } as any
      }

      const res = await executeTabCreate(
        'ws-main',
        { paneId: 'ws-main:p1', terminalId: 'term-src-1' },
        undefined,
        {
          deps: {
            fetchSnapshot: mockFetchSnapshot,
            sendSocketRequest: mockSendSocket
          }
        }
      )

      expect(res.ok).toBe(true)
      expect(res.outcome).toBe('observed')
      expect(res.result).toEqual({
        tabId: 't-tab-only',
        paneId: 'ws-main:p-sole'
      })
    })

    it('tab-only X + multiple panes => unknown', async () => {
      const fakePreSnapshot: ISnapshotResult = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-main', label: 'Main', number: 1, agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't-1', workspace_id: 'ws-main', label: 'T1', number: 1, pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: [{
          pane_id: 'ws-main:p1',
          workspace_id: 'ws-main',
          tab_id: 't-1',
          terminal_id: 'term-src-1',
          cwd: '/home/user/base',
          focused: true,
          agent_status: 'idle'
        }]
      }

      // Snapshot has tab X with TWO terminal panes
      const fakePostSnapshot: ISnapshotResult = {
        ...fakePreSnapshot,
        tabs: [
          ...fakePreSnapshot.tabs,
          { tab_id: 't-tab-multi', workspace_id: 'ws-main', label: 'TabMulti', number: 2, pane_count: 2, focused: false, agent_status: 'idle' }
        ],
        panes: [
          ...fakePreSnapshot.panes,
          {
            pane_id: 'ws-main:p-multi-1',
            workspace_id: 'ws-main',
            tab_id: 't-tab-multi',
            terminal_id: 'term-m1',
            cwd: '/home/user/base',
            focused: false,
            agent_status: 'idle'
          },
          {
            pane_id: 'ws-main:p-multi-2',
            workspace_id: 'ws-main',
            tab_id: 't-tab-multi',
            terminal_id: 'term-m2',
            cwd: '/home/user/base',
            focused: false,
            agent_status: 'idle'
          }
        ]
      }

      let fetchCount = 0
      const mockFetchSnapshot = async () => {
        fetchCount++
        return fetchCount === 1 ? fakePreSnapshot : fakePostSnapshot
      }

      const mockSendSocket = async <T>(): Promise<T> => {
        return {
          ok: true,
          type: 'tab_created',
          tab: { tab_id: 't-tab-multi', workspace_id: 'ws-main' }
        } as any
      }

      const res = await executeTabCreate(
        'ws-main',
        { paneId: 'ws-main:p1', terminalId: 'term-src-1' },
        undefined,
        {
          deps: {
            fetchSnapshot: mockFetchSnapshot,
            sendSocketRequest: mockSendSocket
          }
        }
      )

      expect(res.ok).toBe(false)
      expect(res.status).toBe(504)
      expect(res.outcome).toBe('unknown')
      expect(res.error).toContain('expected exactly 1')
    })

    it('root identity mismatch => unknown', async () => {
      const fakePreSnapshot: ISnapshotResult = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-main', label: 'Main', number: 1, agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't-1', workspace_id: 'ws-main', label: 'T1', number: 1, pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: [{
          pane_id: 'ws-main:p1',
          workspace_id: 'ws-main',
          tab_id: 't-1',
          terminal_id: 'term-src-1',
          cwd: '/home/user/base',
          focused: true,
          agent_status: 'idle'
        }]
      }

      const fakePostSnapshot: ISnapshotResult = {
        ...fakePreSnapshot,
        tabs: [
          ...fakePreSnapshot.tabs,
          { tab_id: 't-returned-X', workspace_id: 'ws-main', label: 'X', number: 2, pane_count: 1, focused: false, agent_status: 'idle' }
        ],
        panes: [
          ...fakePreSnapshot.panes,
          {
            pane_id: 'ws-main:p-actual-root',
            workspace_id: 'ws-main',
            tab_id: 't-returned-X',
            terminal_id: 'term-actual',
            cwd: '/home/user/base',
            focused: false,
            agent_status: 'idle'
          }
        ]
      }

      let fetchCount = 0
      const mockFetchSnapshot = async () => {
        fetchCount++
        return fetchCount === 1 ? fakePreSnapshot : fakePostSnapshot
      }

      // Daemon returns root_pane 'ws-main:p-mismatched-nonexistent'
      const mockSendSocket = async <T>(): Promise<T> => {
        return {
          ok: true,
          type: 'tab_created',
          tab: { tab_id: 't-returned-X', workspace_id: 'ws-main' },
          root_pane: 'ws-main:p-mismatched-nonexistent'
        } as any
      }

      const res = await executeTabCreate(
        'ws-main',
        { paneId: 'ws-main:p1', terminalId: 'term-src-1' },
        undefined,
        {
          deps: {
            fetchSnapshot: mockFetchSnapshot,
            sendSocketRequest: mockSendSocket
          }
        }
      )

      expect(res.ok).toBe(false)
      expect(res.status).toBe(504)
      expect(res.outcome).toBe('unknown')
      expect(res.error).toContain('does not match tab')
    })
  })

  describe('7. Repo-Configured Interaction Catalog & Git Boundary', () => {
    let tmpDir: string

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-catalog-test-'))
    })

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch {}
    })

    it('resolves nearest ancestor .herdr/commands.json within Git repository boundary', () => {
      const repoRoot = path.join(tmpDir, 'my-repo')
      const subDir = path.join(repoRoot, 'src', 'deep', 'nested')
      fs.mkdirSync(subDir, { recursive: true })

      // Create .git boundary
      fs.mkdirSync(path.join(repoRoot, '.git'))

      const dotHerdr = path.join(repoRoot, '.herdr')
      fs.mkdirSync(dotHerdr)
      fs.writeFileSync(
        path.join(dotHerdr, 'commands.json'),
        JSON.stringify({
          version: 1,
          items: [
            { id: 'test', label: 'Run Tests', fillValue: 'bun test' }
          ]
        })
      )

      const result = resolveNearestRepoCatalog(subDir)
      expect(result.kind).toBe('found')
      if (result.kind === 'found') {
        expect(result.catalog.source).toBe('repo-config')
        expect(result.catalog.version).toBe(1)
        expect(result.catalog.items.length).toBe(1)
        expect(result.catalog.items[0].fillValue).toBe('bun test')
      }
    })

    it('stops at .git boundary and does not drift into parent directory containing .herdr', () => {
      // Parent directory has a .herdr config
      const parentDotHerdr = path.join(tmpDir, '.herdr')
      fs.mkdirSync(parentDotHerdr)
      fs.writeFileSync(
        path.join(parentDotHerdr, 'commands.json'),
        JSON.stringify({
          version: 1,
          items: [{ id: 'parent-cmd', label: 'Parent', fillValue: 'parent' }]
        })
      )

      // Sub-repo with its own .git root but NO .herdr
      const repoRoot = path.join(tmpDir, 'child-repo')
      const subDir = path.join(repoRoot, 'src')
      fs.mkdirSync(subDir, { recursive: true })
      fs.mkdirSync(path.join(repoRoot, '.git'))

      const result = resolveNearestRepoCatalog(subDir)
      // Must NOT see parent-cmd! Must stop at child-repo .git boundary and return missing
      expect(result.kind).toBe('missing')
      if (result.kind === 'missing') {
        expect(result.catalog.items).toEqual([])
      }
    })

    it('when no .git boundary exists, checks only exact start cwd and stops', () => {
      const parentDotHerdr = path.join(tmpDir, '.herdr')
      fs.mkdirSync(parentDotHerdr)
      fs.writeFileSync(
        path.join(parentDotHerdr, 'commands.json'),
        JSON.stringify({
          version: 1,
          items: [{ id: 'parent-cmd', label: 'Parent', fillValue: 'parent' }]
        })
      )

      // Directory without .git
      const noGitSubDir = path.join(tmpDir, 'no-git-sub')
      fs.mkdirSync(noGitSubDir)

      const result = resolveNearestRepoCatalog(noGitSubDir)
      expect(result.kind).toBe('missing')
      if (result.kind === 'missing') {
        expect(result.catalog.items).toEqual([])
      }
    })

    it('distinguishable returns: returns kind invalid for symlink', () => {
      const repoRoot = path.join(tmpDir, 'symlink-repo')
      fs.mkdirSync(repoRoot)
      fs.mkdirSync(path.join(repoRoot, '.git'))
      const dotHerdr = path.join(repoRoot, '.herdr')
      fs.mkdirSync(dotHerdr)

      const targetFile = path.join(tmpDir, 'real-commands.json')
      fs.writeFileSync(
        targetFile,
        JSON.stringify({ version: 1, items: [{ id: 'test', label: 'T', fillValue: 'ls' }] })
      )

      fs.symlinkSync(targetFile, path.join(dotHerdr, 'commands.json'))

      const result = resolveNearestRepoCatalog(repoRoot)
      expect(result.kind).toBe('invalid')
      if (result.kind === 'invalid') {
        expect(result.error).toContain('symbolic link')
      }
    })

    it('distinguishable returns: returns kind invalid for invalid JSON or schema error', () => {
      const repoRoot = path.join(tmpDir, 'invalid-repo')
      fs.mkdirSync(repoRoot)
      fs.mkdirSync(path.join(repoRoot, '.git'))
      const dotHerdr = path.join(repoRoot, '.herdr')
      fs.mkdirSync(dotHerdr)

      fs.writeFileSync(path.join(dotHerdr, 'commands.json'), 'NOT JSON')

      const result = resolveNearestRepoCatalog(repoRoot)
      expect(result.kind).toBe('invalid')
      if (result.kind === 'invalid') {
        expect(result.error).toContain('invalid JSON')
      }
    })

    it('prevents symlinked CWD path component from crossing Git repo boundary', () => {
      // 1. Outside directory containing an attacker or rogue .herdr/commands.json
      const outsideDir = path.join(tmpDir, 'outside-escape')
      fs.mkdirSync(outsideDir, { recursive: true })
      const outsideDotHerdr = path.join(outsideDir, '.herdr')
      fs.mkdirSync(outsideDotHerdr, { recursive: true })
      fs.writeFileSync(
        path.join(outsideDotHerdr, 'commands.json'),
        JSON.stringify({
          version: 1,
          items: [{ id: 'outside-cmd', label: 'Escaped', fillValue: 'echo escaped' }]
        })
      )

      // 2. Legitimate repo with .git but NO .herdr
      const repoDir = path.join(tmpDir, 'legit-repo')
      const repoSrc = path.join(repoDir, 'src')
      fs.mkdirSync(repoSrc, { recursive: true })
      fs.mkdirSync(path.join(repoDir, '.git'))

      // 3. Symlink inside outsideDir pointing into repoDir
      const symlinkIntoRepo = path.join(outsideDir, 'repo-link')
      fs.symlinkSync(repoDir, symlinkIntoRepo)

      // If startDir is accessed via the symlinked path outsideDir/repo-link/src:
      const symlinkedStartDir = path.join(symlinkIntoRepo, 'src')

      // With fs.realpathSync canonicalization, the path resolves to legit-repo/src.
      // Discovery stops at legit-repo/.git and does NOT traverse up into outsideDir/.herdr
      const result = resolveNearestRepoCatalog(symlinkedStartDir)
      expect(result.kind).toBe('missing')
      if (result.kind === 'missing') {
        expect(result.catalog.items).toEqual([])
      }
    })
  })

  describe('8. Structured Dormant Agent Preset Contract & Native Interaction Types', () => {
    it('defines structured Agy Gemini 3.8 Flash High preset', () => {
      const preset = getAgentPreset('agy-gemini-3.8-flash-high')
      expect(preset).toBeDefined()
      expect(preset?.enabled).toBe(false)
      expect(preset?.kind).toBe('agy')
      expect(preset?.model).toBe('gemini-3.8-flash-high')
      expect(preset?.effort).toBe('high')
      expect(preset?.permissions).toBe('dangerously-skip-permissions')
      expect(preset?.argv).toEqual([
        'agy',
        '--model',
        'gemini-3.8-flash-high',
        '--dangerously-skip-permissions'
      ])

      for (const p of DORMANT_AGENT_PRESETS) {
        expect(p.enabled).toBe(false)
      }
    })

    it('guard: refuses any preset launch execution', () => {
      const check = validateAgentPresetExecution()
      expect(check.allowed).toBe(false)
      expect(check.error).toContain('dormant')
    })

    it('verifies type contracts for native interaction envelope and response', () => {
      const envelope: INativeInteractionEnvelope = {
        providerId: 'native-agent',
        providerVersion: '1.0.0',
        target: { paneId: 'ws:p1', terminalId: 'term-1', expectedMode: 'blocked-agent' },
        interactionId: 'int-123',
        revision: 1,
        responseMethod: 'interaction.respond',
        choices: [
          { id: 'approve', label: 'Approve', description: 'Proceed with changes' },
          { id: 'reject', label: 'Reject' }
        ]
      }
      expect(envelope.choices.length).toBe(2)
      expect(envelope.choices[0].id).toBe('approve')

      const response: INativeChoiceResponse = {
        interactionId: 'int-123',
        choiceId: 'approve',
        target: envelope.target,
        revision: 1
      }
      expect(response.choiceId).toBe('approve')
    })
  })

  describe('9. Action Route Idempotency Ordering, Lease Bypass, & Snapshot Preflight Failure Truth', () => {
    const coordinator = getSharedOperationCoordinator()
    const leaseManager = getSharedTerminalControlLeaseManager()
    let server: ReturnType<typeof createServer>

    beforeEach(() => {
      coordinator.resetForTesting()
      leaseManager.resetForTesting()
      server = createServer(0, '127.0.0.1', { startPushBridge: false })
    })

    afterEach(() => {
      server.stop(true)
      coordinator.resetForTesting()
      leaseManager.resetForTesting()
    })

    function createDeferred<T>() {
      let resolve!: (val: T) => void
      let reject!: (err: any) => void
      const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }

    it('paused action snapshot reserves ID and pane before await; concurrent action on same pane gets 409 contention', async () => {
      const snapshotStartedDeferred = createDeferred<void>()
      const deferredSnapshot = createDeferred<ISnapshotResult>()
      const testServer = createServer(0, '127.0.0.1', {
        startPushBridge: false,
        deps: {
          coordinator,
          leaseManager,
          fetchSnapshot: async () => {
            snapshotStartedDeferred.resolve()
            return await deferredSnapshot.promise
          },
          executeTerminalInput: async () => ({ ok: true, output: 'done\n' })
        }
      })

      let p1: Promise<Response> | null = null
      try {
        const action1: IActionRequest = {
          operationId: 'op-interleave-1',
          type: 'terminal-input',
          target: { paneId: 'ws-1:p-shell', terminalId: 'term-shell-1', expectedMode: 'shell' },
          text: 'echo 1\n'
        }

        const action2: IActionRequest = {
          operationId: 'op-interleave-2',
          type: 'terminal-input',
          target: { paneId: 'ws-1:p-shell', terminalId: 'term-shell-1', expectedMode: 'shell' },
          text: 'echo 2\n'
        }

        // Launch first request (starts and awaits deferred snapshot)
        p1 = fetch(`http://127.0.0.1:${testServer.port}/api/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${testServer.port}` },
          body: JSON.stringify(action1)
        })

        // Wait until route handler has synchronously called beginAction and entered fetchSnapshot
        await snapshotStartedDeferred.promise

        // Verify pane is claimed in coordinator
        expect(coordinator.isPaneClaimed('ws-1:p-shell')).toBe(true)

        // Launch second request for SAME pane with DIFFERENT operationId
        const res2 = await fetch(`http://127.0.0.1:${testServer.port}/api/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${testServer.port}` },
          body: JSON.stringify(action2)
        })

        // Second request receives 409 contention immediately without awaiting snapshot
        expect(res2.status).toBe(409)
        const data2 = await res2.json()
        expect(data2.ok).toBe(false)
        expect(data2.error).toContain('already in-flight')

        // Now resolve snapshot for action1 so it completes
        deferredSnapshot.resolve({
          protocol: 22,
          version: '0.9.1',
          workspaces: [],
          tabs: [],
          panes: [{
            pane_id: 'ws-1:p-shell',
            workspace_id: 'ws-1',
            tab_id: 'tab-1',
            terminal_id: 'term-shell-1',
            agent_status: 'idle',
            cwd: '/workspace',
            focused: true
          }]
        })

        const res1 = await p1
        expect(res1.status).toBe(200)
        const data1 = await res1.json()
        expect(data1.ok).toBe(true)
        expect(coordinator.isPaneClaimed('ws-1:p-shell')).toBe(false)
      } finally {
        deferredSnapshot.resolve({
          protocol: 22,
          version: '0.9.1',
          workspaces: [],
          tabs: [],
          panes: []
        })
        if (p1) await p1.catch(() => {})
        testServer.stop(true)
      }
    })

    it('delayed duplicate (same opId) during await gets in_flight 409 and never dispatches', async () => {
      const snapshotStartedDeferred = createDeferred<void>()
      const deferredSnapshot = createDeferred<ISnapshotResult>()
      let dispatchCount = 0
      const testServer = createServer(0, '127.0.0.1', {
        startPushBridge: false,
        deps: {
          coordinator,
          leaseManager,
          fetchSnapshot: async () => {
            snapshotStartedDeferred.resolve()
            return await deferredSnapshot.promise
          },
          executeTerminalInput: async () => {
            dispatchCount++
            return { ok: true, output: 'done\n' }
          }
        }
      })

      let p1: Promise<Response> | null = null
      try {
        const actionPayload: IActionRequest = {
          operationId: 'op-delayed-dup-1',
          type: 'terminal-input',
          target: { paneId: 'ws-1:p-shell', terminalId: 'term-shell-1', expectedMode: 'shell' },
          text: 'echo dup\n'
        }

        // Launch first request
        p1 = fetch(`http://127.0.0.1:${testServer.port}/api/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${testServer.port}` },
          body: JSON.stringify(actionPayload)
        })

        await snapshotStartedDeferred.promise

        // Launch identical duplicate request while first is still awaiting snapshot
        const resDup = await fetch(`http://127.0.0.1:${testServer.port}/api/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${testServer.port}` },
          body: JSON.stringify(actionPayload)
        })

        expect(resDup.status).toBe(409)
        const dataDup = await resDup.json()
        expect(dataDup.ok).toBe(false)
        expect(dataDup.error).toContain('already in-flight')

        // Resolve snapshot
        deferredSnapshot.resolve({
          protocol: 22,
          version: '0.9.1',
          workspaces: [],
          tabs: [],
          panes: [{
            pane_id: 'ws-1:p-shell',
            workspace_id: 'ws-1',
            tab_id: 'tab-1',
            terminal_id: 'term-shell-1',
            agent_status: 'idle',
            cwd: '/workspace',
            focused: true
          }]
        })

        const res1 = await p1
        expect(res1.status).toBe(200)
        expect(dispatchCount).toBe(1)
      } finally {
        deferredSnapshot.resolve({
          protocol: 22,
          version: '0.9.1',
          workspaces: [],
          tabs: [],
          panes: []
        })
        if (p1) await p1.catch(() => {})
        testServer.stop(true)
      }
    })

    it('snapshot fetch failure leaves no ID/pane/cache allowing clean retry', async () => {
      const snapshotStartedDeferred = createDeferred<void>()
      const deferredSnapshot = createDeferred<ISnapshotResult>()
      const testServer = createServer(0, '127.0.0.1', {
        startPushBridge: false,
        deps: {
          coordinator,
          leaseManager,
          fetchSnapshot: async () => {
            snapshotStartedDeferred.resolve()
            return await deferredSnapshot.promise
          }
        }
      })

      let p1: Promise<Response> | null = null
      try {
        const actionPayload: IActionRequest = {
          operationId: 'op-abandon-clean-1',
          type: 'terminal-input',
          target: { paneId: 'ws-1:p-shell', terminalId: 'term-shell-1', expectedMode: 'shell' },
          text: 'echo retry\n'
        }

        p1 = fetch(`http://127.0.0.1:${testServer.port}/api/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${testServer.port}` },
          body: JSON.stringify(actionPayload)
        })

        await snapshotStartedDeferred.promise
        expect(coordinator.isPaneClaimed('ws-1:p-shell')).toBe(true)

        // Reject snapshot fetch
        deferredSnapshot.reject(new Error('Daemon snapshot socket unreachable'))

        const res1 = await p1
        expect(res1.status).toBe(502)
        const data1 = await res1.json()
        expect(data1.ok).toBe(false)
        expect(data1.outcome).toBe('rejected')

        // Invariant C: Pane claim released, no in-flight, not cached!
        expect(coordinator.isPaneClaimed('ws-1:p-shell')).toBe(false)
        const fp = computePayloadFingerprint(actionPayload)
        const check = coordinator.beginAction(actionPayload.operationId, actionPayload.target.paneId, fp)
        expect(check.kind).toBe('admitted')
        if (check.kind === 'admitted') coordinator.abandonAction(check.token)
      } finally {
        deferredSnapshot.reject(new Error('cleanup'))
        if (p1) await p1.catch(() => {})
        testServer.stop(true)
      }
    })

    it('action paused blocks Control reservation and Control lease blocks action admission', async () => {
      const snapshotStartedDeferred = createDeferred<void>()
      const deferredSnapshot = createDeferred<ISnapshotResult>()
      const testServer = createServer(0, '127.0.0.1', {
        startPushBridge: false,
        deps: {
          coordinator,
          leaseManager,
          fetchSnapshot: async () => {
            snapshotStartedDeferred.resolve()
            return await deferredSnapshot.promise
          },
          executeTerminalInput: async () => ({ ok: true, output: 'done\n' })
        }
      })

      let p1: Promise<Response> | null = null
      try {
        const paneId = 'ws-1:p-shell'
        const actionPayload: IActionRequest = {
          operationId: 'op-mutual-exclusion-1',
          type: 'terminal-input',
          target: { paneId, terminalId: 'term-shell-1', expectedMode: 'shell' },
          text: 'echo mutual\n'
        }

        // 1. Action is launched and pauses on snapshot
        p1 = fetch(`http://127.0.0.1:${testServer.port}/api/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${testServer.port}` },
          body: JSON.stringify(actionPayload)
        })

        await snapshotStartedDeferred.promise
        expect(coordinator.isPaneClaimed(paneId)).toBe(true)

        // While action is in-flight, Terminal Control reservation on the SAME pane must fail!
        const reserveAttempt = leaseManager.reserveLease(paneId)
        expect(reserveAttempt.ok).toBe(false)
        if (!reserveAttempt.ok) {
          expect(reserveAttempt.status).toBe(409)
          expect(reserveAttempt.error).toContain('already in-flight')
        }

        // Resolve snapshot and finish action
        deferredSnapshot.resolve({
          protocol: 22,
          version: '0.9.1',
          workspaces: [],
          tabs: [],
          panes: [{
            pane_id: paneId,
            workspace_id: 'ws-1',
            tab_id: 'tab-1',
            terminal_id: 'term-shell-1',
            agent_status: 'idle',
            cwd: '/workspace',
            focused: true
          }]
        })
        const res1 = await p1
        expect(res1.status).toBe(200)
        expect(coordinator.isPaneClaimed(paneId)).toBe(false)

        // 2. Now acquire Control lease on paneId
        const controlReservation = leaseManager.reserveLease(paneId)
        expect(controlReservation.ok).toBe(true)
        expect(coordinator.isPaneClaimed(paneId)).toBe(true)

        // Action attempted while Control owns pane must immediately fail with 409 contention
        const resActionBlocked = await fetch(`http://127.0.0.1:${testServer.port}/api/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${testServer.port}` },
          body: JSON.stringify({
            operationId: 'op-action-blocked-by-control',
            type: 'terminal-input',
            target: { paneId, terminalId: 'term-shell-1', expectedMode: 'shell' },
            text: 'echo blocked\n'
          })
        })

        expect(resActionBlocked.status).toBe(409)
        const dataActionBlocked = await resActionBlocked.json()
        expect(dataActionBlocked.ok).toBe(false)
        expect(dataActionBlocked.error).toContain('currently controlled')

        // Release lease
        if (controlReservation.ok) {
          await leaseManager.releaseLease(controlReservation.lease.id)
        }
        expect(coordinator.isPaneClaimed(paneId)).toBe(false)
      } finally {
        deferredSnapshot.resolve({
          protocol: 22,
          version: '0.9.1',
          workspaces: [],
          tabs: [],
          panes: []
        })
        if (p1) await p1.catch(() => {})
        testServer.stop(true)
      }
    })

    it('replays cached success response even when pane lease is active', async () => {
      const actionPayload: IActionRequest = {
        operationId: 'op-success-cached-1',
        type: 'terminal-input',
        target: {
          paneId: 'ws-1:p-shell',
          terminalId: 'term-shell-1',
          expectedMode: 'shell'
        },
        text: 'echo cached-success\n'
      }

      const fingerprint = computePayloadFingerprint(actionPayload)
      const cachedBody = {
        ok: true,
        output: 'cached-success-executed'
      }
      const adm = coordinator.beginAction(actionPayload.operationId, actionPayload.target.paneId, fingerprint)
      expect(adm.kind).toBe('admitted')
      if (adm.kind === 'admitted') coordinator.completeAction(adm.token, 200, cachedBody)

      // Acquire active lease on the target pane
      const leaseResult = leaseManager.reserveLease(actionPayload.target.paneId)
      expect(leaseResult.ok).toBe(true)
      expect(leaseManager.isPaneLeased(actionPayload.target.paneId)).toBe(true)

      // Post to /api/action with loopback origin
      const res = await fetch(`http://127.0.0.1:${server.port}/api/action`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: `http://127.0.0.1:${server.port}`
        },
        body: JSON.stringify(actionPayload)
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual(cachedBody)
    })

    it('replays cached unknown response even when pane lease is active', async () => {
      const actionPayload: IActionRequest = {
        operationId: 'op-unknown-cached-1',
        type: 'terminal-input',
        target: {
          paneId: 'ws-1:p-shell',
          terminalId: 'term-shell-1',
          expectedMode: 'shell'
        },
        text: 'echo cached-unknown\n'
      }

      const fingerprint = computePayloadFingerprint(actionPayload)
      const cachedBody = {
        ok: false,
        outcome: 'unknown',
        error: 'Operation timed out waiting for socket acknowledgment'
      }
      const adm = coordinator.beginAction(actionPayload.operationId, actionPayload.target.paneId, fingerprint)
      expect(adm.kind).toBe('admitted')
      if (adm.kind === 'admitted') coordinator.completeAction(adm.token, 504, cachedBody)

      // Acquire active lease on target pane
      const leaseResult = leaseManager.reserveLease(actionPayload.target.paneId)
      expect(leaseResult.ok).toBe(true)
      expect(leaseManager.isPaneLeased(actionPayload.target.paneId)).toBe(true)

      const res = await fetch(`http://127.0.0.1:${server.port}/api/action`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: `http://127.0.0.1:${server.port}`
        },
        body: JSON.stringify(actionPayload)
      })

      expect(res.status).toBe(504)
      const data = await res.json()
      expect(data).toEqual(cachedBody)
    })

    it('rejects conflicting payload reuse immediately with 409 Conflict', async () => {
      const originalPayload: IActionRequest = {
        operationId: 'op-conflict-route-1',
        type: 'terminal-input',
        target: {
          paneId: 'ws-1:p-shell',
          terminalId: 'term-shell-1',
          expectedMode: 'shell'
        },
        text: 'first command\n'
      }

      const fingerprint = computePayloadFingerprint(originalPayload)
      const adm = coordinator.beginAction(originalPayload.operationId, originalPayload.target.paneId, fingerprint)
      expect(adm.kind).toBe('admitted')
      if (adm.kind === 'admitted') coordinator.completeAction(adm.token, 200, { ok: true })

      // Reuse same operationId with different payload text
      const conflictingPayload: IActionRequest = {
        ...originalPayload,
        text: 'different command\n'
      }

      const res = await fetch(`http://127.0.0.1:${server.port}/api/action`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: `http://127.0.0.1:${server.port}`
        },
        body: JSON.stringify(conflictingPayload)
      })

      expect(res.status).toBe(409)
      const data = await res.json()
      expect(data.ok).toBe(false)
      expect(data.error).toContain('Operation ID reuse conflict')
    })

    it('returns 502 with outcome: rejected when snapshot preflight fails, without caching in coordinator', async () => {
      const origSocket = process.env.HERDR_SOCKET_PATH
      process.env.HERDR_SOCKET_PATH = '/tmp/herdr-test-nonexistent.sock'
      try {
        const actionPayload: IActionRequest = {
          operationId: 'op-preflight-fail-1',
          type: 'terminal-input',
          target: {
            paneId: 'ws-1:p-shell',
            terminalId: 'term-shell-1',
            expectedMode: 'shell'
          },
          text: 'echo test\n'
        }

        const fingerprint = computePayloadFingerprint(actionPayload)

        const res = await fetch(`http://127.0.0.1:${server.port}/api/action`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: `http://127.0.0.1:${server.port}`
          },
          body: JSON.stringify(actionPayload)
        })

        expect(res.status).toBe(502)
        const data = await res.json()
        expect(data.ok).toBe(false)
        expect(data.outcome).toBe('rejected')
        expect(data.error).toContain('Snapshot preflight failed')

        // Verify that this 502 failure was NOT cached in coordinator
        const checkAfter = coordinator.beginAction(actionPayload.operationId, actionPayload.target.paneId, fingerprint)
        expect(checkAfter.kind).toBe('admitted')
        if (checkAfter.kind === 'admitted') coordinator.abandonAction(checkAfter.token)
      } finally {
        if (origSocket === undefined) delete process.env.HERDR_SOCKET_PATH
        else process.env.HERDR_SOCKET_PATH = origSocket
      }
    })

    it('unexpected exception during pre-dispatch target verification abandons attempt, returns 502, and leaks no claim or operation ID', async () => {
      const failingServer = createServer(0, '127.0.0.1', {
        startPushBridge: false,
        deps: {
          coordinator,
          verifyTarget: () => {
            throw new Error('Simulated pre-dispatch verification throw')
          }
        }
      })

      try {
        const actionPayload: IActionRequest = {
          operationId: 'op-throw-leak-test-1',
          type: 'terminal-input',
          target: {
            paneId: 'ws-1:p-shell',
            terminalId: 'term-shell-1',
            expectedMode: 'shell'
          },
          text: 'echo leak-check\n'
        }

        const res = await fetch(`http://127.0.0.1:${failingServer.port}/api/action`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: `http://127.0.0.1:${failingServer.port}`
          },
          body: JSON.stringify(actionPayload)
        })

        expect(res.status).toBe(502)
        const data = await res.json()
        expect(data.ok).toBe(false)
        expect(data.outcome).toBe('rejected')
        expect(data.error).toContain('Pre-dispatch error')

        // Prove no claim and no operation ID remain!
        expect(coordinator.isPaneClaimed('ws-1:p-shell')).toBe(false)
        expect(coordinator.getActiveAttemptsCountForTesting()).toBe(0)
        expect(coordinator.getActiveOperationIdsCountForTesting()).toBe(0)

        // Verify that the same operation ID can immediately be admitted fresh without being blocked as in-flight
        const fingerprint = computePayloadFingerprint(actionPayload)
        const freshAdm = coordinator.beginAction(actionPayload.operationId, actionPayload.target.paneId, fingerprint)
        expect(freshAdm.kind).toBe('admitted')
        if (freshAdm.kind === 'admitted') {
          coordinator.abandonAction(freshAdm.token)
        }
      } finally {
        failingServer.stop(true)
      }
    })

    it('rejects RPC response with wrong type or malformed payload returning outcome: unknown without inferring from matching tabs', async () => {
      const matchingPostSnapshot = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-1', number: 1, label: 'Space 1', agent_status: 'idle', tab_count: 1, pane_count: 2, focused: true }],
        tabs: [
          { tab_id: 'tab-99', workspace_id: 'ws-1', label: 'Inferred Tab', number: 1, pane_count: 1, focused: true, agent_status: 'idle' }
        ],
        panes: [
          {
            pane_id: 'ws-1:p1',
            terminal_id: 'term-1',
            tab_id: 'tab-1',
            workspace_id: 'ws-1',
            cwd: '/tmp',
            agent_status: 'idle',
            focused: true
          },
          {
            pane_id: 'ws-1:p-new',
            terminal_id: 'term-new',
            tab_id: 'tab-99',
            workspace_id: 'ws-1',
            cwd: '/tmp',
            agent_status: 'idle',
            focused: false
          }
        ]
      } as unknown as ISnapshotResult

      // Case A: Wrong type (e.g. 'wrong_event_type' instead of 'tab_created')
      const resWrongType = await executeTabCreate(
        'ws-1',
        { paneId: 'ws-1:p1', terminalId: 'term-1' },
        'Test Tab',
        {
          deps: {
            sendSocketRequest: (async () => ({
              type: 'wrong_event_type',
              tab: { tab_id: 'tab-99', workspace_id: 'ws-1' },
              root_pane: 'ws-1:p-new'
            })) as any,
            fetchSnapshot: async () => matchingPostSnapshot
          }
        }
      )

      expect(resWrongType.ok).toBe(false)
      expect(resWrongType.status).toBe(504)
      expect(resWrongType.outcome).toBe('unknown')
      expect(resWrongType.error).toContain('expected type "tab_created"')

      // Case B: Malformed response without type
      const resNoType = await executeTabCreate(
        'ws-1',
        { paneId: 'ws-1:p1', terminalId: 'term-1' },
        'Test Tab',
        {
          deps: {
            sendSocketRequest: (async () => ({
              tab: { tab_id: 'tab-99', workspace_id: 'ws-1' },
              root_pane: 'ws-1:p-new'
            })) as any,
            fetchSnapshot: async () => matchingPostSnapshot
          }
        }
      )

      expect(resNoType.ok).toBe(false)
      expect(resNoType.status).toBe(504)
      expect(resNoType.outcome).toBe('unknown')
    })

    it('quarantines lease and blocks new actions/leases when child fails to exit within grace + kill wait, then releases on late exit', async () => {
      const fastTimingManager = new TerminalControlLeaseManager({
        arbiter: {
          claimPane: (p, l) => coordinator.claimPaneForControl(p, l),
          releasePane: (t) => { coordinator.releaseControlPane(t) },
          isPaneClaimed: (p) => coordinator.isPaneClaimed(p)
        },
        releaseGraceTimeoutMs: 5,
        releaseKillTimeoutMs: 5
      })

      const paneId = 'pane-quarantine-1'
      const reservation = fastTimingManager.reserveLease(paneId)
      expect(reservation.ok).toBe(true)
      if (!reservation.ok) return
      const leaseId = reservation.lease.id

      // Mock a child process whose exit does NOT resolve immediately
      const childExitDeferred = createDeferred<number>()
      const mockProc: any = {
        stdin: { write: () => {}, flush: () => {} },
        kill: () => {},
        exited: childExitDeferred.promise
      }

      fastTimingManager.activateLease(leaseId, mockProc, null)
      expect(fastTimingManager.isLeaseActive(leaseId)).toBe(true)

      // Trigger release
      const releasePromise = fastTimingManager.releaseLease(leaseId, 'manual_detach')

      // Wait for grace (5ms) and kill timeout (5ms) to expire
      await releasePromise

      // Quarantine guarantees:
      // Status remains 'releasing', pane claim is still held, new lease and new action are blocked!
      expect(fastTimingManager.isPaneLeased(paneId)).toBe(true)
      expect(coordinator.isPaneClaimed(paneId)).toBe(true)

      // Attempting a new lease fails with 409
      const newReservation = fastTimingManager.reserveLease(paneId)
      expect(newReservation.ok).toBe(false)
      if (!newReservation.ok) expect(newReservation.status).toBe(409)

      // Attempting an action on quarantined pane fails with 409 contention
      const actionAdm = coordinator.beginAction('op-quarantine-act', paneId, 'fp-q')
      expect(actionAdm.kind).toBe('contention')
      if (actionAdm.kind === 'contention') expect(actionAdm.status).toBe(409)

      // Late child exit occurs!
      childExitDeferred.resolve(0)
      await new Promise((r) => setTimeout(r, 10))

      // Quarantine resolved: pane claim released, lease is released, new lease/action admitted!
      expect(fastTimingManager.isPaneLeased(paneId)).toBe(false)
      expect(coordinator.isPaneClaimed(paneId)).toBe(false)

      const followUpAction = coordinator.beginAction('op-quarantine-act', paneId, 'fp-q')
      expect(followUpAction.kind).toBe('admitted')
      if (followUpAction.kind === 'admitted') coordinator.abandonAction(followUpAction.token)
    })

    it('pure guard: isLeasePending and isLeaseActive prevent ready callback on released or expired leases', async () => {
      const shortManager = new TerminalControlLeaseManager({
        maxLeaseDurationMs: 10,
        arbiter: {
          claimPane: (p, l) => coordinator.claimPaneForControl(p, l),
          releasePane: (t) => { coordinator.releaseControlPane(t) }
        }
      })

      const paneId = 'pane-guard-test'
      const reservation = shortManager.reserveLease(paneId)
      expect(reservation.ok).toBe(true)
      if (!reservation.ok) return
      const leaseId = reservation.lease.id

      expect(shortManager.isLeasePending(leaseId)).toBe(true)
      expect(shortManager.isLeaseActive(leaseId)).toBe(false)

      // Activate lease
      const mockProc: any = { stdin: null, kill: () => {}, exited: Promise.resolve(0) }
      shortManager.activateLease(leaseId, mockProc, null)
      expect(shortManager.isLeasePending(leaseId)).toBe(false)
      expect(shortManager.isLeaseActive(leaseId)).toBe(true)

      // Release lease
      await shortManager.releaseLease(leaseId, 'test_release')
      expect(shortManager.isLeaseActive(leaseId)).toBe(false)
      expect(shortManager.isLeasePending(leaseId)).toBe(false)
    })
  })
})
