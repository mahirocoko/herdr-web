import { describe, expect, it } from 'bun:test'
import {
  getAvailableSurfaceModes,
  getPaneReadConfigForMode,
  resolveSurfaceMode
} from '../surface-mode.ts'

describe('surface-mode: resolveSurfaceMode', () => {
  it('returns to Terminal when selecting another pane from History', () => {
    expect(
      resolveSurfaceMode({
        currentMode: 'history',
        isBlocked: true,
        wasBlocked: false,
        paneChanged: true
      })
    ).toBe('stream')
  })

  it('preserves History through blocked and unblocked transitions', () => {
    for (const isBlocked of [true, false]) {
      expect(
        resolveSurfaceMode({
          currentMode: 'history',
          isBlocked,
          wasBlocked: !isBlocked,
          paneChanged: false
        })
      ).toBe('history')
    }
  })

  it('defaults newly selected non-blocked pane to live Terminal', () => {
    const result = resolveSurfaceMode({
      currentMode: 'stream',
      isBlocked: false,
      wasBlocked: false,
      paneChanged: true
    })
    expect(result).toBe('stream')
  })

  it('keeps a newly selected blocked pane in live Terminal', () => {
    const result = resolveSurfaceMode({
      currentMode: 'stream',
      isBlocked: true,
      wasBlocked: false,
      paneChanged: true
    })
    expect(result).toBe('stream')
  })

  it('does not hijack the reading surface when pane becomes blocked', () => {
    const result = resolveSurfaceMode({
      currentMode: 'panel',
      isBlocked: true,
      wasBlocked: false,
      paneChanged: false
    })
    expect(result).toBe('panel')
  })

  it('returns an explicitly opened question to Terminal when asking ends', () => {
    const result = resolveSurfaceMode({
      currentMode: 'question',
      isBlocked: false,
      wasBlocked: true,
      paneChanged: false
    })
    expect(result).toBe('stream')
  })

  it('returns stale question mode to Terminal', () => {
    const result = resolveSurfaceMode({
      currentMode: 'question',
      isBlocked: false,
      wasBlocked: false,
      paneChanged: false
    })
    expect(result).toBe('stream')
  })

  it('preserves user chosen stream mode on non-blocked pane', () => {
    const result = resolveSurfaceMode({
      currentMode: 'stream',
      isBlocked: false,
      wasBlocked: false,
      paneChanged: false
    })
    expect(result).toBe('stream')
  })

  it('preserves user chosen history mode on non-blocked pane', () => {
    const result = resolveSurfaceMode({
      currentMode: 'history',
      isBlocked: false,
      wasBlocked: false,
      paneChanged: false
    })
    expect(result).toBe('history')
  })

  it('preserves user chosen panel mode on non-blocked pane', () => {
    const result = resolveSurfaceMode({
      currentMode: 'panel',
      isBlocked: false,
      wasBlocked: false,
      paneChanged: false
    })
    expect(result).toBe('panel')
  })

  it('preserves user chosen stream mode while pane remains blocked', () => {
    const result = resolveSurfaceMode({
      currentMode: 'stream',
      isBlocked: true,
      wasBlocked: true,
      paneChanged: false
    })
    expect(result).toBe('stream')
  })

  it('preserves user chosen history mode while pane remains blocked', () => {
    const result = resolveSurfaceMode({
      currentMode: 'history',
      isBlocked: true,
      wasBlocked: true,
      paneChanged: false
    })
    expect(result).toBe('history')
  })

  it('preserves user chosen panel mode while pane remains blocked', () => {
    const result = resolveSurfaceMode({
      currentMode: 'panel',
      isBlocked: true,
      wasBlocked: true,
      paneChanged: false
    })
    expect(result).toBe('panel')
  })
})

describe('surface-mode: getAvailableSurfaceModes', () => {
  it('offers Terminal and History for non-blocked panes', () => {
    const modes = getAvailableSurfaceModes(false)
    expect(modes).toEqual(['stream', 'history'])
  })

  it('adds an explicit Question view for blocked panes', () => {
    const modes = getAvailableSurfaceModes(true)
    expect(modes).toEqual(['stream', 'question', 'history'])
  })
})

describe('surface-mode: getPaneReadConfigForMode', () => {
  it('configures panel with visible source, no lines, and 1000ms polling', () => {
    const config = getPaneReadConfigForMode('panel')
    expect(config).toEqual({
      source: 'visible',
      pollIntervalMs: 1000
    })
  })

  it('configures history with recent-unwrapped source, 1000 lines, and 2000ms polling', () => {
    const config = getPaneReadConfigForMode('history')
    expect(config).toEqual({
      source: 'recent-unwrapped',
      lines: 1000,
      pollIntervalMs: 2000
    })
  })

  it('configures question with detection source and active polling when blocked', () => {
    const configBlocked = getPaneReadConfigForMode('question', true)
    expect(configBlocked).toEqual({
      source: 'detection',
      pollIntervalMs: 2000
    })

    const configUnblocked = getPaneReadConfigForMode('question', false)
    expect(configUnblocked).toEqual({
      source: 'detection',
      pollIntervalMs: 0
    })
  })

  it('returns null for stream mode because it uses WebSocket observer instead of pane read', () => {
    const config = getPaneReadConfigForMode('stream')
    expect(config).toBeNull()
  })
})
