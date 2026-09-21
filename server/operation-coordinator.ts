import type { IActionRequest } from './types.ts'

export interface ICachedOperation {
  operationId: string
  targetKey: string
  payloadFingerprint: string
  status: number
  body: any
  createdAt: number
}

export interface IActiveAttempt {
  token: string
  operationId: string
  paneId: string
  payloadFingerprint: string
  createdAt: number
}

export interface IPaneClaim {
  paneId: string
  token: string
  kind: 'action' | 'control'
  ownerId: string
  createdAt: number
}

export const DEFAULT_OPERATION_TTL_MS = 60 * 1000 // 1 minute bounded TTL
export const MAX_CACHED_OPERATIONS = 1000 // 1000 bounded entries

export const computePayloadFingerprint = (action: IActionRequest): string => {
  if (action.type === 'prompt' || action.type === 'terminal-input') {
    return JSON.stringify({
      type: action.type,
      target: {
        paneId: action.target.paneId,
        terminalId: action.target.terminalId,
        expectedMode: action.target.expectedMode,
        agentSessionId: action.target.agentSessionId ?? null
      },
      text: action.text
    })
  }

  if (action.type === 'keys') {
    return JSON.stringify({
      type: action.type,
      target: {
        paneId: action.target.paneId,
        terminalId: action.target.terminalId,
        expectedMode: action.target.expectedMode,
        agentSessionId: action.target.agentSessionId ?? null
      },
      keys: action.keys
    })
  }

  if (action.type === 'tab-create') {
    return JSON.stringify({
      type: action.type,
      workspaceId: action.workspaceId,
      target: {
        paneId: action.target.paneId,
        terminalId: action.target.terminalId
      },
      label: action.label ?? null
    })
  }

  return JSON.stringify(action)
}

export type BeginActionResult =
  | { kind: 'replay'; status: number; body: any }
  | { kind: 'conflict'; status: number; error: string }
  | { kind: 'in_flight'; status: number; error: string }
  | { kind: 'contention'; status: number; error: string }
  | { kind: 'admitted'; token: string }

