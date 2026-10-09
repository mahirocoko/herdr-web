import { describe, expect, it } from 'bun:test'
import {
  getAvailableSurfaceModes,
  getPaneReadConfigForMode,
  resolveSurfaceMode
} from '../surface-mode.ts'

describe('surface-mode: resolveSurfaceMode', () => {
  it('returns to Terminal when selecting another pane from Chat', () => {
    expect(
      resolveSurfaceMode({
        currentMode: 'chat',
        isBlocked: true,
        wasBlocked: false,
        paneChanged: true
      })
    ).toBe('stream')
  })

  it('preserves Chat through blocked and unblocked transitions', () => {
    for (const isBlocked of [true, false]) {
      expect(
        resolveSurfaceMode({
          currentMode: 'chat',
          isBlocked,
          wasBlocked: !isBlocked,
          paneChanged: false
        })
      ).toBe('chat')
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

  it('preserves user chosen chat mode on non-blocked pane', () => {
    const result = resolveSurfaceMode({
      currentMode: 'chat',
      isBlocked: false,
      wasBlocked: false,
      paneChanged: false
    })
    expect(result).toBe('chat')
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

  it('preserves user chosen chat mode while pane remains blocked', () => {
    const result = resolveSurfaceMode({
      currentMode: 'chat',
      isBlocked: true,
      wasBlocked: true,
      paneChanged: false
    })
    expect(result).toBe('chat')
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
  it('offers Terminal and Chat for non-blocked agent panes', () => {
    const modes = getAvailableSurfaceModes(false, true)
    expect(modes).toEqual(['stream', 'chat'])
  })

  it('adds an explicit Question view for blocked agent panes', () => {
    const modes = getAvailableSurfaceModes(true, true)
    expect(modes).toEqual(['stream', 'question', 'chat'])
  })

  it('offers only Terminal for shell panes', () => {
    expect(getAvailableSurfaceModes(false, false)).toEqual(['stream'])
    expect(getAvailableSurfaceModes(true, false)).toEqual(['stream'])
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

  it('returns null for chat and stream mode because they do not use text pane read', () => {
    expect(getPaneReadConfigForMode('chat')).toBeNull()
    expect(getPaneReadConfigForMode('stream')).toBeNull()
  })
})
