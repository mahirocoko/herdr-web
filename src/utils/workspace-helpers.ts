import type { IPane, ISnapshotResult, ITab } from '@/types/herdr.ts'

export interface ITabWithPanes {
  tab: ITab | null
  panes: IPane[]
}

/**
 * Format authoritative tab label for display.
 * tab.label is authoritative; presents the role separately (e.g. 'Tab · <label>').
 */
export const formatTabLabel = (tab?: ITab | null): string => {
  if (!tab) return ''
  const cleanLabel = tab.label ? tab.label.trim() : ''
  if (cleanLabel) {
    return `Tab · ${cleanLabel}`
  }
  return `Tab ${tab.number}`
}

/**
 * Group panes under their actual tabs ordered by tab number.
 * Handles missing/orphan tab data gracefully.
 */
export const groupPanesByTab = (
  tabs: ITab[],
  panes: IPane[],
  workspaceId?: string | null
): ITabWithPanes[] => {
  const targetPanes = workspaceId
    ? panes.filter((p) => p.workspace_id === workspaceId)
    : panes

  const targetTabs = workspaceId
    ? tabs.filter((t) => t.workspace_id === workspaceId)
    : tabs

  const sortedTabs = [...targetTabs].sort((a, b) => a.number - b.number)

  const tabIdSet = new Set<string>()
  const groups: ITabWithPanes[] = []

  for (const tab of sortedTabs) {
    tabIdSet.add(tab.tab_id)
    const tabPanes = targetPanes.filter((p) => p.tab_id === tab.tab_id)
    groups.push({
      tab,
      panes: tabPanes
    })
  }

  // Find any orphan panes (panes whose tab_id does not match any tab in tabs)
  const orphanPanes = targetPanes.filter((p) => !tabIdSet.has(p.tab_id))
  if (orphanPanes.length > 0) {
    groups.push({
      tab: null,
      panes: orphanPanes
    })
  }

  return groups
}

/**
 * Atomically selects the best pane for a given workspace:
 * 1. Blocked agent first
 * 2. Focused pane next
 * 3. First pane in workspace
 */
export const selectBestPaneForWorkspace = (
  panes: IPane[],
  workspaceId: string,
  focusedPaneId?: string | null
): IPane | null => {
  const wsPanes = panes.filter((p) => p.workspace_id === workspaceId)
  if (wsPanes.length === 0) return null

  // 1. Blocked agent first
  const blocked = wsPanes.find((p) => p.agent_status === 'blocked')
  if (blocked) return blocked

  // 2. Focused pane next
  if (focusedPaneId) {
    const focused = wsPanes.find((p) => p.pane_id === focusedPaneId)
    if (focused) return focused
  }
  const focusedInWs = wsPanes.find((p) => p.focused)
  if (focusedInWs) return focusedInWs

  // 3. First pane in workspace
  return wsPanes[0]
}

const selectPaneFromTab = (panes: IPane[], tabId?: string | null): IPane | null => {
  if (!tabId) return null
  const tabPanes = panes.filter((pane) => pane.tab_id === tabId)
  return tabPanes.find((pane) => pane.focused) || tabPanes[0] || null
}

const selectPaneFromWorkspaceFocus = (
  snapshot: ISnapshotResult,
  workspaceId?: string | null
): IPane | null => {
  if (!workspaceId) return null

  const workspace = snapshot.workspaces.find((item) => item.workspace_id === workspaceId)
  const activeTabPane = selectPaneFromTab(snapshot.panes, workspace?.active_tab_id)
  if (activeTabPane?.workspace_id === workspaceId) return activeTabPane

  const focusedTab = snapshot.tabs.find(
    (tab) => tab.workspace_id === workspaceId && tab.focused
  )
  const focusedTabPane = selectPaneFromTab(snapshot.panes, focusedTab?.tab_id)
  if (focusedTabPane) return focusedTabPane

  const workspacePanes = snapshot.panes.filter((pane) => pane.workspace_id === workspaceId)
  return workspacePanes.find((pane) => pane.focused) || workspacePanes[0] || null
}

/**
 * Resolve Herdr's authoritative focus chain for initial browser selection.
 * Root snapshot IDs win, followed by focused item flags and active workspace fallback.
 */
