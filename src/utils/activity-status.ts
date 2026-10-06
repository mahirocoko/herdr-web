import type { IPane, ITab } from '@/types/herdr.ts'

export type KnownActivity = 'blocked' | 'working' | 'done' | 'idle' | 'unknown'

/**
 * Human-facing display labels for derived UI Activity.
 * Pane items render plain word + dot: Needs input / Working / Done / Ready / —
 */
export const ACTIVITY_LABEL: Readonly<Record<KnownActivity, string>> = {
  blocked: 'Needs input',
  working: 'Working',
  done: 'Done',
  idle: 'Ready',
  unknown: '—',
}

/**
 * Rollup priority for UI Activity:
 * A blocked agent commands immediate attention across its container,
 * followed by any working agent, then done, then ready/idle.
 * Unknown only when no pane reports known activity.
 */
const ACTIVITY_ROLLUP: readonly KnownActivity[] = [
  'blocked',
  'working',
  'done',
  'idle',
]

/**
 * Safe sanitization of any status string into a KnownActivity.
 * Malicious, unrecognized, or empty strings strictly map to 'unknown'
 * to prevent CSS class injection or invented states.
 */
export const sanitizeActivity = (rawStatus?: string | null): KnownActivity => {
  if (!rawStatus || typeof rawStatus !== 'string') return 'unknown'
  const normalized = rawStatus.toLowerCase().trim()
  if (
    normalized === 'blocked' ||
    normalized === 'working' ||
    normalized === 'done' ||
    normalized === 'idle'
  ) {
    return normalized as KnownActivity
  }
  return 'unknown'
}

/**
 * Roll up a collection of leaf activity states:
 * blocked > working > done > idle > unknown
 */
export const rollupActivities = (
  activities: ReadonlyArray<KnownActivity>,
): KnownActivity => {
  for (const candidate of ACTIVITY_ROLLUP) {
    if (activities.includes(candidate)) {
      return candidate
    }
  }
  return 'unknown'
}

/**
 * Derive activity for a Tab from its child panes in the current snapshot.
 * Filters strictly by workspace_id and tab_id.
 * If no panes belong to this tab, conservatively returns 'unknown'
 * (never falls back to parent attention).
 */
export const deriveTabActivity = (
  panes: ReadonlyArray<IPane>,
  workspaceId: string,
  tabId: string,
): KnownActivity => {
  const childPanes = panes.filter(
    (p) => p.workspace_id === workspaceId && p.tab_id === tabId,
  )
  if (childPanes.length === 0) {
    return 'unknown'
  }
  const childActivities = childPanes.map((p) =>
    sanitizeActivity(p.agent_status),
  )
  return rollupActivities(childActivities)
}

/**
 * Derive activity for a Space from all its child panes in the current snapshot.
 * Filters by workspace_id and current Tab membership. Orphan panes and panes
 * whose Tab has moved to another Space cannot paint the old container.
 * If no panes belong to this workspace, conservatively returns 'unknown'
 * (never falls back to parent attention).
 */
export const deriveSpaceActivity = (
  panes: ReadonlyArray<IPane>,
  workspaceId: string,
  tabs: ReadonlyArray<ITab>,
): KnownActivity => {
  const tabIds = new Set(
    tabs
      .filter((tab) => tab.workspace_id === workspaceId)
      .map((tab) => tab.tab_id),
  )
  const childPanes = panes.filter(
    (p) => p.workspace_id === workspaceId && tabIds.has(p.tab_id),
  )
  if (childPanes.length === 0) {
    return 'unknown'
  }
  const childActivities = childPanes.map((p) =>
    sanitizeActivity(p.agent_status),
  )
  return rollupActivities(childActivities)
}

/**
 * Derive activity for a single Pane from its effective agent_status.
 */
export const derivePaneActivity = (
  pane?: Partial<IPane> | null,
): KnownActivity => {
  return sanitizeActivity(pane?.agent_status)
}

/**
 * Returns the CSS class for an activity status dot.
 * Only returns predefined allowlisted classes, preventing class name injection.
 */
export const getActivityStatusDotClass = (
  activityOrStatus?: string | null,
): string => {
  const activity = sanitizeActivity(activityOrStatus)
  switch (activity) {
    case 'blocked':
      return 'space-status-dot--blocked'
    case 'working':
      return 'space-status-dot--working'
    case 'done':
      return 'space-status-dot--done'
    case 'idle':
      return 'space-status-dot--idle'
    case 'unknown':
    default:
      return 'space-status-dot--unknown'
  }
}
