import { describe, expect, test } from 'bun:test'
import {
  clampControlDimensions,
  clampTerminalDimensions,
  debounce,
  DEFAULT_CONTROL_COLS,
  DEFAULT_CONTROL_ROWS,
  DEFAULT_TERMINAL_DIMENSIONS,
  haveDimensionsChanged,
  MAX_COLS,
  MAX_CONTROL_COLS,
  MAX_CONTROL_ROWS,
  MAX_ROWS,
  MIN_COLS,
  MIN_CONTROL_COLS,
  MIN_CONTROL_ROWS,
  MIN_ROWS
} from '../terminal-geometry.ts'

describe('terminal-geometry: clampControlDimensions', () => {
  test('returns standard dimensions for values within valid range', () => {
    const dim = clampControlDimensions(100, 30)
    expect(dim).toEqual({ cols: 100, rows: 30 })
  })

  test('clamps dimensions below minimum bounds', () => {
    const dim = clampControlDimensions(10, 5)
    expect(dim).toEqual({ cols: MIN_CONTROL_COLS, rows: MIN_CONTROL_ROWS })
  })

  test('clamps dimensions above maximum bounds', () => {
    const dim = clampControlDimensions(300, 100)
    expect(dim).toEqual({ cols: MAX_CONTROL_COLS, rows: MAX_CONTROL_ROWS })
  })

  test('handles NaN and non-finite values by falling back to control defaults', () => {
    const dim = clampControlDimensions(NaN, NaN)
    expect(dim).toEqual({
      cols: DEFAULT_CONTROL_COLS,
      rows: DEFAULT_CONTROL_ROWS
    })
  })

  test('floors fractional dimensions', () => {
    const dim = clampControlDimensions(80.9, 24.7)
    expect(dim).toEqual({ cols: 80, rows: 24 })
  })
})

describe('terminal-geometry: clampTerminalDimensions', () => {
  test('returns standard dimensions for values within valid range', () => {
    const dim = clampTerminalDimensions(100, 30)
    expect(dim).toEqual({ cols: 100, rows: 30 })
  })

  test('clamps dimensions below minimum bounds', () => {
    const dim = clampTerminalDimensions(10, 2)
    expect(dim).toEqual({ cols: MIN_COLS, rows: MIN_ROWS })
  })

  test('clamps dimensions above maximum bounds', () => {
    const dim = clampTerminalDimensions(600, 250)
    expect(dim).toEqual({ cols: MAX_COLS, rows: MAX_ROWS })
  })

  test('handles NaN and non-finite values by falling back to defaults', () => {
    const dim = clampTerminalDimensions(NaN, NaN)
    expect(dim).toEqual({
      cols: DEFAULT_TERMINAL_DIMENSIONS.cols,
      rows: DEFAULT_TERMINAL_DIMENSIONS.rows
    })
  })
})

describe('terminal-geometry: haveDimensionsChanged', () => {
  test('returns false when dimensions are identical', () => {
    expect(haveDimensionsChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(false)
  })

  test('returns true when cols change', () => {
    expect(haveDimensionsChanged({ cols: 80, rows: 24 }, { cols: 100, rows: 24 })).toBe(true)
  })

  test('returns true when rows change', () => {
    expect(haveDimensionsChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 30 })).toBe(true)
  })
})

describe('terminal-geometry: debounce', () => {
  test('debounces multiple rapid calls to single execution', async () => {
    let callCount = 0
    let lastValue = ''

    const fn = (val: string) => {
      callCount++
      lastValue = val
    }

    const debounced = debounce(fn, 50)

    debounced('call-1')
    debounced('call-2')
    debounced('call-3')

    expect(callCount).toBe(0)

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(callCount).toBe(1)
    expect(lastValue).toBe('call-3')
  })

  test('cancel stops scheduled execution', async () => {
    let callCount = 0
    const fn = () => {
      callCount++
    }

    const debounced = debounce(fn, 50)
    debounced()
    debounced.cancel()

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(callCount).toBe(0)
  })
})
