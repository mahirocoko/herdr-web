import { describe, expect, it } from 'bun:test'
import {
  getAvailableSurfaceModes,
  getPaneReadConfigForMode,
  resolveSurfaceMode
} from '../surface-mode.ts'

describe('surface-mode: resolveSurfaceMode', () => {
  it('defaults newly selected non-blocked pane to panel', () => {
    const result = resolveSurfaceMode({
      currentMode: 'stream',
      isBlocked: false,
      wasBlocked: false,
      paneChanged: true
    })
    expect(result).toBe('panel')
  })

  it('defaults newly selected blocked pane to question', () => {
    const result = resolveSurfaceMode({
      currentMode: 'stream',
      isBlocked: true,
      wasBlocked: false,
      paneChanged: true
    })
    expect(result).toBe('question')
  })

  it('transitions to question when pane becomes blocked', () => {
    const result = resolveSurfaceMode({
      currentMode: 'panel',
      isBlocked: true,
      wasBlocked: false,
      paneChanged: false
    })
    expect(result).toBe('question')
  })

  it('transitions to panel when pane is no longer blocked', () => {
    const result = resolveSurfaceMode({
      currentMode: 'question',
      isBlocked: false,
      wasBlocked: true,
      paneChanged: false
    })
    expect(result).toBe('panel')
  })

  it('forces unblocked pane out of question mode into panel', () => {
    const result = resolveSurfaceMode({
      currentMode: 'question',
      isBlocked: false,
      wasBlocked: false,
      paneChanged: false
    })
    expect(result).toBe('panel')
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
  it('returns Panel, History, and Stream for non-blocked panes', () => {
    const modes = getAvailableSurfaceModes(false)
    expect(modes).toEqual(['panel', 'history', 'stream'])
  })

  it('returns Question, Panel, History, and Stream for blocked panes', () => {
    const modes = getAvailableSurfaceModes(true)
    expect(modes).toEqual(['question', 'panel', 'history', 'stream'])
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
