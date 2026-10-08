import type { ISnapshotResult, ITab, IWorkspace } from '../types.ts'
import { isAgentPane } from '../security.ts'
import type { IPushTransition, PushTransitionType } from './types.ts'

export const sanitizeWorkspaceLabel = (
  raw?: string | null,
  maxLength = 64
): string | undefined => {
  if (typeof raw !== 'string') return undefined
  // Strip C0 (\u0000-\u001f), DEL/C1 (\u007f-\u009f), and bidi-formatting controls:
  // \u061c (ALM), \u200e (LRM), \u200f (RLM), \u202a-\u202e (LRE, RLE, PDF, LRO, RLO), \u2066-\u2069 (LRI, RLI, FSI, PDI)
  const noControls = raw.replace(
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    ''
  )
  const collapsed = noControls.trim().replace(/\s+/g, ' ')
  if (collapsed.length === 0) return undefined
  const chars = Array.from(collapsed)
  if (chars.length > maxLength) {
    return chars.slice(0, maxLength).join('')
  }
  return collapsed
}

export const resolveWorkspaceOwnerTabs = (
  tabs: ITab[] = []
): Map<string, string> => {
  const tabIdCounts = new Map<string, number>()
  for (const tab of tabs) {
    if (!tab || typeof tab.tab_id !== 'string') continue
    const tabId = tab.tab_id.trim()
    if (tabId) tabIdCounts.set(tabId, (tabIdCounts.get(tabId) || 0) + 1)
  }

  const workspaceTabs = new Map<string, ITab[]>()
  for (const tab of tabs) {
    if (!tab) continue
    if (typeof tab.workspace_id !== 'string' || typeof tab.tab_id !== 'string')
      continue
    if (typeof tab.number !== 'number' || !Number.isFinite(tab.number)) continue
    const wsId = tab.workspace_id.trim()
    const tabId = tab.tab_id.trim()
    if (!wsId || !tabId) continue
    if (tabIdCounts.get(tabId) !== 1) continue

    const list = workspaceTabs.get(wsId) || []
    list.push({ ...tab, workspace_id: wsId, tab_id: tabId })
    workspaceTabs.set(wsId, list)
  }

  const ownerMap = new Map<string, string>()
  for (const [wsId, wsTabs] of workspaceTabs.entries()) {
    if (wsTabs.length === 0) continue
    wsTabs.sort((a, b) => {
      if (a.number !== b.number) {
        return a.number - b.number
      }
      return a.tab_id < b.tab_id ? -1 : a.tab_id > b.tab_id ? 1 : 0
    })
    ownerMap.set(wsId, wsTabs[0].tab_id)
  }
  return ownerMap
}

export class PushTransitionDetector {
  private hasBaseline = false
  private lastTabStatus = new Map<string, string>()
  private spaceRounds = new Map<string, { topology: string; armed: boolean }>()

  // Native parent attention can say done while a child still works. Completion
  // therefore belongs to leaf agents, independent of which Tabs can notify.
  private diffSpaceCompletion(
    snapshot: ISnapshotResult,
    enabledTabIds?: Set<string>
  ): IPushTransition[] {
    const transitions: IPushTransition[] = []
    const presentSpaces = new Set<string>()
    const ownerTabs = resolveWorkspaceOwnerTabs(snapshot.tabs || [])
    for (const workspace of snapshot.workspaces || []) {
      const workspaceId = workspace.workspace_id?.trim()
      if (!workspaceId) continue
      presentSpaces.add(workspaceId)
      const tabs = (snapshot.tabs || []).filter(
        (tab) => tab.workspace_id === workspaceId
      )
      const tabIds = new Set(tabs.map((tab) => tab.tab_id))
      const workspaceAgents = (snapshot.panes || []).filter(
        (pane) =>
          pane.workspace_id === workspaceId &&
          isAgentPane(pane, snapshot.agents)
      )
      const panes = (snapshot.panes || []).filter(
        (pane) =>
          pane.workspace_id === workspaceId &&
          tabIds.has(pane.tab_id) &&
          isAgentPane(pane, snapshot.agents)
      )
      const validTopology =
        tabs.length > 0 &&
        tabs.every(
          (tab) =>
            tab.tab_id.trim().length > 0 &&
            Number.isFinite(tab.number) &&
            (snapshot.tabs || []).filter((other) => other.tab_id === tab.tab_id)
              .length === 1
        ) &&
        workspaceAgents.length === panes.length &&
        panes.every(
          (pane) =>
            pane.pane_id.trim().length > 0 &&
            (snapshot.panes || []).filter(
              (other) => other.pane_id === pane.pane_id
            ).length === 1
        )
      const topology = JSON.stringify([
        [...tabIds].sort(),
        panes
          .map((pane) => {
            const owningAgent = snapshot.agents?.find(
              (agent) =>
                agent.target === pane.pane_id || agent.pane_id === pane.pane_id
            )
            // Match mutation preflight's authoritative session precedence.
            const session =
              pane.agent_session?.value ??
              pane.agent_session?.id ??
              owningAgent?.agent_session?.value ??
              owningAgent?.agent_session?.id ??
              ''
            return [pane.pane_id, pane.tab_id, pane.terminal_id || '', session]
          })
          .sort()
      ])
      const working = panes.some((pane) => pane.agent_status === 'working')
      const complete =
        validTopology &&
        panes.length > 0 &&
        panes.every(
          (pane) => pane.agent_status === 'done' || pane.agent_status === 'idle'
        )
      const previous = this.spaceRounds.get(workspaceId)
      // Topology changes (including removal of a busy agent) cannot manufacture
      // completion. New membership establishes a silent baseline.
      const round =
        previous?.topology === topology ? previous : { topology, armed: false }
      if (!validTopology) round.armed = false
      else if (working) round.armed = true
      if (previous?.topology === topology && round.armed && complete) {
        // Consume completion even when muted: policy changes must not replay it.
        round.armed = false
        const sourceTabId = tabs
          .filter((tab) =>
            enabledTabIds
              ? enabledTabIds.has(tab.tab_id)
              : ownerTabs.get(workspaceId) === tab.tab_id
          )
          .sort(
            (a, b) => a.number - b.number || a.tab_id.localeCompare(b.tab_id)
          )[0]?.tab_id
        if (sourceTabId) {
          const workspaceLabel = sanitizeWorkspaceLabel(
            workspace.label || workspaceId
          )
          transitions.push({
            type: 'done',
            workspaceId,
            ...(workspaceLabel ? { workspaceLabel } : {}),
            sourceTabId
          })
        }
      }
      this.spaceRounds.set(workspaceId, round)
    }
    for (const id of this.spaceRounds.keys()) {
      if (!presentSpaces.has(id)) this.spaceRounds.delete(id)
    }
    return transitions
  }

