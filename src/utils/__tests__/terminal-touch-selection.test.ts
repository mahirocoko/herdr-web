import { describe, expect, it, mock } from 'bun:test'
import {
  getTerminalCellFromTouch,
  isWhitespaceChar,
  findWordSelectionRange,
  calculateDragSelection,
  attachTerminalTouchSelection,
  MOVEMENT_THRESHOLD_PX,
  LONG_PRESS_DURATION_MS
} from '@/utils/terminal-touch-selection.ts'

describe('terminal-touch-selection: coordinate translation', () => {
  const fakeScreen = {
    getBoundingClientRect: () => ({
      left: 10,
      top: 20,
      width: 800,
      height: 480
    })
  }

  it('translates touch coordinates accurately given screen bounding rect and terminal dimensions', () => {
    // 80 cols, 24 rows -> colWidth = 10, rowHeight = 20
    const cell = getTerminalCellFromTouch(
      { clientX: 65, clientY: 70 }, // relative: x=55 (col 5), y=50 (row 2)
      fakeScreen,
      80,
      24,
      0
    )
    expect(cell.col).toBe(5)
    expect(cell.viewportRow).toBe(2)
    expect(cell.bufferRow).toBe(2)
  })

  it('accounts for buffer viewportY offset', () => {
    const cell = getTerminalCellFromTouch(
      { clientX: 65, clientY: 70 },
      fakeScreen,
      80,
      24,
      100 // scrolled down 100 rows in scrollback buffer
    )
    expect(cell.col).toBe(5)
    expect(cell.viewportRow).toBe(2)
    expect(cell.bufferRow).toBe(102)
  })

  it('clamps coordinates to grid boundaries', () => {
    const outLeft = getTerminalCellFromTouch(
      { clientX: -50, clientY: -10 },
      fakeScreen,
      80,
      24,
      0
    )
    expect(outLeft.col).toBe(0)
    expect(outLeft.viewportRow).toBe(0)

    const outRight = getTerminalCellFromTouch(
      { clientX: 1000, clientY: 600 },
      fakeScreen,
      80,
      24,
      0
    )
    expect(outRight.col).toBe(79)
    expect(outRight.viewportRow).toBe(23)
  })

  it('handles zero or invalid dimensions gracefully', () => {
    const cell = getTerminalCellFromTouch(
      { clientX: 50, clientY: 50 },
      {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 })
      },
      80,
      24,
      5
    )
    expect(cell.col).toBe(0)
    expect(cell.viewportRow).toBe(0)
    expect(cell.bufferRow).toBe(5)
  })
})

