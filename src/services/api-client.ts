import type {
  IActionOutcome,
  IActionRequest,
  IActionResponse,
  IAgentExplainResult,
  IInteractionCatalog,
  IPaneReadResult,
  IPaneReadSource,
  ISnapshotResult,
  ITerminalControlStatusResult
} from '@/types/herdr.ts'
import { parseTerminalControlStatusResponse } from '@/utils/terminal-control-ownership.ts'

export class ActionError extends Error {
  status: number
  outcome?: IActionOutcome
  result?: IActionResponse['result']

  constructor(
    message: string,
    status: number,
    outcome?: IActionOutcome,
    result?: IActionResponse['result']
  ) {
    super(message)
    this.name = 'ActionError'
    this.status = status
    this.outcome = outcome
    this.result = result
  }
}

export class CatalogError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'CatalogError'
    this.status = status
  }
}

export const fetchHealth = async (): Promise<{
  ok: boolean
  version: string
  serverStatus: string
}> => {
  const res = await fetch('/api/health')
  if (!res.ok) {
    throw new Error(`Health check failed with status ${res.status}`)
  }
  return res.json()
}

export const SNAPSHOT_READ_TIMEOUT_MS = 10000

export const fetchSnapshot = async (
  signal?: AbortSignal,
  timeoutMs = SNAPSHOT_READ_TIMEOUT_MS
): Promise<ISnapshotResult> => {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancelled = new Promise<never>((_, reject) => {
    const rejectAbort = () =>
      reject(new DOMException('Snapshot read aborted', 'AbortError'))
    controller.signal.addEventListener('abort', rejectAbort, { once: true })
    if (controller.signal.aborted) rejectAbort()
    timer = setTimeout(abort, timeoutMs)
  })
  try {
    return await Promise.race([
      cancelled,
      (async () => {
        const res = await fetch('/api/snapshot', {
          signal: controller.signal,
          cache: 'no-store'
        })
        if (!res.ok) {
          const errorData = await res
            .json()
            .catch(() => ({ error: `HTTP ${res.status}` }))
          throw new Error(
            errorData.error || `Failed to fetch snapshot (status ${res.status})`
          )
        }
        const data = await res.json()
        if (!data.ok || !data.snapshot) {
          throw new Error(data.error || 'Invalid snapshot payload from server')
        }
        return data.snapshot
      })()
    ])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

const ACTION_OUTCOMES = new Set<IActionOutcome>([
  'acknowledged',
  'observed',
  'rejected',
  'unknown'
])

const isActionResponse = (value: unknown): value is IActionResponse => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  if (typeof data.ok !== 'boolean') return false
  if (
    data.outcome !== undefined &&
    (typeof data.outcome !== 'string' ||
      !ACTION_OUTCOMES.has(data.outcome as IActionOutcome))
  ) {
    return false
  }
  if (data.error !== undefined && typeof data.error !== 'string') return false
  return true
}

const hasStringField = (value: unknown, key: string): boolean =>
  Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>)[key] === 'string'
  )

const hasValidObservedResult = (
  action: IActionRequest,
  response: IActionResponse
): boolean => {
  if (action.type === 'workspace-create') {
    return (
      response.outcome === 'observed' &&
      hasStringField(response.result, 'workspaceId') &&
      hasStringField(response.result, 'tabId') &&
      hasStringField(response.result, 'paneId')
    )
  }
  if (action.type === 'workspace-close') {
    return (
      response.outcome === 'observed' &&
      hasStringField(response.result, 'workspaceId') &&
      response.result?.workspaceId === action.target.workspaceId
    )
  }
  if (action.type === 'tab-close') {
    return (
      response.outcome === 'observed' &&
      response.result?.workspaceId === action.target.workspaceId &&
      response.result?.tabId === action.target.tabId
    )
  }
  if (action.type === 'tab-create') {
    return (
      response.outcome === 'observed' &&
      hasStringField(response.result, 'tabId') &&
      hasStringField(response.result, 'paneId')
    )
  }
  return true
}

