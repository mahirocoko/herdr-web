import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { getNextFocusIndex } from '../global-drawer.tsx'
import { getConnectionStatusLabel, getStatusDotClass } from '@/utils/connection-status.ts'
import type { ISnapshotStatus } from '@/types/herdr.ts'

describe('global-drawer: pure helpers', () => {
  describe('getConnectionStatusLabel', () => {
    it('maps snapshot statuses to passive human labels accurately', () => {
      expect(getConnectionStatusLabel('connected')).toBe('Connected')
      expect(getConnectionStatusLabel('loading')).toBe('Connecting')
      expect(getConnectionStatusLabel('reconnecting')).toBe('Reconnecting')
      expect(getConnectionStatusLabel('error')).toBe('Offline')
      expect(getConnectionStatusLabel('empty')).toBe('Empty')
      expect(getConnectionStatusLabel('unknown' as ISnapshotStatus)).toBe('Offline')
    })
  })

  describe('getStatusDotClass', () => {
    it('maps status values to semantic dot classes matching HorizonHeader', () => {
      expect(getStatusDotClass('connected')).toBe('status-dot--connected')
      expect(getStatusDotClass('loading')).toBe('status-dot--reconnecting')
      expect(getStatusDotClass('reconnecting')).toBe('status-dot--reconnecting')
      expect(getStatusDotClass('error')).toBe('status-dot--error')
      expect(getStatusDotClass('empty')).toBe('status-dot--error')
      expect(getStatusDotClass('idle' as ISnapshotStatus)).toBe('status-dot--idle')
    })
  })

  describe('getNextFocusIndex', () => {
    it('handles empty list safely', () => {
      expect(getNextFocusIndex(0, 0, false)).toBe(-1)
      expect(getNextFocusIndex(-1, 0, false)).toBe(-1)
      expect(getNextFocusIndex(0, 0, true)).toBe(-1)
    })

    it('handles single item list safely', () => {
      expect(getNextFocusIndex(0, 1, false)).toBe(0)
      expect(getNextFocusIndex(-1, 1, false)).toBe(0)
      expect(getNextFocusIndex(0, 1, true)).toBe(0)
    })

    it('cycles forward with Tab and wraps around', () => {
      expect(getNextFocusIndex(0, 3, false)).toBe(1)
      expect(getNextFocusIndex(1, 3, false)).toBe(2)
      expect(getNextFocusIndex(2, 3, false)).toBe(0)
    })

    it('cycles backward with Shift+Tab and wraps around', () => {
      expect(getNextFocusIndex(2, 3, true)).toBe(1)
      expect(getNextFocusIndex(1, 3, true)).toBe(0)
      expect(getNextFocusIndex(0, 3, true)).toBe(2)
    })

    it('handles uncontained initial focus (-1)', () => {
      expect(getNextFocusIndex(-1, 4, false)).toBe(0)
      expect(getNextFocusIndex(-1, 4, true)).toBe(3)
    })
  })
})

describe('global-drawer & header contracts: source guarantees', () => {
  const globalDrawerPath = path.resolve(import.meta.dir, '../global-drawer.tsx')
  const globalDrawerContent = fs.readFileSync(globalDrawerPath, 'utf8')

  const horizonHeaderPath = path.resolve(import.meta.dir, '../horizon-header.tsx')
  const horizonHeaderContent = fs.readFileSync(horizonHeaderPath, 'utf8')

  const paneDrawerPath = path.resolve(import.meta.dir, '../pane-drawer.tsx')
  const paneDrawerContent = fs.readFileSync(paneDrawerPath, 'utf8')

  const cssPath = path.resolve(import.meta.dir, '../../app.css')
  const cssContent = fs.readFileSync(cssPath, 'utf8')

  it('proves GlobalDrawer implements accessible dialog and excludes speculative metadata', () => {
    expect(globalDrawerContent).toContain('className="global-drawer-overlay"')
    expect(globalDrawerContent).not.toContain('drawer-overlay global-drawer-overlay')
    expect(globalDrawerContent).toContain('role="dialog"')
    expect(globalDrawerContent).toContain('aria-modal="true"')
    expect(globalDrawerContent).toContain('aria-label="Application Menu"')
    expect(globalDrawerContent).toContain('role="status"')
    expect(globalDrawerContent).toContain('aria-live="polite"')
    expect(globalDrawerContent).toContain('Push Notifications')

    // Strict boundary: Do NOT add transport mode, daemon version, identity, reconnect action, metadata
    expect(globalDrawerContent).not.toContain('transport')
    expect(globalDrawerContent).not.toContain('daemon')
    expect(globalDrawerContent).not.toContain('version')
    expect(globalDrawerContent).not.toContain('onReconnect')
    expect(globalDrawerContent).not.toContain('ownerLogin')
    expect(globalDrawerContent).not.toContain('Tailscale')
  })

  it('proves HorizonHeader left is 44x44 menu trigger without visible Herdr Live text', () => {
    expect(horizonHeaderContent).toContain('horizon-header__menu-trigger')
    expect(horizonHeaderContent).toContain('horizon-header__menu-dot')
    expect(horizonHeaderContent).toContain(
      'aria-label={`Application menu, connection ${getConnectionStatusLabel(status)}`}'
    )
    expect(horizonHeaderContent).toContain('aria-controls="global-app-drawer"')
    expect(horizonHeaderContent).toContain('aria-controls="workspace-pane-drawer"')
    expect(horizonHeaderContent).not.toContain('Herdr Live')
  })

  it('proves PaneDrawer footer contains only New Shell Tab and has nav modifier for header', () => {
    expect(paneDrawerContent).toContain('drawer-sheet__header--nav')
    expect(paneDrawerContent).toContain('New Shell Tab')

    // Push Notifications removed from PaneDrawer
    const footerMatch = paneDrawerContent.match(/drawer-sheet__footer[\s\S]*?<\/div>/)
    expect(footerMatch).not.toBeNull()
    const footerContent = footerMatch![0]
    expect(footerContent).toContain('New Shell Tab')
    expect(footerContent).not.toContain('Push Notifications')
  })

  it('proves app.css establishes symmetric 3-column grid minmax(0,1fr) auto minmax(0,1fr) for new-tab header', () => {
    expect(cssContent).toContain('.drawer-sheet__header--nav')
    expect(cssContent).toContain('grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)')
    expect(cssContent).toContain('.horizon-header__workspace-trigger')
    expect(cssContent).toContain('max-width: calc(100% - 52px)')
  })
})
