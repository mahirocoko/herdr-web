import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import TabRail from '../tab-rail.tsx'
import type { IPane, ITab } from '@/types/herdr.ts'

describe('TabRail: horizontal native tab rail below header', () => {
  const mockTabs: ITab[] = [
    {
      tab_id: 't2',
      workspace_id: 'ws1',
      number: 2,
      label: 'server-logs',
      pane_count: 1,
      focused: false,
      agent_status: 'working',
    },
    {
      tab_id: 't1',
      workspace_id: 'ws1',
      number: 1,
      label: 'editor',
      pane_count: 2,
      focused: true,
      agent_status: 'idle',
    },
    {
      tab_id: 't3_empty',
      workspace_id: 'ws1',
      number: 3,
      label: '',
      pane_count: 0,
      focused: false,
      agent_status: 'unknown',
    },
    {
      tab_id: 't4_other_ws',
      workspace_id: 'ws2',
      number: 1,
      label: 'other',
      pane_count: 1,
      focused: false,
      agent_status: 'idle',
    },
  ]

  const mockPanes: IPane[] = [
    {
      pane_id: 'ws1:t1:p1',
      workspace_id: 'ws1',
      tab_id: 't1',
      cwd: '/home/project',
      focused: false,
      agent_status: 'idle',
    },
    {
      pane_id: 'ws1:t1:p2',
      workspace_id: 'ws1',
      tab_id: 't1',
      cwd: '/home/project',
      focused: true,
      agent_status: 'idle',
    },
    {
      pane_id: 'ws1:t2:p1',
      workspace_id: 'ws1',
      tab_id: 't2',
      cwd: '/home/project',
      focused: false,
      agent_status: 'working',
    },
  ]

  it('renders tabs sorted by number within the active workspace only', () => {
    const html = renderToStaticMarkup(
      <TabRail
        tabs={mockTabs}
        panes={mockPanes}
        activeWorkspaceId="ws1"
        selectedPaneId="ws1:t1:p2"
        onSelectPane={() => {}}
      />,
    )

    expect(html).toContain('tab-rail')
    expect(html).toContain('role="navigation"')
    expect(html).toContain('aria-label="Space tabs"')

    // t1 (number 1) should appear before t2 (number 2)
    const idxT1 = html.indexOf('editor')
    const idxT2 = html.indexOf('server-logs')
    expect(idxT1).toBeGreaterThan(-1)
    expect(idxT2).toBeGreaterThan(-1)
    expect(idxT1).toBeLessThan(idxT2)

    // Other workspace tabs must not render
    expect(html).not.toContain('other')
  })

  it('renders truthful status dot reflecting tab agent_status', () => {
    const html = renderToStaticMarkup(
      <TabRail
        tabs={mockTabs}
        panes={mockPanes}
        activeWorkspaceId="ws1"
        selectedPaneId="ws1:t1:p2"
        onSelectPane={() => {}}
      />,
    )

    // t2 has working status -> space-status-dot--working
    expect(html).toContain('space-status-dot--working')
    // t1 has idle status -> space-status-dot--idle
    expect(html).toContain('space-status-dot--idle')
  })

  it('marks empty tab as disabled honestly without fake selection', () => {
    const html = renderToStaticMarkup(
      <TabRail
        tabs={mockTabs}
        panes={mockPanes}
        activeWorkspaceId="ws1"
        selectedPaneId="ws1:t1:p2"
        onSelectPane={() => {}}
      />,
    )

    expect(html).toContain('is-empty')
    expect(html).toContain('disabled=""')
    expect(html).toContain('Tab 3')
  })

  it('derives active tab state from selectedPane tab_id', () => {
    const html = renderToStaticMarkup(
      <TabRail
        tabs={mockTabs}
        panes={mockPanes}
        activeWorkspaceId="ws1"
        selectedPaneId="ws1:t1:p2"
        onSelectPane={() => {}}
      />,
    )

    // t1 should have is-active and aria-current="page"
    expect(html).toContain('is-active')
    expect(html).toContain('aria-current="page"')
  })

  it('sets tabIndex=0 on the first enabled tab when activeIndex is -1 and index 0 is disabled', () => {
    // Construct tabs where index 0 is empty/disabled and index 1 is enabled
    const customTabs: ITab[] = [
      {
        tab_id: 't_empty_first',
        workspace_id: 'ws1',
        number: 1,
        label: 'empty-one',
        pane_count: 0,
        focused: false,
        agent_status: 'unknown',
      },
      {
        tab_id: 't_enabled_second',
        workspace_id: 'ws1',
        number: 2,
        label: 'valid-two',
        pane_count: 1,
        focused: false,
        agent_status: 'idle',
      },
    ]

    const customPanes: IPane[] = [
      {
        pane_id: 'ws1:t_enabled_second:p1',
        workspace_id: 'ws1',
        tab_id: 't_enabled_second',
        cwd: '/home',
        focused: false,
        agent_status: 'idle',
      },
    ]

    const html = renderToStaticMarkup(
      <TabRail
        tabs={customTabs}
        panes={customPanes}
        activeWorkspaceId="ws1"
        selectedPaneId="non_existent_pane" // activeIndex === -1
        onSelectPane={() => {}}
      />,
    )

    // Empty tab at index 0 must have tabIndex="-1" and disabled=""
    expect(html).toContain('disabled=""')
    expect(html).toContain('empty-one')

    // Enabled tab at index 1 must be the tabstop (tabIndex="0")
    // Find the button for valid-two
    const enabledBtnMatch = html.match(
      /<button[^>]*tabindex="0"[^>]*>[\s\S]*?valid-two[\s\S]*?<\/button>/i,
    )
    expect(enabledBtnMatch).not.toBeNull()
  })

  it('renders null gracefully when workspace has no tabs', () => {
    const html = renderToStaticMarkup(
      <TabRail
        tabs={[]}
        panes={mockPanes}
        activeWorkspaceId="ws1"
        selectedPaneId="ws1:t1:p2"
        onSelectPane={() => {}}
      />,
    )

    expect(html).toBe('')
  })
})