export const selectFocusedPaneFromSnapshot = (snapshot: ISnapshotResult): IPane | null => {
  if (snapshot.focused_pane_id) {
    const pane = snapshot.panes.find((item) => item.pane_id === snapshot.focused_pane_id)
    if (pane) return pane
  }

  const explicitTabPane = selectPaneFromTab(snapshot.panes, snapshot.focused_tab_id)
  if (explicitTabPane) return explicitTabPane

  const explicitWorkspacePane = selectPaneFromWorkspaceFocus(
    snapshot,
    snapshot.focused_workspace_id
  )
  if (explicitWorkspacePane) return explicitWorkspacePane

  const focusedPane = snapshot.panes.find((pane) => pane.focused)
  if (focusedPane) return focusedPane

  const focusedTab = snapshot.tabs.find((tab) => tab.focused)
  const focusedTabPane = selectPaneFromTab(snapshot.panes, focusedTab?.tab_id)
  if (focusedTabPane) return focusedTabPane

  const focusedWorkspace = snapshot.workspaces.find((workspace) => workspace.focused)
  const focusedWorkspacePane = selectPaneFromWorkspaceFocus(
    snapshot,
    focusedWorkspace?.workspace_id
  )
  if (focusedWorkspacePane) return focusedWorkspacePane

  return selectPaneFromWorkspaceFocus(snapshot, snapshot.active_workspace_id)
}

/**
 * Canonical helper for determining whether a pane is owned by an agent.
 * Considers selected pane agent, display_agent, agent_session, plus
 * snapshot agents matching pane_id or target.
 * Fails closed on any meaningful agent ownership evidence.
 */
export interface IReconciledSelection {
  workspaceId: string | null
  paneId: string | null
}

export const reconcileSnapshotSelection = (
  snapshot: ISnapshotResult,
  currentWorkspaceId: string | null,
  currentPaneId: string | null
): IReconciledSelection => {
  if (snapshot.workspaces.length === 0 || snapshot.panes.length === 0) {
    return { workspaceId: null, paneId: null }
  }

  const currentWorkspaceExists = Boolean(
    currentWorkspaceId && snapshot.workspaces.some((workspace) => workspace.workspace_id === currentWorkspaceId)
  )
  const currentPane = currentPaneId
    ? snapshot.panes.find((pane) => pane.pane_id === currentPaneId)
    : undefined

  if (currentWorkspaceExists && currentPane?.workspace_id === currentWorkspaceId) {
    return { workspaceId: currentWorkspaceId, paneId: currentPane.pane_id }
  }

  if (currentWorkspaceExists && currentWorkspaceId) {
    const sameWorkspacePane = selectBestPaneForWorkspace(snapshot.panes, currentWorkspaceId, snapshot.focused_pane_id)
    if (sameWorkspacePane) {
      return { workspaceId: currentWorkspaceId, paneId: sameWorkspacePane.pane_id }
    }
  }

  const focusedPane = selectFocusedPaneFromSnapshot(snapshot)
  if (focusedPane) {
    return { workspaceId: focusedPane.workspace_id, paneId: focusedPane.pane_id }
  }

  const blockedPane = snapshot.panes.find((pane) => pane.agent_status === 'blocked')
  const fallbackPane = blockedPane || snapshot.panes[0]
  return { workspaceId: fallbackPane.workspace_id, paneId: fallbackPane.pane_id }
}

export const isAgentPane = (
  pane?: Partial<IPane> | null,
  snapshotAgents?: any[] | null
): boolean => {
  if (!pane) return false

  // 1. pane.agent (case-insensitive, ignores 'shell')
  const agent = (pane.agent || '').trim()
  if (agent.length > 0 && agent.toLowerCase() !== 'shell') {
    return true
  }

  // 2. pane.display_agent (case-insensitive, ignores 'shell')
  const displayAgent = (pane.display_agent || '').trim()
  if (displayAgent.length > 0 && displayAgent.toLowerCase() !== 'shell') {
    return true
  }

  // 3. pane.agent_session (truthy check for session presence)
  const agentSession = (pane as any).agent_session
  if (agentSession !== undefined && agentSession !== null && agentSession !== false && agentSession !== '') {
    return true
  }

  // 4. snapshot agents matching pane_id or target
  if (pane.pane_id && Array.isArray(snapshotAgents) && snapshotAgents.length > 0) {
    const hasMatchingAgent = snapshotAgents.some(
      (a) => a && (a.target === pane.pane_id || a.pane_id === pane.pane_id)
    )
    if (hasMatchingAgent) {
      return true
    }
  }

  return false
}