describe('terminal-touch-selection: word and line range discovery', () => {
  it('correctly identifies whitespace characters', () => {
    expect(isWhitespaceChar('')).toBe(true)
    expect(isWhitespaceChar(' ')).toBe(true)
    expect(isWhitespaceChar('\t')).toBe(true)
    expect(isWhitespaceChar('\u00a0')).toBe(true)
    expect(isWhitespaceChar('A')).toBe(false)
    expect(isWhitespaceChar('ไทย')).toBe(false)
    expect(isWhitespaceChar('-')).toBe(false)
  })

  it('selects ASCII word around touched column', () => {
    // line text: "echo hello world"
    const text = 'echo hello world'
    const fakeLine = {
      length: text.length,
      getCell: (x: number) => {
        if (x < 0 || x >= text.length) return undefined
        return {
          getChars: () => text[x],
          getWidth: () => 1
        }
      }
    }

    // Touching on 'l' in "hello" (col 7)
    const result = findWordSelectionRange(fakeLine, 7, 10, 80)
    expect(result.isLine).toBe(false)
    expect(result.range.startCol).toBe(5)
    expect(result.range.bufferRow).toBe(10)
    expect(result.range.length).toBe(5) // "hello" is 5 chars
  })

  it('selects Thai word with combining marks without cutting glyphs', () => {
    // In xterm, combining marks (vowels/tones) are bundled into the base cell
    const cells = [
      'ท',
      'ด',
      'ส',
      'อ',
      'บ',
      'ข้',
      'อ',
      'ค',
      'วา',
      'ม',
      'ไ',
      'ท',
      'ย'
    ]
    const fakeLine = {
      length: cells.length,
      getCell: (x: number) => {
        if (x < 0 || x >= cells.length) return undefined
        return {
          getChars: () => cells[x],
          getWidth: () => 1
        }
      }
    }

    // Touching anywhere in the Thai text
    const result = findWordSelectionRange(fakeLine, 5, 0, 80)
    expect(result.isLine).toBe(false)
    expect(result.range.startCol).toBe(0)
    expect(result.range.length).toBe(13)
  })

  it('preserves CJK wide characters (width 2 + width 0 continuation)', () => {
    // "A [CJK1:width2] [CJK1_cont:width0] B"
    const cells = [
      { chars: 'A', width: 1 },
      { chars: '中', width: 2 },
      { chars: '', width: 0 },
      { chars: 'B', width: 1 }
    ]
    const fakeLine = {
      length: cells.length,
      getCell: (x: number) =>
        cells[x]
          ? { getChars: () => cells[x].chars, getWidth: () => cells[x].width }
          : undefined
    }

    // Touching the continuation cell (index 2)
    const resultFromContinuation = findWordSelectionRange(fakeLine, 2, 0, 80)
    expect(resultFromContinuation.isLine).toBe(false)
    expect(resultFromContinuation.range.startCol).toBe(0)
    expect(resultFromContinuation.range.length).toBe(4) // whole contiguous token "A中B"
  })

  it('does not include trailing whitespace when touching the wide continuation', () => {
    const cells = [
      { chars: '中', width: 2 },
      { chars: '', width: 0 },
      { chars: ' ', width: 1 }
    ]
    const line = {
      length: cells.length,
      getCell: (col: number) =>
        cells[col]
          ? {
              getChars: () => cells[col]!.chars,
              getWidth: () => cells[col]!.width
            }
          : undefined
    }
    expect(findWordSelectionRange(line, 1, 0, 3).range.length).toBe(2)
  })

  it('returns whole line when touched on empty or whitespace cell', () => {
    const text = 'hello          world'
    const fakeLine = {
      length: text.length,
      getCell: (x: number) => {
        if (x < 0 || x >= text.length) return undefined
        return {
          getChars: () => text[x],
          getWidth: () => 1
        }
      }
    }

    // Touching space at index 8
    const result = findWordSelectionRange(fakeLine, 8, 15, 80)
    expect(result.isLine).toBe(true)
    expect(result.range.startCol).toBe(0)
    expect(result.range.bufferRow).toBe(15)
    expect(result.range.length).toBe(text.length)
  })
})

describe('terminal-touch-selection: drag calculation', () => {
  it('calculates single-line forward drag', () => {
    const range = calculateDragSelection(
      { col: 5, bufferRow: 2 },
      { col: 15, bufferRow: 2 },
      80
    )
    expect(range.startCol).toBe(5)
    expect(range.bufferRow).toBe(2)
    expect(range.length).toBe(11) // 15 - 5 + 1
  })

  it('calculates single-line backward drag', () => {
    const range = calculateDragSelection(
      { col: 15, bufferRow: 2 },
      { col: 5, bufferRow: 2 },
      80
    )
    expect(range.startCol).toBe(5)
    expect(range.bufferRow).toBe(2)
    expect(range.length).toBe(11)
  })

  it('calculates multi-line forward drag spanning across terminal columns', () => {
    const range = calculateDragSelection(
      { col: 10, bufferRow: 1 },
      { col: 20, bufferRow: 3 },
      80
    )
    expect(range.startCol).toBe(10)
    expect(range.bufferRow).toBe(1)
    // Row 1: cols 10..79 = 70 cols
    // Row 2: cols 0..79 = 80 cols
    // Row 3: cols 0..20 = 21 cols
    // Total = 70 + 80 + 21 = 171
    // Formula: (3 - 1) * 80 + (20 - 10) + 1 = 160 + 10 + 1 = 171
    expect(range.length).toBe(171)
  })
})

