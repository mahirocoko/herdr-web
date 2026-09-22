import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  getNextSpaceDrawerFocusIndex,
  getWorkspaceStatusDotClass
} from '../space-drawer.tsx'

describe('space-drawer: pure helpers', () => {
  it('cycles focus within the modal sheet', () => {
    expect(getNextSpaceDrawerFocusIndex(0, 0, false)).toBe(-1)
    expect(getNextSpaceDrawerFocusIndex(-1, 1, false)).toBe(0)
    expect(getNextSpaceDrawerFocusIndex(2, 3, false)).toBe(0)
    expect(getNextSpaceDrawerFocusIndex(0, 3, true)).toBe(2)
  })

  it('maps upstream Space attention values to distinct truthful dots', () => {
    expect(getWorkspaceStatusDotClass('blocked')).toBe('space-status-dot--blocked')
    expect(getWorkspaceStatusDotClass('working')).toBe('space-status-dot--working')
    expect(getWorkspaceStatusDotClass('done')).toBe('space-status-dot--done')
    expect(getWorkspaceStatusDotClass('idle')).toBe('space-status-dot--idle')
    expect(getWorkspaceStatusDotClass('unknown')).toBe('space-status-dot--unknown')
  })
})

describe('source-led Space and Tab sheet contracts', () => {
  const spaceDrawerPath = path.resolve(import.meta.dir, '../space-drawer.tsx')
  const spaceDrawerContent = fs.readFileSync(spaceDrawerPath, 'utf8')
  const paneDrawerPath = path.resolve(import.meta.dir, '../pane-drawer.tsx')
  const paneDrawerContent = fs.readFileSync(paneDrawerPath, 'utf8')
  const horizonHeaderPath = path.resolve(import.meta.dir, '../horizon-header.tsx')
  const horizonHeaderContent = fs.readFileSync(horizonHeaderPath, 'utf8')
  const cssPath = path.resolve(import.meta.dir, '../../app.css')
  const cssContent = fs.readFileSync(cssPath, 'utf8')

  it('keeps the Herdr-style Spaces sheet accessible and Space-owned', () => {
    expect(spaceDrawerContent).toContain('id="space-drawer"')
    expect(spaceDrawerContent).toContain('aria-label="Spaces"')
    expect(spaceDrawerContent).toContain('aria-label="Herdr Spaces"')
    expect(spaceDrawerContent).toContain('Space lifecycle actions')
    expect(spaceDrawerContent).toContain('New Space')
    expect(spaceDrawerContent).toContain('Close Space')
    expect(spaceDrawerContent).toContain('Push Notifications')
    expect(spaceDrawerContent).toContain('role="status"')
    expect(spaceDrawerContent).not.toContain('New Shell Tab')
    expect(spaceDrawerContent).not.toContain('Close Tab')

    // Strict boundary: do not invent unavailable Herdr metadata.
    expect(spaceDrawerContent).not.toContain('branch')
    expect(spaceDrawerContent).not.toContain('git status')
    expect(spaceDrawerContent).not.toContain('transport')
    expect(spaceDrawerContent).not.toContain('ownerLogin')
  })

  it('keeps Tabs and Panes scoped to the active Space', () => {
    expect(paneDrawerContent).toContain('id="tab-pane-drawer"')
    expect(paneDrawerContent).toContain('Tabs & Panes')
    expect(paneDrawerContent).toContain('New Shell Tab')
    expect(paneDrawerContent).toContain('Close Tab')
    expect(paneDrawerContent).toContain('Use Close Space for the last Tab')
    expect(paneDrawerContent).not.toContain('drawer-sheet__workspaces-scroll')
    expect(paneDrawerContent).not.toContain('drawer-lifecycle-actions')
    expect(paneDrawerContent).not.toContain('ws-pill')
    expect(paneDrawerContent).not.toContain('New Space')
  })

  it('wires distinct Space and Tab triggers in the header', () => {
    expect(horizonHeaderContent).toContain('aria-controls="space-drawer"')
    expect(horizonHeaderContent).toContain('aria-controls="tab-pane-drawer"')
    expect(horizonHeaderContent).toContain('aria-label="Open Tabs and Panes"')
    expect(horizonHeaderContent).not.toContain('Switch workspace and pane')
    expect(horizonHeaderContent).not.toContain('workspace-pane-drawer')
  })

  it('provides source-led hierarchy and touch-safe controls', () => {
    expect(cssContent).toContain('.space-drawer-item')
    expect(cssContent).toContain('grid-template-columns: 10px minmax(0, 1fr) 24px')
    expect(cssContent).toContain('.space-drawer-item--selected')
    expect(cssContent).toContain('.horizon-header__tab-trigger')
    expect(cssContent).toContain('min-height: 44px')
  })
})