  public diffSnapshot(
    snapshot: ISnapshotResult,
    enabledTabIds?: Set<string>
  ): IPushTransition[] {
    const completionTransitions = this.diffSpaceCompletion(
      snapshot,
      enabledTabIds
    )
    const currentWorkspaces = snapshot.workspaces || []
    const currentTabs = snapshot.tabs || []
    const currentTabIds = new Set<string>()

    const workspaceMap = new Map<string, IWorkspace>()
    for (const ws of currentWorkspaces) {
      if (ws && typeof ws.workspace_id === 'string') {
        const id = ws.workspace_id.trim()
        if (id) {
          workspaceMap.set(id, ws)
        }
      }
    }

    const ownerTabMap = resolveWorkspaceOwnerTabs(currentTabs)
    const tabIdCounts = new Map<string, number>()
    for (const tab of currentTabs) {
      if (!tab || typeof tab.tab_id !== 'string') continue
      const tabId = tab.tab_id.trim()
      if (tabId) tabIdCounts.set(tabId, (tabIdCounts.get(tabId) || 0) + 1)
    }

    // First baseline: populate authoritative aggregate state for every tab without emitting pushes.
    if (!this.hasBaseline) {
      for (const tab of currentTabs) {
        if (tab && typeof tab.tab_id === 'string') {
          const tabId = tab.tab_id.trim()
          if (tabId && tabIdCounts.get(tabId) === 1) {
            this.lastTabStatus.set(tabId, tab.agent_status || 'unknown')
          }
        }
      }
      this.hasBaseline = true
      return []
    }

    const transitions: IPushTransition[] = [...completionTransitions]

    for (const tab of currentTabs) {
      if (!tab || typeof tab.tab_id !== 'string') continue
      const tabId = tab.tab_id.trim()
      if (!tabId) continue
      if (tabIdCounts.get(tabId) !== 1) continue
      currentTabIds.add(tabId)
      const currentStatus = tab.agent_status || 'unknown'
      const previousStatus = this.lastTabStatus.get(tabId)

      let transitionType: PushTransitionType | null = null
      if (previousStatus !== undefined && previousStatus !== currentStatus) {
        // Aggregate status changed on an existing tab.
        if (currentStatus === 'blocked' && previousStatus !== 'blocked') {
          transitionType = 'needs_input'
        }
      }

      // Always track aggregate status for every tab, including non-owner tabs.
      this.lastTabStatus.set(tabId, currentStatus)

      if (transitionType) {
        const wsId =
          typeof tab.workspace_id === 'string' ? tab.workspace_id.trim() : ''

        if (!wsId) {
          // Missing topology: suppress
          continue
        }

        const ws = workspaceMap.get(wsId)
        if (!ws) {
          // Unresolved workspace: suppress
          continue
        }

        const isEnabled = enabledTabIds
          ? enabledTabIds.has(tabId)
          : ownerTabMap.get(wsId) === tabId
        if (!isEnabled) {
          // Disabled tab: suppress
          continue
        }

        const rawLabel =
          typeof ws.label === 'string' && ws.label.trim().length > 0
            ? ws.label
            : ws.workspace_id
        const workspaceLabel = sanitizeWorkspaceLabel(rawLabel)

        transitions.push({
          type: transitionType,
          workspaceId: wsId,
          ...(workspaceLabel ? { workspaceLabel } : {}),
          sourceTabId: tabId
        })
      }
    }

    // Clean up tabs removed from the authoritative snapshot.
    for (const trackedTabId of Array.from(this.lastTabStatus.keys())) {
      if (!currentTabIds.has(trackedTabId)) {
        this.lastTabStatus.delete(trackedTabId)
      }
    }

    return transitions
  }

  public reset(): void {
    this.hasBaseline = false
    this.lastTabStatus.clear()
    this.spaceRounds.clear()
  }

  public isBaselineEstablished(): boolean {
    return this.hasBaseline
  }

  public getTrackedTabCount(): number {
    return this.lastTabStatus.size
  }
}
