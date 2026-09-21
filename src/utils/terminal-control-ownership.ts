import type { ITerminalControlStatusResult } from '../types/herdr.ts'

export type ITerminalControlOwnership = 'idle' | 'engaging' | 'active' | 'releasing'

export interface ITerminalOwnershipTransitionInput {
  current: ITerminalControlOwnership
  action:
    | { type: 'take_control' }
    | { type: 'control_ready' }
    | { type: 'control_error' }
    | { type: 'release_initiated' }
    | { type: 'surface_or_pane_changed' }
    | { type: 'lease_released' }
}

export interface ITerminalOwnershipTransitionResult {
  next: ITerminalControlOwnership
  isFooterExclusive: boolean
}

/**
 * Pure transition state machine for terminal control ownership.
 * Guarantees footer exclusivity during engaging, active, and releasing periods.
 * Any release, error, surface switch, or pane switch after entering control mode
 * enters 'releasing' and holds footer exclusivity until server status explicitly
 * confirms that the lease on that exact pane is released.
 */
export const resolveTerminalOwnershipTransition = ({
  current,
  action
}: ITerminalOwnershipTransitionInput): ITerminalOwnershipTransitionResult => {
  switch (action.type) {
    case 'take_control':
      return {
        next: 'engaging',
        isFooterExclusive: true
      }

    case 'control_ready':
      return {
        next: 'active',
        isFooterExclusive: true
      }

    case 'control_error':
    case 'release_initiated':
    case 'surface_or_pane_changed':
      if (current === 'active' || current === 'engaging' || current === 'releasing') {
        return {
          next: 'releasing',
          isFooterExclusive: true
        }
      }
      return {
        next: 'idle',
        isFooterExclusive: false
      }

    case 'lease_released':
      return {
        next: 'idle',
        isFooterExclusive: false
      }
  }
}

export interface IControlStatusEvaluationParams {
  currentGeneration: number
  activeGeneration: number
  targetPaneId: string
  statusResult: { ok: boolean; pane: string; leased: boolean; status?: string | null } | null
  fetchError?: unknown
}

export type IControlStatusNextStep =
  | { action: 'ignore_stale' }
  | { action: 'remain_releasing'; reason: 'leased' | 'error' | 'pane_mismatch' }
  | { action: 'transition_to_idle' }

/**
 * Pure evaluation helper for terminal control release status polling.
 * - Cancels stale responses where generation has moved on
 * - Remains releasing if fetch throws, returns error, or pane mismatches
 * - Remains releasing if server reports leased: true (including active or quarantined release)
 * - Transitions to idle only when server explicitly returns ok: true, matching pane, and leased: false
 */
export const evaluateControlStatusResponse = ({
  currentGeneration,
  activeGeneration,
  targetPaneId,
  statusResult,
  fetchError
}: IControlStatusEvaluationParams): IControlStatusNextStep => {
  if (currentGeneration !== activeGeneration) {
    return { action: 'ignore_stale' }
  }
  if (fetchError || !statusResult || !statusResult.ok) {
    return { action: 'remain_releasing', reason: 'error' }
  }
  if (statusResult.pane !== targetPaneId) {
    return { action: 'remain_releasing', reason: 'pane_mismatch' }
  }
  if (statusResult.leased) {
    return { action: 'remain_releasing', reason: 'leased' }
  }
  return { action: 'transition_to_idle' }
}

/**
 * Derives compact user-facing footer notice copy for non-idle control ownership states.
 */
export const getTerminalControlFooterNotice = (
  ownership: ITerminalControlOwnership
): string | null => {
  switch (ownership) {
    case 'engaging':
      return 'Connecting terminal control session...'
    case 'active':
      return 'Shell input is active in Stream terminal. Direct typing enabled.'
    case 'releasing':
      return 'Releasing terminal control session...'
    case 'idle':
      return null
  }
}

/**
 * Evaluates whether a pane switch should trigger parent navigation fallback release.
 * Releases ONLY on an actual selectedPaneId change while ownership is engaging or active.
 * Unchanged pane or non-controlling ownership never triggers release.
 */
export const shouldReleaseControlOnPaneChange = (
  prevPaneId: string | null,
  currentPaneId: string | null,
  ownership: ITerminalControlOwnership
): boolean => {
  if (ownership !== 'active' && ownership !== 'engaging') {
    return false
  }
  return prevPaneId !== null && prevPaneId !== currentPaneId
}

/**
 * Evaluates whether a surface mode change should trigger parent navigation fallback release.
 * Releases ONLY on an actual transition away from 'stream' while ownership is engaging or active.
 * Unchanged surface mode, transitions not leaving stream, or non-controlling ownership never triggers release.
 */
