import type {
  IActionTargetIdentity,
  IExpectedPaneMode,
  IPane,
  ITab,
  IWorkspace
} from '@/types/herdr.ts'
import { isAgentPane } from './workspace-helpers.ts'

export interface IDeriveActionTargetResult {
  target: IActionTargetIdentity | null
  error?: string
}

/**
 * Derives the exact action target identity from a selected pane and snapshot agents,
 * matching server canonical agent evidence.
 *
 * Rules:
 * 1. Requires valid pane_id.
 * 2. Requires terminal_id; missing identity disables mutations with truthful refresh guidance.
 * 3. expectedMode: 'blocked-agent' when blocked agent-owned, 'agent' for other agent-owned, 'shell' otherwise.
 * 4. agentSessionId: authoritative session ID when present from pane or snapshot agents (agent modes only; omitted for shell).
 */
export const deriveActionTarget = (
  pane?: Partial<IPane> | null,
  snapshotAgents?: any[] | null
): IDeriveActionTargetResult => {
  if (!pane || !pane.pane_id) {
    return { target: null, error: 'No pane selected' }
  }

  const terminalId = pane.terminal_id ? pane.terminal_id.trim() : ''
  if (!terminalId) {
    return {
      target: null,
      error: 'Terminal identity missing for this pane. Refresh snapshot to retry.'
    }
  }

  const isAgent = isAgentPane(pane, snapshotAgents)
  const expectedMode: IExpectedPaneMode = isAgent
    ? pane.agent_status === 'blocked'
      ? 'blocked-agent'
      : 'agent'
    : 'shell'

  let agentSessionId: string | undefined
  if (expectedMode === 'agent' || expectedMode === 'blocked-agent') {
    const paneSession = pane.agent_session
    const agents = snapshotAgents || []
    const owningAgent = agents.find(
      (a: any) => a && (a.target === pane.pane_id || a.pane_id === pane.pane_id)
    )

    const rawSessionId =
      paneSession?.value ??
      (paneSession as any)?.id ??
      owningAgent?.agent_session?.value ??
      owningAgent?.agent_session?.id

    if (typeof rawSessionId === 'string' && rawSessionId.trim().length > 0) {
      agentSessionId = rawSessionId.trim()
    }
  }

  return {
    target: {
      paneId: pane.pane_id,
      terminalId,
      expectedMode,
      ...(agentSessionId ? { agentSessionId } : {})
    }
  }
}

export interface ITabCreateSourceChoice {
  pane: IPane
  displayCwd: string
}

/**
 * Derives approved CWD choices for New Shell Tab solely from unique exact panes
 * in the destination Space with valid terminal identities.
 * Deduplicates by unique CWD while preserving source pane identity.
 */
export const deriveTabCreateSourcePanes = (
  panes: IPane[],
  workspaceId: string,
  preferredPaneId?: string | null
): ITabCreateSourceChoice[] => {
  const spacePanes = panes.filter(
    (p) => p.workspace_id === workspaceId && Boolean(p.terminal_id && p.terminal_id.trim())
  )

  if (spacePanes.length === 0) {
    return []
  }

  const seenCwds = new Set<string>()
  const choices: ITabCreateSourceChoice[] = []

  // If preferredPaneId belongs to this Space and has a unique CWD, ensure it's evaluated first
  const preferredPane = preferredPaneId
    ? spacePanes.find((p) => p.pane_id === preferredPaneId)
    : undefined

  const orderedPanes: IPane[] = preferredPane
    ? [preferredPane, ...spacePanes.filter((p) => p.pane_id !== preferredPane.pane_id)]
    : spacePanes

  for (const p of orderedPanes) {
    const displayCwd = (p.foreground_cwd || p.cwd || '/').trim()
    if (!seenCwds.has(displayCwd)) {
      seenCwds.add(displayCwd)
      choices.push({ pane: p, displayCwd })
    }
  }

  return choices
}

/**
 * Deterministically orders blocked panes for the Attention Horizon queue:
 * 1. Current Space first
 * 2. Deterministic workspace.number, tab.number, and pane_id order
 */
export const orderBlockedPanes = (
  blockedPanes: IPane[],
  currentWorkspaceId: string,
  workspaces: IWorkspace[] = [],
  tabs: ITab[] = []
): IPane[] => {
  const wsMap = new Map<string, IWorkspace>()
  for (const ws of workspaces) {
    wsMap.set(ws.workspace_id, ws)
  }

  const tabMap = new Map<string, ITab>()
  for (const tab of tabs) {
    tabMap.set(tab.tab_id, tab)
  }

  return [...blockedPanes].sort((a, b) => {
    const isACurrent = a.workspace_id === currentWorkspaceId ? 0 : 1
    const isBCurrent = b.workspace_id === currentWorkspaceId ? 0 : 1
    if (isACurrent !== isBCurrent) {
      return isACurrent - isBCurrent
    }

    const wsA = wsMap.get(a.workspace_id)
    const wsB = wsMap.get(b.workspace_id)
    const wsNumA = wsA?.number ?? Number.MAX_SAFE_INTEGER
    const wsNumB = wsB?.number ?? Number.MAX_SAFE_INTEGER
    if (wsNumA !== wsNumB) {
      return wsNumA - wsNumB
    }

    const tabA = tabMap.get(a.tab_id)
    const tabB = tabMap.get(b.tab_id)
    const tabNumA = tabA?.number ?? Number.MAX_SAFE_INTEGER
    const tabNumB = tabB?.number ?? Number.MAX_SAFE_INTEGER
    if (tabNumA !== tabNumB) {
      return tabNumA - tabNumB
    }

    return a.pane_id.localeCompare(b.pane_id)
  })
}

/**
 * Formats user-facing error messages for actions.
 * If outcome is unknown, renders truthful inspection copy without auto-retry.
 */
export const formatActionErrorMessage = (err: unknown): string => {
  if (err && typeof err === 'object') {
    if ('outcome' in err && (err as any).outcome === 'unknown') {
      return 'Outcome unknown — inspect the pane before sending again.'
    }
    if ('message' in err && typeof (err as any).message === 'string') {
      return (err as any).message
    }
  }
  return err instanceof Error ? err.message : String(err)
}

export interface INewTabSubmitGating {
  isCreatingTab: boolean
  hasChoices: boolean
  createTabOutcome: string | null
}

/**
 * Pure submit gating helper for New Shell Tab form:
 * - Disabled while creation is in-flight.
 * - Disabled when no source panes/choices are available.
 * - Strictly disabled/hidden when createTabOutcome is 'unknown' to prevent accidental in-place retry.
 */
export const canSubmitNewTab = ({
  isCreatingTab,
  hasChoices,
  createTabOutcome
}: INewTabSubmitGating): boolean => {
  if (isCreatingTab) return false
  if (!hasChoices) return false
  if (createTabOutcome === 'unknown') return false
  return true
}

/**
 * Pure focus target resolver for Attention Queue sheet closure:
 * - If action trigger exists and is connected in DOM, return it.
 * - Otherwise fallback to deterministic existing owner (e.g. drawer trigger).
 */
export const resolveAttentionCloseFocusTarget = (
  actionTriggerEl?: HTMLElement | null,
  fallbackEl?: HTMLElement | null
): HTMLElement | null => {
  if (actionTriggerEl && (actionTriggerEl.isConnected ?? true)) {
    return actionTriggerEl
  }
  if (fallbackEl && (fallbackEl.isConnected ?? true)) {
    return fallbackEl
  }
  return null
}
