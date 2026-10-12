import { createHash, randomBytes } from 'node:crypto'
import type {
  IActionTargetIdentity,
  IHeldActionRequest,
  ISnapshotResult
} from './types.ts'
import type { OperationCoordinator } from './operation-coordinator.ts'
import { verifyTargetAgainstSnapshot } from './security.ts'

export const HELD_CAPABILITY_HEADER = 'X-Herdr-Held-Capability'
const TTL = 30 * 60 * 1000
interface IHeldRecord {
  id: string
  enqueueOperationId: string
  binding: string
  text: string
  target: IActionTargetIdentity
  expires: number
  state:
    'held' | 'claimed' | 'consumed' | 'uncertain' | 'discarded' | 'invalidated'
  token?: string
}
interface IHeldDeps {
  coordinator: OperationCoordinator
  snapshot: () => Promise<ISnapshotResult>
  ready: (target: IActionTargetIdentity) => Promise<boolean>
  prompt: (paneId: string, text: string) => Promise<unknown>
}
const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  })

/** Process-local inert intent. Records, not the operation cache, own dispatch authority.
 * No scheduler, restoration, connection lease, native cancellation or interrupt owner.
 */
export class HeldQueue {
  private records = new Map<string, IHeldRecord>()
  private binding(capability: string | null, owner: string, origin: string) {
    return capability && /^[a-f0-9]{64}$/.test(capability)
      ? createHash('sha256')
          .update(JSON.stringify([capability, owner, origin]))
          .digest('hex')
      : null
  }
  /** Authenticated bounded read only; operation IDs identify records, never authorize them. */
  read(
    operationIds: string[],
    capability: string | null,
    owner: string,
    origin: string
  ) {
    const binding = this.binding(capability, owner, origin)
    if (!binding)
      return response(403, { ok: false, error: 'Document capability required' })
    const records = [...this.records.values()]
      .filter(
        (record) =>
          record.binding === binding &&
          record.expires > Date.now() &&
          operationIds.includes(record.enqueueOperationId)
      )
      .map((record) => ({
        operationId: record.enqueueOperationId,
        heldId: record.id,
        text: record.text,
        target: { ...record.target },
        state: record.state,
        expiresAt: record.expires
      }))
    return response(200, { ok: true, records })
  }
  async action(
    action: IHeldActionRequest,
    capability: string | null,
    owner: string,
    origin: string,
    deps: IHeldDeps
  ) {
    const binding = this.binding(capability, owner, origin)
    if (!binding)
      return response(403, {
        ok: false,
        outcome: 'rejected',
        error: 'Document capability required'
      })
    for (const [id, record] of this.records) {
      // Active attempts retain token fencing until they settle, but can never dispatch after expiry.
      if (record.expires <= Date.now() && record.state !== 'claimed')
        this.records.delete(id)
    }
    let record =
      action.type === 'held-enqueue'
        ? undefined
        : this.records.get(action.heldId)
    if (
      action.type !== 'held-enqueue' &&
      (!record || record.binding !== binding || record.expires <= Date.now())
    )
      return response(404, {
        ok: false,
        outcome: 'rejected',
        error: 'Held authority unavailable; informational copies cannot send'
      })
    const target =
      action.type === 'held-enqueue' ? action.target : record!.target
    // Binding in fingerprint prevents cached results from crossing document/owner/origin authority.
    const admission = deps.coordinator.beginAction(
      action.operationId,
      {
        topology: 'shared',
        paneId: target.paneId,
        targetKey: target.paneId
      },
      JSON.stringify([binding, action])
    )
    if (admission.kind === 'replay')
      return response(admission.status, admission.body)
    if (admission.kind !== 'admitted')
      return response(admission.status, {
        ok: false,
        outcome: 'rejected',
        error: admission.error
      })
    const token = admission.token
    const complete = (status: number, body: unknown) => {
      deps.coordinator.completeAction(token, status, body)
      return response(status, body)
    }
    if (action.type === 'held-enqueue') {
      const existing = [...this.records.values()].find(
        (item) =>
          item.binding === binding &&
          item.enqueueOperationId === action.operationId
      )
      if (existing) {
        if (
          existing.text !== action.text ||
          JSON.stringify(existing.target) !== JSON.stringify(action.target)
        )
          return complete(409, {
            ok: false,
            outcome: 'rejected',
            error: 'Enqueue operation identity conflict'
          })
        return complete(200, {
          ok: true,
          outcome: 'observed',
          result: {
            heldId: existing.id,
            state: existing.state,
            expiresAt: existing.expires
          }
        })
      }
    }
    if (record && record.state !== 'held')
      return complete(409, {
        ok: false,
        outcome: 'rejected',
        error: 'Held record already claimed or terminal',
        result: { heldId: record.id, state: record.state }
      })
    if (!record) {
      if (
        this.records.size >= 256 ||
        [...this.records.values()].filter((item) => item.binding === binding)
          .length >= 32
      )
        return complete(409, {
          ok: false,
          outcome: 'rejected',
          error: 'Held queue limit reached'
        })
      record = {
        id: randomBytes(32).toString('hex'),
        enqueueOperationId: action.operationId,
        binding,
        text: (action as Extract<IHeldActionRequest, { type: 'held-enqueue' }>)
          .text,
        target: { ...target },
        expires: Date.now() + TTL,
        state: 'claimed',
        token
      }
      this.records.set(record.id, record)
    } else {
      record.state = 'claimed'
      record.token = token
    }
    const held = record
    const settle = (state: IHeldRecord['state']) => {
      if (this.records.get(held.id) === held && held.token === token) {
        held.state = state
        held.token = undefined
      }
    }
    const result = (state: IHeldRecord['state']) => ({
      heldId: held.id,
      state,
      expiresAt: held.expires
    })
    if (action.type === 'held-discard') {
      settle('discarded')
      return complete(200, {
        ok: true,
        outcome: 'observed',
        result: result('discarded')
      })
    }
    let dispatched = false
    try {
      const snapshot = await deps.snapshot()
      const preflight = verifyTargetAgainstSnapshot(snapshot, target, {
        actionType: 'prompt'
      })
      if (!preflight.ok) {
        // A temporary blocked mode is zero-write and can be retried by a NEW explicit click.
        const pane = snapshot.panes.find(
          (item) => item.pane_id === target.paneId
        )
        const identityCheck = verifyTargetAgainstSnapshot(
          snapshot,
          { ...target, expectedMode: 'blocked-agent' },
          { actionType: 'prompt-answer' }
        )
        const state =
          pane?.agent_status === 'blocked' && identityCheck.ok
            ? 'held'
            : 'invalidated'
        if (action.type === 'held-enqueue') this.records.delete(held.id)
        else settle(state)
        return complete(409, {
          ok: false,
          outcome: 'rejected',
          error: preflight.error,
          ...(action.type === 'held-enqueue' ? {} : { result: result(state) })
        })
      }
      if (action.type === 'held-enqueue') {
        settle('held')
        return complete(200, {
          ok: true,
          outcome: 'observed',
          result: result('held')
        })
      }
      if (!(await deps.ready(target))) {
        settle('held')
        return complete(409, {
          ok: false,
          outcome: 'rejected',
          error:
            'Input readiness unavailable or incompatible; inspect Terminal',
          result: result('held')
        })
      }
      // Check target again after asynchronous prompt reading. No await between consumption and IO.
      const fresh = await deps.snapshot()
      if (
        !verifyTargetAgainstSnapshot(fresh, target, { actionType: 'prompt' })
          .ok ||
        held.expires <= Date.now()
      ) {
        settle('invalidated')
        return complete(409, {
          ok: false,
          outcome: 'rejected',
          error: 'Held target changed or expired',
          result: result('invalidated')
        })
      }
      dispatched = true
      held.state = 'uncertain' // consume authority BEFORE possible native write; retain settlement token
      await deps.prompt(target.paneId, held.text)
      settle('consumed')
      return complete(200, {
        ok: true,
        outcome: 'acknowledged',
        result: result('consumed')
      })
    } catch {
      if (!dispatched) {
        if (
          action.type === 'held-enqueue' &&
          this.records.get(held.id) === held &&
          held.token === token
        )
          this.records.delete(held.id)
        else settle('held')
        deps.coordinator.abandonAction(token)
        return response(502, {
          ok: false,
          outcome: 'rejected',
          error:
            'Zero-write preflight failed; attempt abandoned without a retained enqueue',
          ...(action.type === 'held-send' ? { result: result('held') } : {})
        })
      }
      settle('uncertain')
      return complete(502, {
        ok: false,
        outcome: dispatched ? 'unknown' : 'rejected',
        error: dispatched
          ? 'Submission outcome uncertain; inspect Terminal. Never resend this held record.'
          : 'Zero-write preflight failed; held for a new explicit click',
        result: result(dispatched ? 'uncertain' : 'held')
      })
    }
  }
}
