import { describe, expect, it } from 'bun:test'
import type { IPane, ITab } from '@/types/herdr.ts'
import {
  ACTIVITY_LABEL,
  derivePaneActivity,
  deriveSpaceActivity as deriveSpaceActivityFromSnapshot,
  deriveTabActivity,
  getActivityStatusDotClass,
  rollupActivities,
  sanitizeActivity,
} from '../activity-status.ts'

const CURRENT_TABS = [
  { tab_id: 'tab-1', workspace_id: 'ws-1' },
  { tab_id: 'tab-A', workspace_id: 'ws-A' },
  { tab_id: 'tab-B', workspace_id: 'ws-B' },
] as ITab[]

const deriveSpaceActivity = (panes: IPane[], workspaceId: string) =>
  deriveSpaceActivityFromSnapshot(panes, workspaceId, CURRENT_TABS)

describe('activity-status: pure helper and UI activity rollup contracts', () => {
  it('ignores orphan leaves and stale leaves after their Tab is removed or reparented', () => {
    const panes = [
      {
        pane_id: 'p1',
        tab_id: 'tab-1',
        workspace_id: 'ws-1',
        agent_status: 'working',
      },
      {
        pane_id: 'orphan',
        tab_id: 'missing',
        workspace_id: 'ws-1',
        agent_status: 'blocked',
      },
    ] as IPane[]
    expect(deriveSpaceActivityFromSnapshot(panes, 'ws-1', CURRENT_TABS)).toBe(
      'working',
    )
    expect(deriveSpaceActivityFromSnapshot(panes, 'ws-1', [])).toBe('unknown')
    const movedTabs = [{ tab_id: 'tab-1', workspace_id: 'ws-B' }] as ITab[]
    expect(deriveSpaceActivityFromSnapshot(panes, 'ws-1', movedTabs)).toBe(
      'unknown',
    )
    expect(deriveSpaceActivityFromSnapshot(panes, 'ws-B', movedTabs)).toBe(
      'unknown',
    )
    expect(
      deriveSpaceActivityFromSnapshot(
        [{ ...panes[0], workspace_id: 'ws-B' }],
        'ws-B',
        movedTabs,
      ),
    ).toBe('working')
  })

  it('sanitizes known and malicious/unknown status strings safely without class injection', () => {
    expect(sanitizeActivity('blocked')).toBe('blocked')
    expect(sanitizeActivity('working')).toBe('working')
    expect(sanitizeActivity('done')).toBe('done')
    expect(sanitizeActivity('idle')).toBe('idle')

    // Case and whitespace insensitivity
    expect(sanitizeActivity('  WORKING  ')).toBe('working')
    expect(sanitizeActivity('Done')).toBe('done')

    // Unknown or invalid values fallback to unknown safely
    expect(sanitizeActivity('unknown')).toBe('unknown')
    expect(sanitizeActivity('')).toBe('unknown')
    expect(sanitizeActivity(null)).toBe('unknown')
    expect(sanitizeActivity(undefined)).toBe('unknown')
    expect(sanitizeActivity('something_unexpected')).toBe('unknown')
    expect(sanitizeActivity('<script>alert(1)</script>')).toBe('unknown')
    expect(sanitizeActivity('evil" onmouseover="alert(1)')).toBe('unknown')

    // CSS class generator safety
    expect(getActivityStatusDotClass('blocked')).toBe(
      'space-status-dot--blocked',
    )
    expect(getActivityStatusDotClass('working')).toBe(
      'space-status-dot--working',
    )
    expect(getActivityStatusDotClass('done')).toBe('space-status-dot--done')
    expect(getActivityStatusDotClass('idle')).toBe('space-status-dot--idle')
    expect(getActivityStatusDotClass('unknown')).toBe(
      'space-status-dot--unknown',
    )
    expect(getActivityStatusDotClass('evil" class="hacked')).toBe(
      'space-status-dot--unknown',
    )

    // Direct contract for rollupActivities
    expect(rollupActivities(['idle', 'working', 'done'])).toBe('working')
    expect(rollupActivities(['idle', 'done'])).toBe('done')
    expect(rollupActivities(['idle', 'blocked'])).toBe('blocked')
    expect(rollupActivities([])).toBe('unknown')
  })

  it('proves native parent DONE + leaf WORKING resolves Space AND Tab to working', () => {
    // Space and Tab native attention might be 'done' (e.g. unseen done priority),
    // but the leaf pane is actively 'working'. UI Activity MUST derive 'working'!
    const testPanes: IPane[] = [
      {
        pane_id: 'p1',
        tab_id: 'tab-1',
        workspace_id: 'ws-1',
        agent_status: 'working',
      } as IPane,
    ]

    const tabActivity = deriveTabActivity(testPanes, 'ws-1', 'tab-1')
    const spaceActivity = deriveSpaceActivity(testPanes, 'ws-1')

    expect(tabActivity).toBe('working')
    expect(spaceActivity).toBe('working')
    expect(ACTIVITY_LABEL[tabActivity]).toBe('Working')
    expect(ACTIVITY_LABEL[spaceActivity]).toBe('Working')
  })

  it('proves sibling Blocked wins over working, done, and idle', () => {
    const testPanes: IPane[] = [
      {
        pane_id: 'p1',
        tab_id: 'tab-1',
        workspace_id: 'ws-1',
        agent_status: 'working',
      } as IPane,
      {
        pane_id: 'p2',
        tab_id: 'tab-1',
        workspace_id: 'ws-1',
        agent_status: 'blocked',
      } as IPane,
      {
        pane_id: 'p3',
        tab_id: 'tab-1',
        workspace_id: 'ws-1',
        agent_status: 'done',
      } as IPane,
    ]

    expect(deriveTabActivity(testPanes, 'ws-1', 'tab-1')).toBe('blocked')
    expect(deriveSpaceActivity(testPanes, 'ws-1')).toBe('blocked')
  })

  it('proves Working wins over done and idle, then transitions properly to done / idle', () => {
    // 1. Working + Done -> Working wins
    const workingPanes: IPane[] = [
      {
        pane_id: 'p1',
        tab_id: 'tab-1',
        workspace_id: 'ws-1',
        agent_status: 'working',
      } as IPane,
      {
        pane_id: 'p2',
        tab_id: 'tab-1',
        workspace_id: 'ws-1',
        agent_status: 'done',
      } as IPane,
    ]
    expect(deriveTabActivity(workingPanes, 'ws-1', 'tab-1')).toBe('working')

    // 2. Turn completes: p1 transitions to done -> Tab/Space become done
    const donePanes: IPane[] = [
      {
        pane_id: 'p1',
        tab_id: 'tab-1',
        workspace_id: 'ws-1',
        agent_status: 'done',
      } as IPane,
      {
        pane_id: 'p2',
        tab_id: 'tab-1',
        workspace_id: 'ws-1',
        agent_status: 'done',
      } as IPane,
    ]
    expect(deriveTabActivity(donePanes, 'ws-1', 'tab-1')).toBe('done')
    expect(ACTIVITY_LABEL[deriveTabActivity(donePanes, 'ws-1', 'tab-1')]).toBe(
      'Done',
    )

    // 3. Panes transition to idle/ready -> Tab/Space become idle
    const idlePanes: IPane[] = [
      {
        pane_id: 'p1',
        tab_id: 'tab-1',
        workspace_id: 'ws-1',
        agent_status: 'idle',
      } as IPane,
    ]
    expect(deriveTabActivity(idlePanes, 'ws-1', 'tab-1')).toBe('idle')
    expect(ACTIVITY_LABEL[deriveTabActivity(idlePanes, 'ws-1', 'tab-1')]).toBe(
      'Ready',
    )
  })

  it('handles empty, partial, and shell/unspecified status conservatively without inventing done or idle', () => {
    // Empty tab has no panes -> truthful unknown
    expect(deriveTabActivity([], 'ws-1', 'tab-1')).toBe('unknown')
    expect(deriveSpaceActivity([], 'ws-1')).toBe('unknown')

    // Pane with undefined or empty agent_status (e.g. plain shell pane) -> unknown
    const shellPane: IPane = {
      pane_id: 'p-shell',
      tab_id: 'tab-1',
      workspace_id: 'ws-1',
      agent_status: undefined,
    } as unknown as IPane

    expect(derivePaneActivity(shellPane)).toBe('unknown')
    expect(deriveTabActivity([shellPane], 'ws-1', 'tab-1')).toBe('unknown')
    expect(
      ACTIVITY_LABEL[deriveTabActivity([shellPane], 'ws-1', 'tab-1')],
    ).toBe('—')
  })

  it('proves pane removal and reparenting dynamically updates Space A and Space B', () => {
    // Initial state: p1 (working) belongs to ws-A, ws-B has no panes
    const initialPanes: IPane[] = [
      {
        pane_id: 'p1',
        tab_id: 'tab-A',
        workspace_id: 'ws-A',
        agent_status: 'working',
      } as IPane,
    ]

    expect(deriveSpaceActivity(initialPanes, 'ws-A')).toBe('working')
    expect(deriveSpaceActivity(initialPanes, 'ws-B')).toBe('unknown')

    // Reparenting event: p1 is moved to ws-B and tab-B
    const reparentedPanes: IPane[] = [
      {
        pane_id: 'p1',
        tab_id: 'tab-B',
        workspace_id: 'ws-B',
        agent_status: 'working',
      } as IPane,
    ]

    // ws-A now has 0 panes -> reverts to unknown
    expect(deriveSpaceActivity(reparentedPanes, 'ws-A')).toBe('unknown')
    expect(deriveTabActivity(reparentedPanes, 'ws-A', 'tab-A')).toBe('unknown')

    // ws-B now has p1 -> becomes working
    expect(deriveSpaceActivity(reparentedPanes, 'ws-B')).toBe('working')
    expect(deriveTabActivity(reparentedPanes, 'ws-B', 'tab-B')).toBe('working')
  })

  it('proves source guard: all 5 actual consumers use canonical activity helpers and avoid raw parent status painting', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const baseDir = path.resolve(import.meta.dir, '../../components')

    // 1. sidebar-roster.tsx
    const sidebarRoster = fs.readFileSync(
      path.join(baseDir, 'sidebar-roster.tsx'),
      'utf8',
    )
    expect(sidebarRoster).toContain('deriveSpaceActivity')
    expect(sidebarRoster).toContain('deriveTabActivity')
    expect(sidebarRoster).toContain('derivePaneActivity')
    expect(sidebarRoster).toContain('getActivityStatusDotClass')
    expect(sidebarRoster).not.toContain(
      'getWorkspaceStatusDotClass(workspace.agent_status)',
    )
    expect(sidebarRoster).not.toContain(
      "badge badge-${tab.agent_status || 'unknown'}",
    )
    expect(sidebarRoster).not.toContain(
      "badge badge-${pane.agent_status || 'idle'}",
    )

    // 2. space-drawer.tsx
    const spaceDrawer = fs.readFileSync(
      path.join(baseDir, 'space-drawer.tsx'),
      'utf8',
    )
    expect(spaceDrawer).toContain('deriveSpaceActivity')
    expect(spaceDrawer).toContain('getActivityStatusDotClass')
    expect(spaceDrawer).not.toContain(
      'getWorkspaceStatusDotClass(workspace.agent_status)',
    )

    // 3. pane-drawer.tsx
    const paneDrawer = fs.readFileSync(
      path.join(baseDir, 'pane-drawer.tsx'),
      'utf8',
    )
    expect(paneDrawer).toContain('deriveTabActivity')
    expect(paneDrawer).toContain('derivePaneActivity')
    expect(paneDrawer).toContain('getActivityStatusDotClass')
    expect(paneDrawer).toContain('Native effective state:')
    expect(paneDrawer).not.toContain('getStatusBadgeClass(tabStatus)')

    // 4. tab-rail.tsx
    const tabRail = fs.readFileSync(path.join(baseDir, 'tab-rail.tsx'), 'utf8')
    expect(tabRail).toContain('deriveTabActivity')
    expect(tabRail).toContain('getActivityStatusDotClass')
    expect(tabRail).not.toContain(
      'getWorkspaceStatusDotClass(tab.agent_status)',
    )

    // 5. navigation-search-sheet.tsx
    const navSearch = fs.readFileSync(
      path.join(baseDir, 'navigation-search-sheet.tsx'),
      'utf8',
    )
    expect(navSearch).toContain('deriveSpaceActivity')
    expect(navSearch).toContain('deriveTabActivity')
    expect(navSearch).toContain('derivePaneActivity')
    expect(navSearch).toContain('getActivityStatusDotClass')
    expect(navSearch).toContain('${displaySubtitle}, ${statusSummary}')
    expect(navSearch).toContain(
      "item.type === 'pane' ? 'effective state' : 'attention'",
    )
    expect(navSearch).not.toContain(
      'getWorkspaceStatusDotClass(item.agentStatus)',
    )
  })
})
