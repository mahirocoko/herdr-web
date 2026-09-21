import { describe, expect, test } from 'bun:test'
import type { IPane, ISnapshotResult } from '@/types/herdr.ts'
import {
  formatTabLabel,
  groupPanesByTab,
  selectBestPaneForWorkspace,
  selectFocusedPaneFromSnapshot
} from '../workspace-helpers.ts'

describe('workspace-helpers: selectBestPaneForWorkspace', () => {
  const mockPanes: IPane[] = [
    {
      pane_id: 'w1:p1',
      workspace_id: 'w1',
      tab_id: 'w1:t1',
      cwd: '/tmp',
      focused: false,
      agent_status: 'idle'
    },
    {
      pane_id: 'w1:p2',
      workspace_id: 'w1',
      tab_id: 'w1:t1',
      cwd: '/tmp',
      focused: true,
      agent_status: 'working'
    },
    {
      pane_id: 'w1:p3',
      workspace_id: 'w1',
      tab_id: 'w1:t1',
      cwd: '/tmp',
      focused: false,
      agent_status: 'blocked'
    },
    {
      pane_id: 'w2:p1',
      workspace_id: 'w2',
      tab_id: 'w2:t1',
      cwd: '/tmp',
      focused: false,
      agent_status: 'working'
    },
    {
      pane_id: 'w2:p2',
      workspace_id: 'w2',
      tab_id: 'w2:t1',
      cwd: '/tmp',
      focused: true,
      agent_status: 'working'
    }
  ]

  test('prioritizes blocked pane in workspace over focused and normal panes', () => {
    const selected = selectBestPaneForWorkspace(mockPanes, 'w1')
    expect(selected?.pane_id).toBe('w1:p3')
  })

  test('prioritizes focused pane when no pane is blocked', () => {
    const selected = selectBestPaneForWorkspace(mockPanes, 'w2')
    expect(selected?.pane_id).toBe('w2:p2')
  })

  test('respects explicit focusedPaneId parameter when no pane is blocked', () => {
    const selected = selectBestPaneForWorkspace(mockPanes, 'w2', 'w2:p1')
    expect(selected?.pane_id).toBe('w2:p1')
  })

  test('falls back to first pane in workspace when neither blocked nor focused', () => {
    const unFocusedPanes: IPane[] = [
      {
        pane_id: 'w3:p1',
        workspace_id: 'w3',
        tab_id: 'w3:t1',
        cwd: '/tmp',
        focused: false,
        agent_status: 'idle'
      },
      {
        pane_id: 'w3:p2',
        workspace_id: 'w3',
        tab_id: 'w3:t1',
        cwd: '/tmp',
        focused: false,
        agent_status: 'idle'
      }
    ]
    const selected = selectBestPaneForWorkspace(unFocusedPanes, 'w3')
    expect(selected?.pane_id).toBe('w3:p1')
  })

  test('returns null when workspace has no panes', () => {
    const selected = selectBestPaneForWorkspace(mockPanes, 'w99')
    expect(selected).toBeNull()
  })
})

describe('workspace-helpers: formatTabLabel', () => {
  test('returns formatted tab label when label is present', () => {
    const tab: any = { tab_id: 't1', workspace_id: 'w1', label: 'editor', number: 1, pane_count: 1, focused: false, agent_status: 'idle' }
    expect(formatTabLabel(tab)).toBe('Tab · editor')
  })

  test('falls back to tab number when label is empty', () => {
    const tab: any = { tab_id: 't1', workspace_id: 'w1', label: '', number: 2, pane_count: 1, focused: false, agent_status: 'idle' }
    expect(formatTabLabel(tab)).toBe('Tab 2')
  })

  test('returns empty string when tab is null or undefined', () => {
    expect(formatTabLabel(null)).toBe('')
    expect(formatTabLabel(undefined)).toBe('')
  })
})