export class OperationCoordinator {
  private activeAttempts = new Map<string, IActiveAttempt>() // token -> IActiveAttempt
  private activeOperationIds = new Map<string, { token: string; payloadFingerprint: string; paneId: string }>() // operationId -> info
  private paneClaims = new Map<string, IPaneClaim>() // paneId -> IPaneClaim
  private cachedOperations = new Map<string, ICachedOperation>() // operationId -> ICachedOperation (genuine LRU)
  private readonly ttlMs: number
  private readonly maxEntries: number

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_OPERATION_TTL_MS
    this.maxEntries = options.maxEntries ?? MAX_CACHED_OPERATIONS
  }

  /**
   * Synchronous admission arbiter before ANY await in the action route.
   * Atomically:
   * 1. Replays exact cached result (refreshing LRU order).
   * 2. Conflicts on cached/active same operationId with different fingerprint.
   * 3. Returns in-flight on exact active ID.
   * 4. Returns pane contention for different owner (action or control).
   * 5. Otherwise reserves operation ID and physical pane with opaque attempt token.
   */
  public beginAction(
    operationId: string,
    paneId: string,
    payloadFingerprint: string
  ): BeginActionResult {
    const now = Date.now()

    // 1. Check completed cache
    const cached = this.cachedOperations.get(operationId)
    if (cached) {
      if (now - cached.createdAt > this.ttlMs) {
        this.cachedOperations.delete(operationId)
      } else {
        if (cached.payloadFingerprint !== payloadFingerprint) {
          return {
            kind: 'conflict',
            status: 409,
            error: `Operation ID reuse conflict: operation "${operationId}" was previously submitted with a different payload`
          }
        }
        // Genuine LRU touch on hit: re-insert at end of Map
        this.cachedOperations.delete(operationId)
        this.cachedOperations.set(operationId, cached)
        return {
          kind: 'replay',
          status: cached.status,
          body: cached.body
        }
      }
    }

    // 2. Check active in-flight operation IDs
    const active = this.activeOperationIds.get(operationId)
    if (active) {
      if (active.payloadFingerprint !== payloadFingerprint) {
        return {
          kind: 'conflict',
          status: 409,
          error: `Operation ID reuse conflict: operation "${operationId}" is currently in-flight with a different payload`
        }
      }
      return {
        kind: 'in_flight',
        status: 409,
        error: `Operation with ID "${operationId}" is already in-flight`
      }
    }

    // 3. Check physical pane claim (shared with Terminal Control and other actions)
    const existingClaim = this.paneClaims.get(paneId)
    if (existingClaim) {
      if (existingClaim.kind === 'control') {
        return {
          kind: 'contention',
          status: 409,
          error: 'Cannot perform action: pane is currently controlled by a terminal control session'
        }
      }
      return {
        kind: 'contention',
        status: 409,
        error: `A mutation is already in-flight for terminal target "${paneId}"`
      }
    }

    // 4. Reserve operation ID and pane with opaque attempt token
    const token = crypto.randomUUID()
    const attempt: IActiveAttempt = {
      token,
      operationId,
      paneId,
      payloadFingerprint,
      createdAt: now
    }

    this.activeAttempts.set(token, attempt)
    this.activeOperationIds.set(operationId, { token, payloadFingerprint, paneId })
    this.paneClaims.set(paneId, {
      paneId,
      token,
      kind: 'action',
      ownerId: operationId,
      createdAt: now
    })

    return { kind: 'admitted', token }
  }

  /**
   * Completes an action attempt: stores terminal result into genuine LRU cache,
   * then frees operationId and pane claim.
   * Only matching attempt token may complete.
   */
  public completeAction(
    token: string,
    status: number,
    body: any
  ): boolean {
    const attempt = this.activeAttempts.get(token)
    if (!attempt) {
      return false
    }

    const targetKey = `${attempt.paneId}`
    // Store terminal result before releasing claim
    this.cacheResult(attempt.operationId, targetKey, attempt.payloadFingerprint, status, body)

    // Release claim
    this.activeAttempts.delete(token)
    if (this.activeOperationIds.get(attempt.operationId)?.token === token) {
      this.activeOperationIds.delete(attempt.operationId)
    }
    if (this.paneClaims.get(attempt.paneId)?.token === token) {
      this.paneClaims.delete(attempt.paneId)
    }

    return true
  }

  /**
   * Abandons an action attempt WITHOUT caching (e.g. on snapshot fetch failure / 502),
   * so the same operation ID may later succeed.
   * Only matching attempt token may abandon.
   */
  public abandonAction(token: string): boolean {
    const attempt = this.activeAttempts.get(token)
    if (!attempt) {
      return false
    }

    this.activeAttempts.delete(token)
    if (this.activeOperationIds.get(attempt.operationId)?.token === token) {
      this.activeOperationIds.delete(attempt.operationId)
    }
    if (this.paneClaims.get(attempt.paneId)?.token === token) {
      this.paneClaims.delete(attempt.paneId)
    }

    return true
  }

  /**
   * Terminal Control pane claim acquisition.
   * Holds claim through release lifecycle.
   */
  public claimPaneForControl(
    paneId: string,
    leaseId: string
  ): { ok: true; token: string } | { ok: false; status: number; error: string } {
    const existingClaim = this.paneClaims.get(paneId)
    if (existingClaim) {
      if (existingClaim.kind === 'control') {
        return {
          ok: false,
          status: 409,
          error: 'A terminal control session is already active or pending'
        }
      }
      return {
        ok: false,
        status: 409,
        error: `A mutation is already in-flight for pane "${paneId}"`
      }
    }

    const token = crypto.randomUUID()
    this.paneClaims.set(paneId, {
      paneId,
      token,
      kind: 'control',
      ownerId: leaseId,
      createdAt: Date.now()
    })

    return { ok: true, token }
  }

  /**
   * Releases a Terminal Control pane claim by matching attempt token.
   */
  public releaseControlPane(token: string): boolean {
    for (const [paneId, claim] of this.paneClaims.entries()) {
      if (claim.token === token && claim.kind === 'control') {
        this.paneClaims.delete(paneId)
        return true
      }
    }
    return false
  }

  public isPaneClaimed(paneId: string): boolean {
    return this.paneClaims.has(paneId)
  }

  private cacheResult(
    operationId: string,
    targetKey: string,
    payloadFingerprint: string,
    status: number,
    body: any
  ): void {
    const now = Date.now()
    this.pruneExpired(now)

    // If entry exists, remove to refresh insertion order (LRU)
    if (this.cachedOperations.has(operationId)) {
      this.cachedOperations.delete(operationId)
    } else if (this.cachedOperations.size >= this.maxEntries) {
      // Evict least recently used (first inserted in Map order)
      const oldestKey = this.cachedOperations.keys().next().value
      if (oldestKey !== undefined) {
        this.cachedOperations.delete(oldestKey)
      }
    }

    this.cachedOperations.set(operationId, {
      operationId,
      targetKey,
      payloadFingerprint,
      status,
      body,
      createdAt: now
    })
  }

  private pruneExpired(now: number): void {
    for (const [id, entry] of this.cachedOperations.entries()) {
      if (now - entry.createdAt > this.ttlMs) {
        this.cachedOperations.delete(id)
      }
    }
  }

  // --- Read-only test inspectors (no unrestricted write path) ---

  public getCachedOperationForTesting(operationId: string): ICachedOperation | undefined {
    return this.cachedOperations.get(operationId)
  }

  public getActiveAttemptsCountForTesting(): number {
    return this.activeAttempts.size
  }

  public getActiveOperationIdsCountForTesting(): number {
    return this.activeOperationIds.size
  }

  public getPaneClaimsCountForTesting(): number {
    return this.paneClaims.size
  }

  public resetForTesting(): void {
    this.activeAttempts.clear()
    this.activeOperationIds.clear()
    this.paneClaims.clear()
    this.cachedOperations.clear()
  }
}

let sharedCoordinator: OperationCoordinator | null = null

export const getSharedOperationCoordinator = (): OperationCoordinator => {
  if (!sharedCoordinator) {
    sharedCoordinator = new OperationCoordinator()
  }
  return sharedCoordinator
}
