import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import HorizonHeader from '../horizon-header.tsx'

describe('HorizonHeader context ownership and responsive markup', () => {
  const common = {
    status: 'connected' as const,
    isSpaceDrawerOpen: false,
    isTabDrawerOpen: false,
    onOpenSpaces: () => {},
    onOpenTabs: () => {},
  }

  it('retains selected pane, workspace, Tab and folder context in the desktop branch', () => {
    const html = renderToStaticMarkup(
      <HorizonHeader
        {...common}
        activeWorkspace={{
          workspace_id: 'w1',
          number: 1,
          label: 'Project',
          agent_status: 'done',
          tab_count: 1,
          pane_count: 1,
          focused: true,
        }}
        activeTab={{
          tab_id: 't1',
          workspace_id: 'w1',
          number: 1,
          label: 'Main',
          agent_status: 'done',
          pane_count: 1,
          focused: true,
        }}
        selectedPane={{
          pane_id: 'p1',
          workspace_id: 'w1',
          tab_id: 't1',
          agent_status: 'working',
          focused: true,
          title: 'Agent One',
          cwd: '/projects/web/',
        }}
        viewMode="panel"
        onSelectMode={() => {}}
        onRefresh={() => {}}
      />,
    )
    expect(html).toContain('context-title-text header-mobile-only')
    expect(html).toContain('Mahiro Code')
    expect(html).toContain('context-title-text header-desktop-only')
    expect(html).toContain('Agent One')
    expect(html).toContain('context-sub header-desktop-only')
    expect(html).toContain('Project')
    expect(html).toContain('Open Tabs and Panes')
    expect(html).toContain('>web</span>')
    expect(html).toContain('aria-label="Refresh Panel"')
    expect(html).toContain('aria-pressed="true"')
  })

  it('has truthful empty-target fallbacks and handles Windows folder paths', () => {
    const empty = renderToStaticMarkup(
      <HorizonHeader {...common} activeWorkspace={null} />,
    )
    expect(empty).toContain('Select Workspace')
    expect(empty).toContain('Select Tab')
    expect(empty).not.toContain('context-folder')

    const shell = renderToStaticMarkup(
      <HorizonHeader
        {...common}
        activeWorkspace={null}
        selectedPane={{
          pane_id: 'p2',
          workspace_id: 'w1',
          tab_id: 't1',
          agent_status: 'idle',
          focused: true,
          terminal_title_stripped: 'Shell',
          cwd: 'C:\\projects\\terminal\\',
        }}
      />,
    )
    expect(shell).toContain('Shell')
    expect(shell).toContain('>terminal</span>')
  })
})