export const sendAction = async (
  action: IActionRequest,
  heldCapability?: string
): Promise<IActionResponse> => {
  let res: Response
  try {
    res = await fetch('/api/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(heldCapability ? { 'X-Herdr-Held-Capability': heldCapability } : {})
      },
      body: JSON.stringify(action)
    })
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Action request was aborted before its outcome could be confirmed'
        : 'Action request failed before its outcome could be confirmed'
    throw new ActionError(message, 0, 'unknown')
  }

  let parsed: unknown
  try {
    parsed = await res.json()
  } catch {
    throw new ActionError(
      'Action response was malformed; its outcome could not be confirmed',
      res.status,
      'unknown'
    )
  }

  if (!isActionResponse(parsed)) {
    throw new ActionError(
      'Action response was malformed; its outcome could not be confirmed',
      res.status,
      'unknown'
    )
  }

  if (!res.ok || !parsed.ok) {
    const outcome = parsed.outcome ?? (res.ok ? 'unknown' : 'rejected')
    throw new ActionError(
      parsed.error || `Action failed with status ${res.status}`,
      res.status,
      outcome,
      parsed.result
    )
  }

  if (!parsed.outcome || !hasValidObservedResult(action, parsed)) {
    throw new ActionError(
      'Action response was malformed; its outcome could not be confirmed',
      res.status,
      'unknown'
    )
  }

  return parsed
}

export const readHeldMessages = async (
  operationIds: string[],
  capability: string
): Promise<unknown[]> => {
  const response = await fetch('/api/held/read', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Herdr-Held-Capability': capability
    },
    body: JSON.stringify({ operationIds: operationIds.slice(0, 32) })
  })
  const data: unknown = await response.json()
  if (
    !response.ok ||
    !data ||
    typeof data !== 'object' ||
    !('records' in data) ||
    !Array.isArray(data.records) ||
    data.records.length > 32
  )
    throw new Error(
      'Held evidence refresh unavailable; no delivery was attempted'
    )
  return data.records
}

export const fetchInteractivePrompt = async (
  paneId: string,
  signal?: AbortSignal
): Promise<
  import('../types/interactive-prompt.ts').IInteractivePromptRead & {
    target: import('../types/herdr.ts').IActionTargetIdentity
  }
> => {
  const response = await fetch(
    `/api/pane/prompt?${new URLSearchParams({ pane: paneId })}`,
    { cache: 'no-store', signal }
  )
  if (!response.ok)
    throw new Error(
      'Interactive prompt evidence unavailable; inspect the terminal.'
    )
  return response.json()
}

export const fetchPaneRead = async (
  paneId: string,
  source: IPaneReadSource = 'detection',
  lines?: number
): Promise<IPaneReadResult> => {
  const params = new URLSearchParams({ pane: paneId, source })
  if (lines) {
    params.set('lines', String(lines))
  }
  const res = await fetch(`/api/pane/read?${params.toString()}`)
  if (!res.ok) {
    const errorData = await res
      .json()
      .catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(
      errorData.error || `Failed to read pane (status ${res.status})`
    )
  }
  const data = await res.json()
  if (!data.ok) {
    throw new Error(data.error || 'Invalid pane read payload from server')
  }
  return data
}

export const fetchAgentExplain = async (
  paneId: string,
  signal?: AbortSignal
): Promise<IAgentExplainResult> => {
  const params = new URLSearchParams({ pane: paneId })
  const res = await fetch(`/api/agent/explain?${params.toString()}`, { signal })
  if (!res.ok) {
    const errorData = await res
      .json()
      .catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(
      errorData.error || `Failed to explain agent (status ${res.status})`
    )
  }
  const data = await res.json()
  if (!data.ok) {
    throw new Error(data.error || 'Invalid agent explain payload from server')
  }
  return data
}

export const fetchInteractionCatalog = async (
  paneId: string,
  terminalId: string
): Promise<{ ok: boolean; source: string; catalog: IInteractionCatalog }> => {
  const params = new URLSearchParams({ pane: paneId, terminalId })
  const res = await fetch(`/api/interactions/catalog?${params.toString()}`)
  if (!res.ok) {
    const errorData = await res
      .json()
      .catch(() => ({ error: `HTTP ${res.status}` }))
    throw new CatalogError(
      errorData.error ||
        `Failed to fetch interaction catalog (status ${res.status})`,
      res.status
    )
  }
  const data = await res.json()
  if (!data.ok) {
    throw new CatalogError(
      data.error || 'Invalid interaction catalog payload from server',
      res.status
    )
  }
  return data
}

export const fetchTerminalControlStatus = async (
  paneId: string,
  signal?: AbortSignal
): Promise<ITerminalControlStatusResult> => {
  const params = new URLSearchParams({ pane: paneId })
  const res = await fetch(`/api/terminal/control/status?${params.toString()}`, {
    signal,
    headers: {
      Accept: 'application/json'
    }
  })
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(
      errorBody.error ||
        `Failed to fetch terminal control status: ${res.status}`
    )
  }
  const data: unknown = await res.json()
  return parseTerminalControlStatusResponse(data, paneId)
}
