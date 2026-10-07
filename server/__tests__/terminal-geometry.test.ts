import { describe, expect, test } from 'bun:test'
import { resolveNativeTerminalGeometry } from '../terminal-geometry.ts'

describe('authoritative observer geometry', () => {
  const geometry = (width: number, height: number) => ({
    type: 'pane_layout',
    layout: { panes: [{ pane_id: 'own', rect: { width, height } }] }
  })
  test('preserves full source grid rather than phone projection', () => {
    expect(resolveNativeTerminalGeometry(geometry(160, 52), 'own')).toEqual({
      cols: 160,
      rows: 52
    })
  })
  test('never selects a neighboring or duplicate pane', () => {
    expect(() =>
      resolveNativeTerminalGeometry(geometry(160, 52), 'other')
    ).toThrow()
    const duplicate = geometry(160, 52)
    duplicate.layout.panes.push(duplicate.layout.panes[0]!)
    expect(() => resolveNativeTerminalGeometry(duplicate, 'own')).toThrow()
  })
  test('rejects invalid geometry rather than silently clamping and hiding output', () => {
    for (const [width, height] of [
      [0, 52],
      [160, 0],
      [501, 52],
      [160, 201],
      [1.5, 20]
    ]) {
      expect(() =>
        resolveNativeTerminalGeometry(geometry(width!, height!), 'own')
      ).toThrow()
    }
    expect(() => resolveNativeTerminalGeometry(null, 'own')).toThrow()
  })
})