describe('terminal-touch-selection: listener attachment and gesture threshold', () => {
  it('keeps deltas relative to each new gesture after swipe, release and tap', () => {
    const listeners: Record<string, Function> = {}
    const deltas: number[] = []
    const container = {
      addEventListener: (name: string, fn: Function) => {
        listeners[name] = fn
      },
      removeEventListener: () => {},
      style: {}
    } as any
    const term = { hasSelection: () => false }
    const cleanup = attachTerminalTouchSelection({
      container,
      getTerminal: () => term as any,
      isObserverMode: () => true,
      onSelection: () => {},
      onClearSelection: () => {},
      onTouchScroll: (delta) => deltas.push(delta)
    })
    const touch = (name: string, y: number) =>
      listeners[name]({
        touches: [{ clientX: 50, clientY: y }],
        cancelable: true,
        preventDefault: () => {}
      })
    touch('touchstart', 400)
    touch('touchmove', 445)
    listeners.touchend({ touches: [] })
    expect(deltas).toEqual([2])
    touch('touchstart', 100)
    touch('touchmove', 101)
    listeners.touchend({ touches: [] })
    expect(deltas).toEqual([2])
    touch('touchstart', 100)
    touch('touchmove', 119)
    expect(deltas).toEqual([2])
    touch('touchmove', 121)
    expect(deltas).toEqual([2, 1])
    listeners.touchcancel({ touches: [] })
    touch('touchstart', 500)
    touch('touchmove', 520)
    expect(deltas).toEqual([2, 1, 1])
    cleanup()
  })

  it('cancels selection and leaves ordinary pan intact when touch moves beyond threshold before timer', async () => {
    const listeners: Record<string, Function[]> = {}
    const container = {
      addEventListener: (evt: string, fn: Function) => {
        listeners[evt] = listeners[evt] || []
        listeners[evt].push(fn)
      },
      removeEventListener: (evt: string, fn: Function) => {
        listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn)
      },
      querySelector: () => ({
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 800,
          height: 480
        })
      }),
      style: {}
    } as any

    const term = {
      cols: 80,
      rows: 24,
      buffer: { active: { viewportY: 0, getLine: () => undefined } },
      select: mock(() => {}),
      selectLines: mock(() => {}),
      getSelection: () => 'selected',
      hasSelection: () => true,
      clearSelection: mock(() => {})
    }

    const onSelection = mock(() => {})
    const onClearSelection = mock(() => {})

    const cleanup = attachTerminalTouchSelection({
      container,
      getTerminal: () => term as any,
      isObserverMode: () => true,
      onSelection,
      onClearSelection
    })

    // Dispatch touchstart
    listeners['touchstart'][0]({
      touches: [{ clientX: 50, clientY: 50 }]
    })

    // Move more than MOVEMENT_THRESHOLD_PX before timer fires
    listeners['touchmove'][0]({
      touches: [{ clientX: 50 + MOVEMENT_THRESHOLD_PX + 5, clientY: 50 }],
      cancelable: true,
      preventDefault: mock(() => {})
    })

    // Wait past duration
    await new Promise((resolve) =>
      setTimeout(resolve, LONG_PRESS_DURATION_MS + 20)
    )

    // Selection should NOT have triggered because user was panning
    expect(term.select).not.toHaveBeenCalled()
    expect(onSelection).not.toHaveBeenCalled()

    cleanup()
  })

  it('triggers selection after long press duration when movement is below threshold', async () => {
    const listeners: Record<string, Function[]> = {}
    const container = {
      addEventListener: (evt: string, fn: Function) => {
        listeners[evt] = listeners[evt] || []
        listeners[evt].push(fn)
      },
      removeEventListener: (evt: string, fn: Function) => {
        listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn)
      },
      querySelector: () => ({
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 800,
          height: 480
        })
      }),
      style: {}
    } as any

    const text = 'hello'
    const term = {
      cols: 80,
      rows: 24,
      buffer: {
        active: {
          viewportY: 0,
          getLine: () => ({
            length: 5,
            getCell: (x: number) => ({
              getChars: () => text[x] || '',
              getWidth: () => 1
            })
          })
        }
      },
      select: mock(() => {}),
      selectLines: mock(() => {}),
      getSelection: () => 'hello',
      hasSelection: () => true,
      clearSelection: mock(() => {})
    }

    const onSelection = mock(() => {})
    const onClearSelection = mock(() => {})

    const cleanup = attachTerminalTouchSelection({
      container,
      getTerminal: () => term as any,
      isObserverMode: () => true,
      onSelection,
      onClearSelection
    })

    // Dispatch touchstart at col 0, row 0 (clientX: 5, clientY: 5)
    listeners['touchstart'][0]({
      touches: [{ clientX: 5, clientY: 5 }]
    })

    // Wait for timer
    await new Promise((resolve) =>
      setTimeout(resolve, LONG_PRESS_DURATION_MS + 20)
    )

    expect(term.select).toHaveBeenCalled()
    expect(onSelection).toHaveBeenCalledWith('hello')

    // Native context menus must not interrupt an active custom selection gesture.
    const preventDefault = mock(() => {})
    listeners.contextmenu[0]({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)
    listeners.touchend[0]({ touches: [] })
    listeners.contextmenu[0]({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(1)

    cleanup()
  })
})
