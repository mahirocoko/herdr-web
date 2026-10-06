import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import NavigationSearchSheet from '../navigation-search-sheet.tsx'
import type { IPane, ITab, IWorkspace } from '@/types/herdr.ts'
import {
  selectBestPaneForTab,
  selectBestPaneForWorkspace,
} from '@/utils/workspace-helpers.ts'

describe('NavigationSearch: cross-space/tab/pane snapshot navigation', () => {
  const mockWorkspaces: IWorkspace[] = [
    {
      workspace_id: 'ws1',
      number: 1,
      label: 'Main Project',
      tab_count: 2,
      pane_count: 3,
      focused: true,
      agent_status: 'working',
    },
    {
      workspace_id: 'ws2',
      number: 2,
      label: 'Documentation',
      tab_count: 1,
      pane_count: 1,
      focused: false,
      agent_status: 'idle',
    },
  ]

  const mockTabs: ITab[] = [
    {
      tab_id: 'ws1:t1',
      workspace_id: 'ws1',
      number: 1,
      label: 'editor',
      pane_count: 2,
      focused: true,
      agent_status: 'idle',
    },
    {
      tab_id: 'ws1:t2',
      workspace_id: 'ws1',
      number: 2,
      label: 'build',
      pane_count: 1,
      focused: false,
      agent_status: 'working',
    },
    {
      tab_id: 'ws2:t1',
      workspace_id: 'ws2',
      number: 1,
      label: 'docs-preview',
      pane_count: 1,
      focused: false,
      agent_status: 'idle',
    },
  ]

  const mockPanes: IPane[] = [
    {
      pane_id: 'ws1:t1:p1',
      workspace_id: 'ws1',
      tab_id: 'ws1:t1',
      title: 'Neovim Editor',
      cwd: '/Users/mahiro/project/src',
      focused: true,
      agent_status: 'idle',
    },
    {
      pane_id: 'ws1:t1:p2',
      workspace_id: 'ws1',
      tab_id: 'ws1:t1',
      title: 'Agent Reviewer',
      display_agent: 'Claude Scout',
      cwd: '/Users/mahiro/project',
      focused: false,
      agent_status: 'blocked',
    },
    {
      pane_id: 'ws1:t2:p1',
      workspace_id: 'ws1',
      tab_id: 'ws1:t2',
      title: 'Bun Test Runner',
      cwd: '/Users/mahiro/project',
      focused: false,
      agent_status: 'working',
    },
    {
      pane_id: 'ws2:t1:p1',
      workspace_id: 'ws2',
      tab_id: 'ws2:t1',
      title: 'Vite Docs Dev Server',
      cwd: '/Users/mahiro/docs',
      focused: false,
      agent_status: 'idle',
    },
  ]

  it('truthfully defers portal popup markup in static SSR when isOpen is true (Base UI Dialog portal contract)', () => {
    const html = renderToStaticMarkup(
      <NavigationSearchSheet
        isOpen={true}
        workspaces={mockWorkspaces}
        tabs={mockTabs}
        panes={mockPanes}
        selectedWorkspaceId="ws1"
        selectedPaneId="ws1:t1:p1"
        onSelectPane={() => {}}
        onClose={() => {}}
      />,
    )
    expect(html).toBe('')
  })

  it('declares canonical Base UI Sheet, autofocus input, and clear search results anatomy', () => {
    const sheetPath = path.resolve(
      import.meta.dir,
      '../navigation-search-sheet.tsx',
    )
    const sheetContent = fs.readFileSync(sheetPath, 'utf8')

    expect(sheetContent).toContain('<Sheet')
    expect(sheetContent).toContain('<SheetContent')
    expect(sheetContent).toContain('navigation-search-sheet')
    expect(sheetContent).toContain('navigation-search-bar')
    expect(sheetContent).toContain('navigation-search-results')
    expect(sheetContent).toContain('navigation-search-item')
    expect(sheetContent).toContain('selectBestPaneForWorkspace')
    expect(sheetContent).toContain('selectBestPaneForTab')
  })

  it('resolves real target pane when selecting Space via selectBestPaneForWorkspace', () => {
    // When selecting ws1, blocked agent pane ws1:t1:p2 should be chosen first
    const resolvedPane = selectBestPaneForWorkspace(mockPanes, 'ws1')
    expect(resolvedPane?.pane_id).toBe('ws1:t1:p2')

    // When selecting ws2, ws2:t1:p1 should be chosen
    const ws2Pane = selectBestPaneForWorkspace(mockPanes, 'ws2')
    expect(ws2Pane?.pane_id).toBe('ws2:t1:p1')
  })

  it('resolves real target pane when selecting Tab via selectBestPaneForTab without cross-tab drift', () => {
    // When selecting tab ws1:t2, only panes in ws1:t2 can be selected
    const resolvedPane = selectBestPaneForTab(
      mockPanes,
      'ws1:t2',
      'ws1',
      'ws1:t1:p1', // current pane is in t1
    )
    expect(resolvedPane?.pane_id).toBe('ws1:t2:p1')
    expect(resolvedPane?.tab_id).toBe('ws1:t2')

    // In tab ws1:t1, if current pane is ws1:t1:p1, preserves current pane
    const preservedPane = selectBestPaneForTab(
      mockPanes,
      'ws1:t1',
      'ws1',
      'ws1:t1:p1',
    )
    expect(preservedPane?.pane_id).toBe('ws1:t1:p1')
  })

  it('truthfully rejects selection when tab has no panes (honest empty state)', () => {
    const emptyTabPane = selectBestPaneForTab(
      mockPanes,
      'nonexistent_tab',
      'ws1',
    )
    expect(emptyTabPane).toBeNull()
  })

  it('enforces command picker reset and navigation search separation in app and composer', () => {
    const appPath = path.resolve(import.meta.dir, '../../app.tsx')
    const appContent = fs.readFileSync(appPath, 'utf8')

    // HorizonHeader uses onOpenSearch (not palette)
    expect(appContent).toContain('onOpenSearch={() => setIsSearchOpen(true)}')

    // TabRail is mounted under HorizonHeader inside pane-column
    expect(appContent).toContain('<TabRail')

    // PromptComposer onPickerOpenChange resets pickerInitialTab to 'commands'
    expect(appContent).toContain("setPickerInitialTab('commands')")

    // ThumbDeck Manage sets pickerInitialTab to 'rail'
    expect(appContent).toContain("setPickerInitialTab('rail')")

    // NavigationSearchSheet is mounted
    expect(appContent).toContain('<NavigationSearchSheet')
  })

  it('owns multi-line result row height in recipes.css preventing default button 34px clip', () => {
    const recipesPath = path.resolve(import.meta.dir, '../ui/recipes.css')
    const recipesContent = fs.readFileSync(recipesPath, 'utf8')

    expect(recipesContent).toContain('.ui-button.navigation-search-item')
    expect(recipesContent).toContain(
      '.ui-button--default-size.navigation-search-item',
    )
    expect(recipesContent).toContain('min-height: 52px')
    expect(recipesContent).toContain('height: auto')
  })

  describe('resolveNavigationTarget: owner-local pure resolution and stale/reparented rejection', () => {
    const {
      resolveNavigationTarget,
    } = require('../navigation-search-sheet.tsx')

    it('resolves live space, tab, and pane targets truthfully', () => {
      // Space target
      const spaceItem = {
        id: 'space_ws1',
        type: 'space',
        spaceId: 'ws1',
      }
      const spaceRes = resolveNavigationTarget(
        spaceItem,
        mockWorkspaces,
        mockTabs,
        mockPanes,
      )
      expect(spaceRes).toEqual({
        paneId: 'ws1:t1:p2', // prioritized blocked pane
        workspaceId: 'ws1',
      })

      // Tab target
      const tabItem = {
        id: 'tab_ws1:t2',
        type: 'tab',
        spaceId: 'ws1',
        tabId: 'ws1:t2',
      }
      const tabRes = resolveNavigationTarget(
        tabItem,
        mockWorkspaces,
        mockTabs,
        mockPanes,
      )
      expect(tabRes).toEqual({
        paneId: 'ws1:t2:p1',
        workspaceId: 'ws1',
      })

      // Pane target
      const paneItem = {
        id: 'pane_ws1:t1:p1',
        type: 'pane',
        spaceId: 'ws1',
        tabId: 'ws1:t1',
        paneId: 'ws1:t1:p1',
      }
      const paneRes = resolveNavigationTarget(
        paneItem,
        mockWorkspaces,
        mockTabs,
        mockPanes,
      )
      expect(paneRes).toEqual({
        paneId: 'ws1:t1:p1',
        workspaceId: 'ws1',
      })
    })

    it('rejects deleted or missing panes truthfully (returns null)', () => {
      const deletedPaneItem = {
        id: 'pane_deleted',
        type: 'pane',
        spaceId: 'ws1',
        tabId: 'ws1:t1',
        paneId: 'ws1:t1:p_deleted',
      }
      const res = resolveNavigationTarget(
        deletedPaneItem,
        mockWorkspaces,
        mockTabs,
        mockPanes,
      )
      expect(res).toBeNull()
    })

    it('rejects reparented panes where spaceId does not match current snapshot (returns null)', () => {
      // Item claims pane is in ws2, but pane is actually in ws1
      const reparentedSpaceItem = {
        id: 'pane_ws1:t1:p1',
        type: 'pane',
        spaceId: 'ws2',
        tabId: 'ws1:t1',
        paneId: 'ws1:t1:p1',
      }
      const res = resolveNavigationTarget(
        reparentedSpaceItem,
        mockWorkspaces,
        mockTabs,
        mockPanes,
      )
      expect(res).toBeNull()
    })

    it('rejects reparented panes where tabId does not match current snapshot (returns null)', () => {
      // Item claims pane is in ws1:t2, but pane is actually in ws1:t1
      const reparentedTabItem = {
        id: 'pane_ws1:t1:p1',
        type: 'pane',
        spaceId: 'ws1',
        tabId: 'ws1:t2',
        paneId: 'ws1:t1:p1',
      }
      const res = resolveNavigationTarget(
        reparentedTabItem,
        mockWorkspaces,
        mockTabs,
        mockPanes,
      )
      expect(res).toBeNull()
    })

    it('rejects empty space or empty tab truthfully without fake fallback', () => {
      const emptySpaceItem = {
        id: 'space_ws_empty',
        type: 'space',
        spaceId: 'ws_empty',
      }
      expect(
        resolveNavigationTarget(
          emptySpaceItem,
          [
            ...mockWorkspaces,
            {
              workspace_id: 'ws_empty',
              number: 3,
              label: 'empty',
              tab_count: 0,
              pane_count: 0,
              focused: false,
              agent_status: 'unknown',
            },
          ],
          mockTabs,
          mockPanes,
        ),
      ).toBeNull()

      const emptyTabItem = {
        id: 'tab_ws1:t_empty',
        type: 'tab',
        spaceId: 'ws1',
        tabId: 'ws1:t_empty',
      }
      expect(
        resolveNavigationTarget(
          emptyTabItem,
          mockWorkspaces,
          [
            ...mockTabs,
            {
              tab_id: 'ws1:t_empty',
              workspace_id: 'ws1',
              number: 9,
              label: 'empty',
              pane_count: 0,
              focused: false,
              agent_status: 'unknown',
            },
          ],
          mockPanes,
        ),
      ).toBeNull()
    })
  })

  describe('accessible feedback and IME / modifier handling', () => {
    it('declares polite live region and aria-controls for screen readers', () => {
      const sheetPath = path.resolve(
        import.meta.dir,
        '../navigation-search-sheet.tsx',
      )
      const sheetContent = fs.readFileSync(sheetPath, 'utf8')

      // Screen-reader live announcement
      expect(sheetContent).toContain('aria-live="polite"')
      expect(sheetContent).toContain('aria-atomic="true"')
      expect(sheetContent).toContain(
        'aria-controls="navigation-search-results"',
      )
      expect(sheetContent).toContain('id="navigation-search-results"')

      // IME composition and keyCode 229 guards
      expect(sheetContent).toContain('e.nativeEvent.isComposing')
      expect(sheetContent).toContain('e.keyCode === 229')

      // Modifier key checks
      expect(sheetContent).toContain(
        'e.altKey || e.ctrlKey || e.metaKey || e.shiftKey',
      )
    })
  })
})
