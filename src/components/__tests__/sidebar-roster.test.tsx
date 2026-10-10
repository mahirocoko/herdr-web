import { expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import SidebarRoster from '../sidebar-roster.tsx'
import type { IPane, ITab, IWorkspace } from '@/types/herdr.ts'

const workspace: IWorkspace = {
  workspace_id: 'w1',
  number: 1,
  label: 'Project',
  agent_status: 'working',
  tab_count: 1,
  pane_count: 1,
  focused: true
}
const tab: ITab = {
  tab_id: 't1',
  workspace_id: 'w1',
  number: 1,
  label: 'Nested tab',
  agent_status: 'working',
  pane_count: 1,
  focused: true
}
const pane: IPane = {
  pane_id: 'p1',
  workspace_id: 'w1',
  tab_id: 't1',
  title: 'Nested agent',
  cwd: '/projects/Project',
  agent_status: 'working',
  focused: true
}
const render = (blockedPanes: IPane[] = []) =>
  renderToStaticMarkup(
    <SidebarRoster
      workspaces={[workspace]}
      tabs={[tab]}
      panes={[pane]}
      selectedWorkspaceId="w1"
      onSelectWorkspace={() => {}}
      onOpenNewSpace={() => {}}
      onOpenCloseSpace={() => {}}
      onOpenSettings={() => {}}
      status="connected"
      blockedPanes={blockedPanes}
      onJumpToPane={() => {}}
    />
  )

it('selected Space roster omits nested tabs/panes while retaining Space controls and activity', () => {
  const html = render()
  expect(html).not.toContain('Tabs &amp; Panes')
  expect(html).not.toContain('sidebar-workspace-tabs')
  expect(html).not.toContain('Nested tab')
  expect(html).not.toContain('Nested agent')
  expect(html).not.toContain('New Shell Tab')
  expect(html).toContain('aria-current="page"')
  expect(html).toContain('1 Tab · 1 pane')
  expect(html).toContain('aria-label="New Space"')
  expect(html).toContain('aria-label="Close Project"')
  expect(html).toContain('space-status-dot--working')
  expect(html).toContain('Settings')
})

it('removing the nested list does not remove Needs input pane shortcuts', () => {
  const html = render([
    { ...pane, agent_status: 'blocked', title: 'Attention agent' }
  ])
  expect(html).toContain('Needs input')
  expect(html).toContain('Attention agent')
  expect(html).toContain('Jump to p1')
  expect(html).not.toContain('sidebar-workspace-tabs')
})