describe('workspace-helpers: selectFocusedPaneFromSnapshot', () => {
  const makeSnapshot = (): ISnapshotResult => ({
    protocol: 22,
    version: 'test',
    workspaces: [
      {
        workspace_id: 'w1',
        label: 'one',
        number: 1,
        agent_status: 'idle',
        tab_count: 2,
        pane_count: 2,
        active_tab_id: 'w1:t2',
        focused: false
      },
      {
        workspace_id: 'w2',
        label: 'two',
        number: 2,
        agent_status: 'blocked',
        tab_count: 1,
        pane_count: 1,
        active_tab_id: 'w2:t1',
        focused: true
      }
    ],
    tabs: [
      { tab_id: 'w1:t1', workspace_id: 'w1', label: 'first', number: 1, pane_count: 1, focused: false, agent_status: 'idle' },
      { tab_id: 'w1:t2', workspace_id: 'w1', label: 'second', number: 2, pane_count: 1, focused: true, agent_status: 'working' },
      { tab_id: 'w2:t1', workspace_id: 'w2', label: 'other', number: 1, pane_count: 1, focused: false, agent_status: 'blocked' }
    ],
    panes: [
      { pane_id: 'w1:p1', workspace_id: 'w1', tab_id: 'w1:t1', cwd: '/tmp', focused: false, agent_status: 'idle' },
      { pane_id: 'w1:p2', workspace_id: 'w1', tab_id: 'w1:t2', cwd: '/tmp', focused: true, agent_status: 'working' },
      { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 'w2:t1', cwd: '/tmp', focused: false, agent_status: 'blocked' }
    ]
  })

  test('uses the explicit focused pane before other focus signals', () => {
    const snapshot = makeSnapshot()
    snapshot.focused_pane_id = 'w1:p1'
    snapshot.focused_tab_id = 'w1:t2'
    snapshot.focused_workspace_id = 'w2'

    expect(selectFocusedPaneFromSnapshot(snapshot)?.pane_id).toBe('w1:p1')
  })

  test('uses the explicit focused tab when pane id is unavailable', () => {
    const snapshot = makeSnapshot()
    snapshot.focused_tab_id = 'w1:t1'
    snapshot.focused_workspace_id = 'w2'

    expect(selectFocusedPaneFromSnapshot(snapshot)?.pane_id).toBe('w1:p1')
  })

  test('uses the focused workspace active tab before a blocked pane elsewhere', () => {
    const snapshot = makeSnapshot()
    snapshot.focused_workspace_id = 'w1'
    snapshot.tabs[1].focused = false
    snapshot.panes[1].focused = false

    expect(selectFocusedPaneFromSnapshot(snapshot)?.pane_id).toBe('w1:p2')
  })

  test('falls back through focused flags when root ids are absent', () => {
    const snapshot = makeSnapshot()

    expect(selectFocusedPaneFromSnapshot(snapshot)?.pane_id).toBe('w1:p2')
  })

  test('returns null when the snapshot has no focus or active workspace signal', () => {
    const snapshot = makeSnapshot()
    snapshot.workspaces.forEach((workspace) => {
      workspace.focused = false
    })
    snapshot.tabs.forEach((tab) => {
      tab.focused = false
    })
    snapshot.panes.forEach((pane) => {
      pane.focused = false
    })

    expect(selectFocusedPaneFromSnapshot(snapshot)).toBeNull()
  })
})

describe('workspace-helpers: groupPanesByTab', () => {
  const tabs: any[] = [
    { tab_id: 't2', workspace_id: 'w1', label: 'second', number: 2, pane_count: 1, focused: false, agent_status: 'working' },
    { tab_id: 't1', workspace_id: 'w1', label: 'first', number: 1, pane_count: 2, focused: true, agent_status: 'idle' },
    { tab_id: 't3', workspace_id: 'w2', label: 'other-ws', number: 1, pane_count: 1, focused: false, agent_status: 'idle' }
  ]

  const panes: any[] = [
    { pane_id: 'w1:p1', workspace_id: 'w1', tab_id: 't1', cwd: '/tmp', focused: true, agent_status: 'idle' },
    { pane_id: 'w1:p2', workspace_id: 'w1', tab_id: 't1', cwd: '/tmp', focused: false, agent_status: 'idle' },
    { pane_id: 'w1:p3', workspace_id: 'w1', tab_id: 't2', cwd: '/tmp', focused: false, agent_status: 'working' },
    { pane_id: 'w1:p4_orphan', workspace_id: 'w1', tab_id: 't_missing', cwd: '/tmp', focused: false, agent_status: 'unknown' },
    { pane_id: 'w2:p1', workspace_id: 'w2', tab_id: 't3', cwd: '/tmp', focused: false, agent_status: 'idle' }
  ]

  test('groups panes under tabs ordered by tab number', () => {
    const groups = groupPanesByTab(tabs, panes, 'w1')
    expect(groups.length).toBe(3) // t1, t2, and orphan

    // t1 has number 1
    expect(groups[0].tab?.tab_id).toBe('t1')
    expect(groups[0].panes.length).toBe(2)
    expect(groups[0].panes.map(p => p.pane_id)).toEqual(['w1:p1', 'w1:p2'])

    // t2 has number 2
    expect(groups[1].tab?.tab_id).toBe('t2')
    expect(groups[1].panes.length).toBe(1)
    expect(groups[1].panes[0].pane_id).toBe('w1:p3')

    // orphan group
    expect(groups[2].tab).toBeNull()
    expect(groups[2].panes.length).toBe(1)
    expect(groups[2].panes[0].pane_id).toBe('w1:p4_orphan')
  })

  test('handles workspace with no orphans', () => {
    const groups = groupPanesByTab(tabs, panes, 'w2')
    expect(groups.length).toBe(1)
    expect(groups[0].tab?.tab_id).toBe('t3')
    expect(groups[0].panes.length).toBe(1)
    expect(groups[0].panes[0].pane_id).toBe('w2:p1')
  })
})
