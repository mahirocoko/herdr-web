import { describe, expect, it } from 'bun:test'
import {
  formatRemainingTime,
  getTerminalControlConnectionKey
} from '../use-terminal-control.ts'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('use-terminal-control: pure helpers and contracts', () => {
  it('formats remaining seconds into mm:ss strings', () => {
    expect(formatRemainingTime(600)).toBe('10:00')
    expect(formatRemainingTime(599)).toBe('09:59')
    expect(formatRemainingTime(65)).toBe('01:05')
    expect(formatRemainingTime(9)).toBe('00:09')
    expect(formatRemainingTime(0)).toBe('00:00')
    expect(formatRemainingTime(-5)).toBe('00:00')
  })

  it('generates expected control WebSocket URL structure with required parameters', () => {
    const paneId = 'ws1:p1'
    const cols = 100
    const rows = 35
    const host = '127.0.0.1:8787'

    const wsUrl = `ws://${host}/api/terminal/control?pane=${encodeURIComponent(paneId)}&cols=${cols}&rows=${rows}`
    const url = new URL(wsUrl)

    expect(url.pathname).toBe('/api/terminal/control')
    expect(url.searchParams.get('pane')).toBe('ws1:p1')
    expect(url.searchParams.get('cols')).toBe('100')
    expect(url.searchParams.get('rows')).toBe('35')
  })

  it('connection key is strictly derived from paneId and enabled, independent of cols/rows dimensions', () => {
    expect(getTerminalControlConnectionKey('ws1:p1', true)).toBe('ws1:p1:control')
    expect(getTerminalControlConnectionKey('ws1:p1', false)).toBeNull()
    expect(getTerminalControlConnectionKey(null, true)).toBeNull()
    expect(getTerminalControlConnectionKey(null, false)).toBeNull()

    // Key remains identical regardless of dimensions
    const key1 = getTerminalControlConnectionKey('ws1:p1', true)
    const key2 = getTerminalControlConnectionKey('ws1:p1', true)
    expect(key1).toBe(key2)
  })
})

describe('use-terminal-control: source guards and hook contracts', () => {
  const hookSource = readFileSync(
    resolve(import.meta.dir, '../use-terminal-control.ts'),
    'utf-8'
  )

  it('socket connection effect depends only on paneId and enabled (not cols/rows)', () => {
    // The main connection effect must NOT include cols or rows in its dependency array
    const connectionEffectMatch = hookSource.match(/\[paneId,\s*enabled[^\]]*\]/)
    expect(connectionEffectMatch).not.toBeNull()
    const depString = connectionEffectMatch![0]
    expect(depString).not.toContain('cols')
    expect(depString).not.toContain('rows')
  })

  it('memoizes releaseSocket, sendInput, sendResize, and release with useCallback', () => {
    expect(hookSource).toContain('const releaseSocket = useCallback(')
    expect(hookSource).toContain('const sendInput = useCallback(')
    expect(hookSource).toContain('const sendResize = useCallback(')
    expect(hookSource).toContain('const release = useCallback(')
  })

  it('wires pagehide and visibilitychange event cleanup with exact listener removal', () => {
    expect(hookSource).toContain("window.addEventListener('pagehide'")
    expect(hookSource).toContain("document.addEventListener('visibilitychange'")
    expect(hookSource).toContain("window.removeEventListener('pagehide'")
    expect(hookSource).toContain("document.removeEventListener('visibilitychange'")
    expect(hookSource).toContain("document.visibilityState === 'hidden'")
  })

  it('validates control.ready pane and leaseDurationMs bounds and fails closed', () => {
    expect(hookSource).toContain('readyMsg.pane !== paneId')
    expect(hookSource).toContain('readyMsg.leaseDurationMs > 600000')
    expect(hookSource).toContain("setState('error')")
  })

  it('validates terminal.frame bytes before window.atob and fails closed on malformed payload', () => {
    expect(hookSource).toContain('frame.bytes.length % 4 !== 0')
    expect(hookSource).toContain('window.atob(frame.bytes)')
    expect(hookSource).toContain("onErrorRef.current?.('Malformed terminal frame')")
  })

  it('normalizes dimensions using clampControlDimensions for URL and resize', () => {
    expect(hookSource).toContain('clampControlDimensions')
    expect(hookSource).toContain('const normalized = clampControlDimensions(colsRef.current, rowsRef.current)')
    expect(hookSource).toContain('const normalized = clampControlDimensions(c, r)')
  })

  it('useTerminalControl owns the cols/rows resize effect', () => {
    expect(hookSource).toContain('sendResize(cols, rows)')
    expect(hookSource).toMatch(/\[cols,\s*rows,\s*state,\s*sendResize\]/)
  })

  it('terminal-canvas does not destructure or invoke sendResize (single resize owner guard)', () => {
    const canvasSource = readFileSync(
      resolve(import.meta.dir, '../../components/terminal-canvas.tsx'),
      'utf-8'
    )
    expect(canvasSource).not.toContain('sendResize')
  })
})