export const shouldReleaseControlOnViewChange = (
  prevViewMode: string,
  currentViewMode: string,
  ownership: ITerminalControlOwnership
): boolean => {
  if (ownership !== 'active' && ownership !== 'engaging') {
    return false
  }
  return prevViewMode !== currentViewMode && prevViewMode === 'stream' && currentViewMode !== 'stream'
}

export interface IControlNavigationFallbackParams {
  prevPaneId: string | null
  currentPaneId: string | null
  prevViewMode: string
  currentViewMode: string
  ownership: ITerminalControlOwnership
}

/**
 * Pure fallback predicate combining pane switch and surface mode transition checks.
 * Returns true only when an actual navigation away from current stream pane occurs while
 * terminal control ownership is engaging or active.
 */
export const shouldReleaseControlOnNavigation = ({
  prevPaneId,
  currentPaneId,
  prevViewMode,
  currentViewMode,
  ownership
}: IControlNavigationFallbackParams): boolean => {
  return (
    shouldReleaseControlOnPaneChange(prevPaneId, currentPaneId, ownership) ||
    shouldReleaseControlOnViewChange(prevViewMode, currentViewMode, ownership)
  )
}

/**
 * Pure parser/validator for raw terminal control status JSON response.
 * Requires:
 * - non-null, non-array object
 * - ok === true
 * - pane === expectedPaneId
 * - leased is boolean
 * - status in 'pending' | 'active' | 'releasing' | null
 * - consistent pairs:
 *     leased === true => status in 'pending' | 'active' | 'releasing' (non-null allowed lease state)
 *     leased === false => status === null
 * Throws Error on any malformed, missing, or mismatched field so callers catch and remain in 'releasing'.
 */
export const parseTerminalControlStatusResponse = (
  data: unknown,
  expectedPaneId: string
): ITerminalControlStatusResult => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Terminal control status response must be a JSON object')
  }

  const record = data as Record<string, unknown>

  if (record.ok !== true) {
    throw new Error('Terminal control status response ok must be true')
  }

  if (typeof record.pane !== 'string' || record.pane !== expectedPaneId) {
    throw new Error(
      `Terminal control status response pane mismatch: expected "${expectedPaneId}", got "${String(record.pane)}"`
    )
  }

  if (typeof record.leased !== 'boolean') {
    throw new Error('Terminal control status response leased must be a boolean')
  }

  const allowedStatuses = new Set(['pending', 'active', 'releasing'])

  if (record.leased) {
    if (typeof record.status !== 'string' || !allowedStatuses.has(record.status)) {
      throw new Error(
        `Terminal control status response leased is true but status is invalid: "${String(record.status)}"`
      )
    }
  } else {
    if (record.status !== null) {
      throw new Error(
        `Terminal control status response leased is false but status is not null: "${String(record.status)}"`
      )
    }
  }

  return {
    ok: true,
    pane: expectedPaneId,
    leased: record.leased,
    status: record.status as 'pending' | 'active' | 'releasing' | null
  }
}

/**
 * Resolves the stable controlled-pane identity to notify for ownership transitions.
 * Prefers an explicit override, then the captured control pane ref, falling back to
 * current pane ID only if no control pane was captured.
 */
export const resolveControlledPaneIdentity = (
  capturedPaneId: string | null | undefined,
  fallbackPaneId?: string | null,
  overridePaneId?: string | null
): string | undefined => {
  return (overridePaneId || capturedPaneId || fallbackPaneId || undefined) ?? undefined
}

/**
 * Resolves the only pane that may back a live Control socket.
 * Never falls through to the current selected pane during a prop transition: a Control
 * connection may use only the pane captured by the explicit Take Control action.
 */
export const resolveTerminalControlConnectionPane = (
  mode: 'observer' | 'control',
  isAgentPane: boolean,
  capturedPaneId: string | null | undefined
): string | null => {
  if (mode !== 'control' || isAgentPane || !capturedPaneId) return null
  return capturedPaneId
}

export interface ILateControlOwnershipCheckParams {
  nextOwnership: ITerminalControlOwnership
  notifiedPaneId?: string | null
  currentSelectedPaneId: string | null
  currentViewMode: string
}

/**
 * Evaluates whether an incoming engaging or active ownership notification is late/stale.
 * A notification is late if its exact pane no longer matches currentSelectedPaneId,
 * OR if the current view surface is no longer 'stream'.
 */
export const isLateControlOwnershipCallback = ({
  nextOwnership,
  notifiedPaneId,
  currentSelectedPaneId,
  currentViewMode
}: ILateControlOwnershipCheckParams): boolean => {
  if (nextOwnership !== 'engaging' && nextOwnership !== 'active') {
    return false
  }
  const isPaneMismatch = Boolean(notifiedPaneId && notifiedPaneId !== currentSelectedPaneId)
  const isNotStream = currentViewMode !== 'stream'
  return isPaneMismatch || isNotStream
}
