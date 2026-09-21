import type { ISnapshotResult, ITab, IWorkspace } from '../types.ts'
import type { IPushTransition, PushTransitionType } from './types.ts'

export const sanitizeWorkspaceLabel = (raw?: string | null, maxLength = 64): string | undefined => {
  if (typeof raw !== 'string') return undefined
  // Strip C0 (\u0000-\u001f), DEL/C1 (\u007f-\u009f), and bidi-formatting controls:
  // \u061c (ALM), \u200e (LRM), \u200f (RLM), \u202a-\u202e (LRE, RLE, PDF, LRO, RLO), \u2066-\u2069 (LRI, RLI, FSI, PDI)
  const noControls = raw.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
  const collapsed = noControls.trim().replace(/\s+/g, ' ')
  if (collapsed.length === 0) return undefined
  const chars = Array.from(collapsed)
  if (chars.length > maxLength) {
    return chars.slice(0, maxLength).join('')
  }
  return collapsed
}

export const resolveWorkspaceOwnerTabs = (tabs: ITab[] = []): Map<string, string> => {
  const tabIdCounts = new Map<string, number>()
  for (const tab of tabs) {
    if (!tab || typeof tab.tab_id !== 'string') continue
    const tabId = tab.tab_id.trim()
    if (tabId) tabIdCounts.set(tabId, (tabIdCounts.get(tabId) || 0) + 1)
  }

  const workspaceTabs = new Map<string, ITab[]>()
  for (const tab of tabs) {
    if (!tab) continue
    if (typeof tab.workspace_id !== 'string' || typeof tab.tab_id !== 'string') continue
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

  public diffSnapshot(snapshot: ISnapshotResult, enabledTabIds?: Set<string>): IPushTransition[] {
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

    const transitions: IPushTransition[] = []

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
        } else if (
          (currentStatus === 'done' && previousStatus !== 'done') ||
          (currentStatus === 'idle' && previousStatus === 'working')
        ) {
          transitionType = 'done'
        }
      }

      // Always track aggregate status for every tab, including non-owner tabs.
      this.lastTabStatus.set(tabId, currentStatus)

      if (transitionType) {
        const wsId = typeof tab.workspace_id === 'string' ? tab.workspace_id.trim() : ''

        if (!wsId) {
          // Missing topology: suppress
          continue
        }

        const ws = workspaceMap.get(wsId)
        if (!ws) {
          // Unresolved workspace: suppress
          continue
        }

        const isEnabled = enabledTabIds ? enabledTabIds.has(tabId) : ownerTabMap.get(wsId) === tabId
        if (!isEnabled) {
          // Disabled tab: suppress
          continue
        }

        const rawLabel = typeof ws.label === 'string' && ws.label.trim().length > 0 ? ws.label : ws.workspace_id
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
  }

  public isBaselineEstablished(): boolean {
    return this.hasBaseline
  }

  public getTrackedTabCount(): number {
    return this.lastTabStatus.size
  }
}
