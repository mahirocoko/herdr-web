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

  constructor(message: string, status: number, outcome?: IActionOutcome) {
    super(message)
    this.name = 'ActionError'
    this.status = status
    this.outcome = outcome
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

export const fetchHealth = async (): Promise<{ ok: boolean; version: string; serverStatus: string }> => {
  const res = await fetch('/api/health')
  if (!res.ok) {
    throw new Error(`Health check failed with status ${res.status}`)
  }
  return res.json()
}

export const fetchSnapshot = async (): Promise<ISnapshotResult> => {
  const res = await fetch('/api/snapshot')
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(errorData.error || `Failed to fetch snapshot (status ${res.status})`)
  }
  const data = await res.json()
  if (!data.ok || !data.snapshot) {
    throw new Error(data.error || 'Invalid snapshot payload from server')
  }
  return data.snapshot
}

export const sendAction = async (action: IActionRequest): Promise<IActionResponse> => {
  const res = await fetch('/api/action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(action)
  })

  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
  if (!res.ok || !data.ok) {
    const outcome: IActionOutcome | undefined =
      data.outcome ?? (res.status === 504 || res.status === 502 ? 'unknown' : 'rejected')
    const message = data.error || `Action failed with status ${res.status}`
    throw new ActionError(message, res.status, outcome)
  }
  return data
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
    const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(errorData.error || `Failed to read pane (status ${res.status})`)
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
    const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(errorData.error || `Failed to explain agent (status ${res.status})`)
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
    const errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new CatalogError(errorData.error || `Failed to fetch interaction catalog (status ${res.status})`, res.status)
  }
  const data = await res.json()
  if (!data.ok) {
    throw new CatalogError(data.error || 'Invalid interaction catalog payload from server', res.status)
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
    throw new Error(errorBody.error || `Failed to fetch terminal control status: ${res.status}`)
  }
  const data: unknown = await res.json()
  return parseTerminalControlStatusResponse(data, paneId)
}
