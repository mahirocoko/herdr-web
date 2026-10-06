import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import React from 'react'
import ReactDOMServer from 'react-dom/server'
import TabActionsMenu from '../tab-actions-menu.tsx'
import {
  freezeTabCloseConfirmation,
  tabConfirmationChanged,
} from '@/utils/lifecycle-operations.ts'
import type { IPane, ITab } from '@/types/herdr.ts'

describe('tab actions and settings placement contract', () => {
  const sidebarRosterPath = path.resolve(
    import.meta.dir,
    '../sidebar-roster.tsx',
  )
  const sidebarRosterContent = fs.readFileSync(sidebarRosterPath, 'utf8')
  const horizonHeaderPath = path.resolve(
    import.meta.dir,
    '../horizon-header.tsx',
  )
  const horizonHeaderContent = fs.readFileSync(horizonHeaderPath, 'utf8')
  const paneDrawerPath = path.resolve(import.meta.dir, '../pane-drawer.tsx')
  const paneDrawerContent = fs.readFileSync(paneDrawerPath, 'utf8')
  const appPath = path.resolve(import.meta.dir, '../../app.tsx')
  const appContent = fs.readFileSync(appPath, 'utf8')

  it('moves Settings to sidebar footer and removes settings navigation from header ellipsis', () => {
    // SidebarRoster footer renders truthful Settings with push status
    expect(sidebarRosterContent).toContain('<span>Settings</span>')
    expect(sidebarRosterContent).toContain(
      "pushState === 'active' ? 'Push active' : 'Push off'",
    )
    expect(sidebarRosterContent).toContain('aria-label="Open settings"')

    // HorizonHeader delegates ellipsis trigger to TabActionsMenu, not onOpenSettings
    expect(horizonHeaderContent).toContain('<TabActionsMenu')
    expect(horizonHeaderContent).not.toContain('onClick={onOpenSettings')
  })

  it('requires active tab strictly from selectedPane and workspace in app.tsx (never first random tab)', () => {
    expect(appContent).toContain('const activeTab = useMemo(')
    expect(appContent).toContain('t.tab_id === selectedPane.tab_id')
    expect(appContent).toContain('!workspaceId || t.workspace_id === workspaceId')
  })

  it('shows visible reason (Close Space instead) for last tab in Space', () => {
    const dummyTab: ITab = {
      tab_id: 't-1',
      workspace_id: 'ws-1',
      number: 1,
      label: 'Main',
      focused: true,
      agent_status: 'idle',
      pane_count: 1,
    }

    const html = ReactDOMServer.renderToString(
      React.createElement(TabActionsMenu, {
        activeTab: dummyTab,
        isLastTab: true,
        onNewShellTab: () => {},
        onCloseCurrentTab: () => {},
      }),
    )

    // Base UI menu trigger renders with accessible label
    expect(html).toContain('aria-label="Current tab actions"')
    expect(html).toContain('header-more-button')

    // Inspect component source to guarantee visible subtext explains the last-tab policy
    const tabActionsSource = fs.readFileSync(
      path.resolve(import.meta.dir, '../tab-actions-menu.tsx'),
      'utf8',
    )
    expect(tabActionsSource).toContain(
      'Last tab in Space (Close Space instead)',
    )
  })

  it('provides actionable Review operation route when lifecycle ticket gates Close', () => {
    const tabActionsSource = fs.readFileSync(
      path.resolve(import.meta.dir, '../tab-actions-menu.tsx'),
      'utf8',
    )
    expect(tabActionsSource).toContain('Review operation')
    expect(tabActionsSource).toContain('onReviewOperation')
    expect(tabActionsSource).toContain('Outcome unknown')
    expect(tabActionsSource).toContain('Reconciliation failed')
    expect(tabActionsSource).toContain('Operation pending')
  })

  it('does not substitute tab navigation or no-op callbacks for missing action owners', () => {
    const headerSource = fs.readFileSync(
      path.resolve(import.meta.dir, '../horizon-header.tsx'),
      'utf8',
    )
    expect(headerSource).not.toContain('onNewShellTab || onOpenTabs')
    expect(headerSource).not.toContain('onCloseCurrentTab || (() => {})')
    expect(headerSource).not.toContain('onOpenSettings')
  })

  it('uses the canonical ghost icon Button recipe for the Menu trigger', () => {
    const menuSource = fs.readFileSync(
      path.resolve(import.meta.dir, '../tab-actions-menu.tsx'),
      'utf8',
    )
    expect(menuSource).toContain('render={<Button variant="ghost" size="icon" />}')
  })

  it('does not restore menu focus to the hidden header when handing off to a modal sheet', () => {
    const menuSource = fs.readFileSync(
      path.resolve(import.meta.dir, '../tab-actions-menu.tsx'),
      'utf8',
    )
    expect(menuSource).toContain('finalFocus={() => !isFocusHandoffRef.current}')
    expect(menuSource).toContain('if (open) isFocusHandoffRef.current = false')
    expect(menuSource.match(/isFocusHandoffRef.current = true/g)?.length).toBe(3)
  })

  it('enforces frozen membership invariants on intentional open in PaneDrawer', () => {
    // PaneDrawer extends initialView with close-tab and status, and accepts initialTargetTabId
    expect(paneDrawerContent).toContain(
      "initialView?: 'list' | 'new-tab' | 'close-tab' | 'status'",
    )
    expect(paneDrawerContent).toContain('initialTargetTabId?: string | null')

    // PaneDrawer uses initializedIntentRef guard so snapshot polling cannot re-freeze membership
    expect(paneDrawerContent).toContain(
      'const initializedIntentRef = useRef<string | null>(null)',
    )
    expect(paneDrawerContent).toContain(
      'if (initializedIntentRef.current === intentKey) return',
    )
    expect(paneDrawerContent).toContain(
      'freezeTabCloseConfirmation(targetTab, panes)',
    )

    // Unit test frozen membership verification pure logic
    const tab: ITab = {
      tab_id: 't-target',
      workspace_id: 'ws-1',
      number: 1,
      label: 'Target Tab',
      focused: true,
      agent_status: 'idle',
      pane_count: 1,
    }
    const initialPanes: IPane[] = [
      {
        pane_id: 'p-1',
        tab_id: 't-target',
        workspace_id: 'ws-1',
        cwd: '/repo',
        focused: true,
        agent_status: 'idle',
      },
    ]

    const frozen = freezeTabCloseConfirmation(tab, initialPanes)
    expect(frozen.tabId).toBe('t-target')
    expect(frozen.paneCount).toBe(1)
    expect(frozen.expected.paneIds).toEqual(['p-1'])

    // No drift when panes remain unchanged
    expect(tabConfirmationChanged(frozen, initialPanes)).toBe(false)

    // Drift detected if another pane was added during polling
    const driftedPanes: IPane[] = [
      ...initialPanes,
      {
        pane_id: 'p-2',
        tab_id: 't-target',
        workspace_id: 'ws-1',
        cwd: '/repo',
        focused: false,
        agent_status: 'working',
      },
    ]
    expect(tabConfirmationChanged(frozen, driftedPanes)).toBe(true)
  })
})
