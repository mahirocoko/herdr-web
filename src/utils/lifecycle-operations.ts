import type {
  IActionResponse,
  IPane,
  ISnapshotResult,
  ITab,
  IWorkspace,
  IWorkspaceCreateSource,
  ILifecycleActionRequest
} from '@/types/herdr.ts'

export const LIFECYCLE_CLOSE_UNKNOWN_COPY = 'Outcome unknown. This may already have closed. Refresh and inspect before another action.'
export const LIFECYCLE_CREATE_UNKNOWN_COPY = 'Outcome unknown. This Space may already have been created. Refresh and inspect before another action.'
export const MAX_LIFECYCLE_MESSAGE_LENGTH = 300

export const getLifecycleUnknownCopy = (type: ILifecycleActionRequest['type']): string =>
  type === 'workspace-create' ? LIFECYCLE_CREATE_UNKNOWN_COPY : LIFECYCLE_CLOSE_UNKNOWN_COPY

export type LifecyclePhase = 'pending' | 'observed' | 'reconciliation-failed' | 'rejected' | 'unknown'

export interface ILifecycleTicket {
  requestIdentity: string
  operationId: string
  type: ILifecycleActionRequest['type']
  target: Readonly<Record<string, unknown>>
  phase: LifecyclePhase
  reconciliationAttempt: number
  error: string | null
  result: IActionResponse['result'] | null
}

export interface ILifecycleState {
  ticket: ILifecycleTicket | null
  latestRequestIdentity: string | null
}

export type LifecycleReducerAction =
  | { type: 'BEGIN'; ticket: ILifecycleTicket }
  | { type: 'SETTLE'; requestIdentity: string; phase: 'observed' | 'rejected' | 'unknown'; error?: string | null; result?: IActionResponse['result'] }
  | { type: 'RECONCILE_FAILED'; requestIdentity: string; attempt: number; error: string }
  | { type: 'RETRY_RECONCILIATION'; requestIdentity: string }
  | { type: 'CLEAR_UNKNOWN_AFTER_REFRESH' }
  | { type: 'CLEAR_OBSERVED'; requestIdentity: string }

export const initialLifecycleState: ILifecycleState = {
  ticket: null,
  latestRequestIdentity: null
}

export const boundLifecycleMessage = (value: unknown, fallback: string): string => {
  const message = typeof value === 'string' && value.trim() ? value.trim() : fallback
  return message.slice(0, MAX_LIFECYCLE_MESSAGE_LENGTH)
}

export const lifecycleReducer = (
  state: ILifecycleState,
  action: LifecycleReducerAction
): ILifecycleState => {
  switch (action.type) {
    case 'BEGIN':
      if (state.ticket && state.ticket.phase !== 'rejected') return state
      return {
        ticket: action.ticket,
        latestRequestIdentity: action.ticket.requestIdentity
      }
    case 'SETTLE':
      if (
        state.latestRequestIdentity !== action.requestIdentity ||
        state.ticket?.requestIdentity !== action.requestIdentity
      ) return state
      return {
        ...state,
        ticket: {
          ...state.ticket,
          phase: action.phase,
          error: action.error ? boundLifecycleMessage(action.error, 'Lifecycle action failed') : null,
          result: action.result ?? null
        }
      }
    case 'RECONCILE_FAILED':
      if (
        state.ticket?.requestIdentity !== action.requestIdentity ||
        state.ticket.reconciliationAttempt !== action.attempt
      ) return state
      return {
        ...state,
        ticket: {
          ...state.ticket,
          phase: 'reconciliation-failed',
          error: boundLifecycleMessage(action.error, 'Refresh and inspect the active session.')
        }
      }
    case 'RETRY_RECONCILIATION':
      if (
        state.ticket?.requestIdentity !== action.requestIdentity ||
        state.ticket.phase !== 'reconciliation-failed'
      ) return state
      return {
        ...state,
        ticket: {
          ...state.ticket,
          phase: 'observed',
          reconciliationAttempt: state.ticket.reconciliationAttempt + 1,
          error: null
        }
      }
    case 'CLEAR_UNKNOWN_AFTER_REFRESH':
      if (state.ticket?.phase !== 'unknown') return state
      return { ...state, ticket: null }
    case 'CLEAR_OBSERVED':
      if (state.ticket?.requestIdentity !== action.requestIdentity || state.ticket.phase !== 'observed') return state
      return { ...state, ticket: null }
    default:
      return state
  }
}

const canonicalIds = (values: string[]): string[] => [...values].sort()

export const workspaceMembershipFingerprint = (
  workspaceId: string,
  tabs: ITab[],
  panes: IPane[]
): string => JSON.stringify({
  workspaceId,
  tabIds: canonicalIds(tabs.filter((tab) => tab.workspace_id === workspaceId).map((tab) => tab.tab_id)),
  paneIds: canonicalIds(panes.filter((pane) => pane.workspace_id === workspaceId).map((pane) => pane.pane_id))
})

export const tabMembershipFingerprint = (
  workspaceId: string,
  tabId: string,
  panes: IPane[]
): string => JSON.stringify({
  workspaceId,
  tabId,
  paneIds: canonicalIds(panes.filter((pane) => pane.workspace_id === workspaceId && pane.tab_id === tabId).map((pane) => pane.pane_id))
})

export interface IWorkspaceCloseConfirmation {
  workspaceId: string
  label: string
  tabCount: number
  paneCount: number
  expected: {
    tabIds: string[]
    paneIds: string[]
  }
  fingerprint: string
}

export interface ITabCloseConfirmation {
  workspaceId: string
  tabId: string
  label: string
  paneCount: number
  expected: {
    paneIds: string[]
  }
  fingerprint: string
}

export const freezeWorkspaceCloseConfirmation = (
  workspace: IWorkspace,
  tabs: ITab[],
  panes: IPane[]
): IWorkspaceCloseConfirmation => {
  const tabIds = canonicalIds(tabs.filter((tab) => tab.workspace_id === workspace.workspace_id).map((tab) => tab.tab_id))
  const paneIds = canonicalIds(panes.filter((pane) => pane.workspace_id === workspace.workspace_id).map((pane) => pane.pane_id))
  return {
    workspaceId: workspace.workspace_id,
    label: boundLifecycleMessage(workspace.label, workspace.workspace_id),
    tabCount: tabIds.length,
    paneCount: paneIds.length,
    expected: { tabIds, paneIds },
    fingerprint: JSON.stringify({ workspaceId: workspace.workspace_id, tabIds, paneIds })
  }
}

export const freezeTabCloseConfirmation = (
  tab: ITab,
  panes: IPane[]
): ITabCloseConfirmation => {
  const paneIds = canonicalIds(panes.filter((pane) => pane.workspace_id === tab.workspace_id && pane.tab_id === tab.tab_id).map((pane) => pane.pane_id))
  return {
    workspaceId: tab.workspace_id,
    tabId: tab.tab_id,
    label: boundLifecycleMessage(tab.label, tab.tab_id),
    paneCount: paneIds.length,
    expected: { paneIds },
    fingerprint: JSON.stringify({ workspaceId: tab.workspace_id, tabId: tab.tab_id, paneIds })
  }
}

export const workspaceConfirmationChanged = (
  confirmation: IWorkspaceCloseConfirmation,
  tabs: ITab[],
  panes: IPane[]
): boolean => confirmation.fingerprint !== workspaceMembershipFingerprint(confirmation.workspaceId, tabs, panes)

export const tabConfirmationChanged = (
  confirmation: ITabCloseConfirmation,
  panes: IPane[]
): boolean => confirmation.fingerprint !== tabMembershipFingerprint(confirmation.workspaceId, confirmation.tabId, panes)

export interface IWorkspaceSourceChoice {
  key: string
  label: string
  source?: IWorkspaceCreateSource
}

export const deriveWorkspaceSourceChoices = (
  workspaces: IWorkspace[],
  panes: IPane[]
): IWorkspaceSourceChoice[] => {
  const workspaceLabels = new Map(workspaces.map((workspace) => [workspace.workspace_id, workspace.label || workspace.workspace_id]))
  const terminalChoices = panes
    .filter((pane) =>
      typeof pane.terminal_id === 'string' &&
      pane.terminal_id.trim().length > 0 &&
      typeof (pane.foreground_cwd || pane.cwd) === 'string' &&
      (pane.foreground_cwd || pane.cwd || '').trim().length > 0
    )
    .sort((a, b) => a.workspace_id.localeCompare(b.workspace_id) || a.pane_id.localeCompare(b.pane_id))
    .map((pane) => {
      const cwd = (pane.foreground_cwd || pane.cwd || '').trim()
      const workspaceLabel = workspaceLabels.get(pane.workspace_id) || pane.workspace_id
      return {
        key: pane.pane_id,
        label: `${workspaceLabel} · ${cwd || pane.pane_id}`,
        source: {
          workspaceId: pane.workspace_id,
          paneId: pane.pane_id,
          terminalId: pane.terminal_id!
        }
      }
    })

  return [
    { key: 'herdr-default', label: 'Herdr default directory' },
    ...terminalChoices
  ]
}

export const resolveWorkspaceSourceSelection = (
  choices: IWorkspaceSourceChoice[],
  selectedKey: string
): { kind: 'default' } | { kind: 'source'; source: IWorkspaceCreateSource } | { kind: 'missing' } => {
  if (selectedKey === 'herdr-default') return { kind: 'default' }
  const choice = choices.find((item) => item.key === selectedKey)
  return choice?.source ? { kind: 'source', source: choice.source } : { kind: 'missing' }
}

export interface ILifecycleNavigationOrigin {
  requestIdentity: string
  pathname: string
  workspaceId: string | null
  paneId: string | null
}

export const shouldApplyCreateResultNavigation = (input: {
  origin: ILifecycleNavigationOrigin | undefined
  requestIdentity: string
  attempt: number
  currentTicket: ILifecycleTicket | null
  currentPathname: string
  currentWorkspaceId: string | null
  currentPaneId: string | null
}): boolean => Boolean(
  input.origin &&
  input.origin.requestIdentity === input.requestIdentity &&
  input.currentTicket?.requestIdentity === input.requestIdentity &&
  input.currentTicket.phase === 'observed' &&
  input.currentTicket.reconciliationAttempt === input.attempt &&
  input.origin.pathname === input.currentPathname &&
  input.origin.workspaceId === input.currentWorkspaceId &&
  input.origin.paneId === input.currentPaneId
)

export const snapshotConfirmsCreatedTarget = (
  snapshot: ISnapshotResult | null,
  result: IActionResponse['result']
): result is { workspaceId: string; tabId: string; paneId: string } => {
  if (!snapshot || !result) return false
  const workspace = snapshot.workspaces.find((item) => item.workspace_id === result.workspaceId)
  const tab = snapshot.tabs.find((item) => item.tab_id === result.tabId && item.workspace_id === result.workspaceId)
  const pane = snapshot.panes.find((item) =>
    item.pane_id === result.paneId &&
    item.workspace_id === result.workspaceId &&
    item.tab_id === result.tabId
  )
  return Boolean(workspace && tab && pane)
}
