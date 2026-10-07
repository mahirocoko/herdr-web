/**
 * Terminal Touch Selection Helper
 * Provides mobile long-press selection and drag extension for terminal observer canvas
 * using public xterm.js APIs without modifying native PTY or acquiring control.
 */

export interface ITouchPoint {
  clientX: number
  clientY: number
}

export interface ITerminalCellCoords {
  col: number
  viewportRow: number
  bufferRow: number
}

export interface ISelectionRange {
  startCol: number
  bufferRow: number
  length: number
}

export interface ITerminalLineCell {
  getChars: () => string
  getWidth: () => number
}

export interface ITerminalLineLike {
  getCell: (x: number) => ITerminalLineCell | undefined
  length: number
}

export interface ITerminalLike {
  cols: number
  rows: number
  buffer: {
    active: {
      viewportY: number
      getLine: (row: number) => ITerminalLineLike | undefined
    }
  }
  select: (column: number, row: number, length: number) => void
  selectLines: (start: number, end: number) => void
  getSelection: () => string
  hasSelection: () => boolean
  clearSelection: () => void
}

export const MOVEMENT_THRESHOLD_PX = 8
export const LONG_PRESS_DURATION_MS = 450

/**
 * Converts screen touch coordinates to terminal cell coordinates.
 * Uses .xterm-screen bounding rect (which includes transforms and local scroll).
 */
export const getTerminalCellFromTouch = (
  touch: ITouchPoint,
  screenElement: {
    getBoundingClientRect: () => {
      left: number
      top: number
      width: number
      height: number
    }
  },
  terminalCols: number,
  terminalRows: number,
  viewportY: number
): ITerminalCellCoords => {
  const rect = screenElement.getBoundingClientRect()
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    terminalCols <= 0 ||
    terminalRows <= 0
  ) {
    return { col: 0, viewportRow: 0, bufferRow: viewportY }
  }

  const colWidth = rect.width / terminalCols
  const rowHeight = rect.height / terminalRows

  const rawCol = Math.floor((touch.clientX - rect.left) / colWidth)
  const rawRow = Math.floor((touch.clientY - rect.top) / rowHeight)

  const col = Math.max(0, Math.min(terminalCols - 1, rawCol))
  const viewportRow = Math.max(0, Math.min(terminalRows - 1, rawRow))
  const bufferRow = viewportY + viewportRow

  return { col, viewportRow, bufferRow }
}

export const isWhitespaceChar = (chars: string): boolean => {
  if (!chars || chars.length === 0) return true
  return chars.trim().length === 0
}

/**
 * Finds the word selection range around the touched cell.
 * Handles Thai combining marks (stored within cell characters)
 * and CJK wide characters (width 2 + continuation cell width 0) without cutting them.
 * If touched cell is whitespace/empty, selects the whole line to provide grounded economical selection.
 */
export const findWordSelectionRange = (
  line: ITerminalLineLike | undefined,
  touchedCol: number,
  bufferRow: number,
  terminalCols: number
): { range: ISelectionRange; isLine: boolean } => {
  if (!line || terminalCols <= 0) {
    return {
      range: { startCol: 0, bufferRow, length: Math.max(1, terminalCols) },
      isLine: true
    }
  }

  const maxCols = Math.min(terminalCols, line.length)
  if (maxCols <= 0) {
    return {
      range: { startCol: 0, bufferRow, length: terminalCols },
      isLine: true
    }
  }

  const clampedCol = Math.max(0, Math.min(maxCols - 1, touchedCol))
  let startCol = clampedCol
  let cell = line.getCell(startCol)

  // If touched cell is width 0 (continuation cell of wide char), shift to width-2 leader
  if (cell && cell.getWidth() === 0 && startCol > 0) {
    const prev = line.getCell(startCol - 1)
    if (prev && prev.getWidth() === 2) {
      startCol--
      cell = prev
    }
  }

  const cellChars = cell ? cell.getChars() : ''

  // If touched on whitespace or empty cell, treat as line selection
  if (isWhitespaceChar(cellChars)) {
    return {
      range: { startCol: 0, bufferRow, length: maxCols },
      isLine: true
    }
  }

  // Scan leftwards to find word start
  while (startCol > 0) {
    const prevCell = line.getCell(startCol - 1)
    if (!prevCell) break
    const prevChars = prevCell.getChars()
    if (isWhitespaceChar(prevChars)) break

    // If prev cell is continuation of a wide char, check the leader
    if (prevCell.getWidth() === 0 && startCol > 1) {
      const wideLeader = line.getCell(startCol - 2)
      if (wideLeader && wideLeader.getWidth() === 2) {
        if (isWhitespaceChar(wideLeader.getChars())) break
        startCol -= 2
        continue
      }
    }

    startCol--
  }

  let endCol = clampedCol

  // If cell is wide char (width 2), include its continuation cell
  if (line.getCell(clampedCol)?.getWidth() === 2 && endCol + 1 < maxCols) {
    endCol++
  }

  // Scan rightwards to find word end
  while (endCol < maxCols - 1) {
    const nextCell = line.getCell(endCol + 1)
    if (!nextCell) break
    const nextChars = nextCell.getChars()
    if (isWhitespaceChar(nextChars)) break

    endCol++
    // If nextCell has width 2, include its continuation cell
    if (nextCell.getWidth() === 2 && endCol + 1 < maxCols) {
      endCol++
    }
  }

  const length = Math.max(1, endCol - startCol + 1)
  return {
    range: { startCol, bufferRow, length },
    isLine: false
  }
}

/**
 * Calculates selection range when dragging to extend selection.
 * Supports multi-line and reverse drag directions.
 */
export const calculateDragSelection = (
  anchor: { col: number; bufferRow: number },
  cursor: { col: number; bufferRow: number },
  terminalCols: number
): ISelectionRange => {
  const isAnchorFirst =
    anchor.bufferRow < cursor.bufferRow ||
    (anchor.bufferRow === cursor.bufferRow && anchor.col <= cursor.col)

  const start = isAnchorFirst ? anchor : cursor
  const end = isAnchorFirst ? cursor : anchor

  const length =
    (end.bufferRow - start.bufferRow) * terminalCols + (end.col - start.col) + 1

  return {
    startCol: start.col,
    bufferRow: start.bufferRow,
    length: Math.max(1, length)
  }
}

export interface ITouchSelectionOptions {
  container: HTMLElement
  getTerminal: () => ITerminalLike | null
  isObserverMode: () => boolean
  onSelection: (text: string) => void
  onClearSelection: () => void
  onTouchSelectingChange?: (isSelecting: boolean) => void
  onTouchScroll?: (deltaRows: number) => void
}

/**
 * Attaches touch gesture listeners to container for mobile text selection.
 * Handles long-press word/line selection and drag extension.
 * Leaves ordinary pan and pinch-zoom intact when movement or multi-touch occurs before threshold.
 * Returns cleanup function.
 */
export const attachTerminalTouchSelection = (
  options: ITouchSelectionOptions
): (() => void) => {
  const {
    container,
    getTerminal,
    isObserverMode,
    onSelection,
    onClearSelection,
    onTouchSelectingChange,
    onTouchScroll
  } = options

  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let startPoint: ITouchPoint | null = null
  let lastTouchY = 0
  let accumulatedDeltaY = 0
  let isSelecting = false
  let isMoved = false
  let anchorCell: { col: number; bufferRow: number } | null = null

  const clearTimer = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }

  const setSelectingState = (val: boolean) => {
    isSelecting = val
    onTouchSelectingChange?.(val)
    if (val) {
      container.style.touchAction = 'none'
    } else {
      container.style.touchAction = ''
    }
  }

  const handleTouchStart = (e: TouchEvent) => {
    if (!isObserverMode()) return

    // Multi-touch immediately cancels long-press and selection
    if (e.touches.length !== 1) {
      clearTimer()
      setSelectingState(false)
      anchorCell = null
      return
    }

    const touch = e.touches[0]
    startPoint = { clientX: touch.clientX, clientY: touch.clientY }
    // A gesture starts here, not at screen origin or the previous finger's endpoint.
    lastTouchY = touch.clientY
    accumulatedDeltaY = 0
    isMoved = false
    clearTimer()

    longPressTimer = setTimeout(() => {
      const term = getTerminal()
      if (!term || !isObserverMode() || !startPoint) return

      const screenEl =
        container.querySelector<HTMLElement>('.xterm-screen') ?? container
      const coords = getTerminalCellFromTouch(
        startPoint,
        screenEl,
        term.cols,
        term.rows,
        term.buffer.active.viewportY
      )

      const line = term.buffer.active.getLine(coords.bufferRow)
      const wordResult = findWordSelectionRange(
        line,
        coords.col,
        coords.bufferRow,
        term.cols
      )

      if (wordResult.isLine) {
        term.selectLines(coords.bufferRow, coords.bufferRow)
        anchorCell = { col: 0, bufferRow: coords.bufferRow }
      } else {
        term.select(
          wordResult.range.startCol,
          wordResult.range.bufferRow,
          wordResult.range.length
        )
        anchorCell = {
          col: wordResult.range.startCol,
          bufferRow: wordResult.range.bufferRow
        }
      }

      const text = term.getSelection()
      if (text) {
        setSelectingState(true)
        onSelection(text)
      }
    }, LONG_PRESS_DURATION_MS)
  }

  const handleTouchMove = (e: TouchEvent) => {
    if (!isObserverMode()) return

    if (!isSelecting) {
      if (startPoint && e.touches.length === 1) {
        const touch = e.touches[0]
        const dist = Math.hypot(
          touch.clientX - startPoint.clientX,
          touch.clientY - startPoint.clientY
        )
        if (dist > MOVEMENT_THRESHOLD_PX) {
          isMoved = true
          clearTimer()

          if (onTouchScroll) {
            const dy = touch.clientY - lastTouchY
            accumulatedDeltaY += dy
            lastTouchY = touch.clientY

            const rowHeight = 20
            if (Math.abs(accumulatedDeltaY) >= rowHeight) {
              const rows = Math.trunc(accumulatedDeltaY / rowHeight)
              accumulatedDeltaY -= rows * rowHeight
              // In mobile touch: dragging downward (dy > 0) pulls content down -> reveals lines above -> scrolls UP (positive deltaRows)
              // Dragging upward (dy < 0) pushes content up -> reveals lines below -> scrolls DOWN (negative deltaRows)
              onTouchScroll(rows)
            }

            if (e.cancelable) {
              e.preventDefault()
            }
          }
        }
      }
      return
    }

    // While selecting, dragging extends selection
    if (e.cancelable) {
      e.preventDefault()
    }

    if (e.touches.length === 1 && anchorCell) {
      const term = getTerminal()
      if (!term) return
      const screenEl =
        container.querySelector<HTMLElement>('.xterm-screen') ?? container
      const currentCoords = getTerminalCellFromTouch(
        e.touches[0],
        screenEl,
        term.cols,
        term.rows,
        term.buffer.active.viewportY
      )

      const dragRange = calculateDragSelection(
        anchorCell,
        { col: currentCoords.col, bufferRow: currentCoords.bufferRow },
        term.cols
      )

      term.select(dragRange.startCol, dragRange.bufferRow, dragRange.length)

      const text = term.getSelection()
      if (text) {
        onSelection(text)
      }
    }
  }

  const handleTouchEnd = () => {
    clearTimer()

    if (isSelecting) {
      setSelectingState(false)
      const term = getTerminal()
      const text = term?.getSelection()
      if (text) {
        onSelection(text)
      }
      anchorCell = null
      return
    }

    // Short tap without movement on the canvas clears selection if present
    if (!isMoved && startPoint) {
      const term = getTerminal()
      if (term && term.hasSelection()) {
        term.clearSelection()
        onClearSelection()
      }
    }

    startPoint = null
    anchorCell = null
  }

  const handleTouchCancel = () => {
    clearTimer()
    setSelectingState(false)
    startPoint = null
    anchorCell = null
  }

  const handleContextMenu = (event: Event) => {
    if (isObserverMode() && isSelecting) event.preventDefault()
  }

  container.addEventListener('touchstart', handleTouchStart, { passive: true })
  container.addEventListener('touchmove', handleTouchMove, { passive: false })
  container.addEventListener('touchend', handleTouchEnd, { passive: true })
  container.addEventListener('touchcancel', handleTouchCancel, {
    passive: true
  })
  container.addEventListener('contextmenu', handleContextMenu)

  return () => {
    clearTimer()
    setSelectingState(false)
    container.removeEventListener('touchstart', handleTouchStart)
    container.removeEventListener('touchmove', handleTouchMove)
    container.removeEventListener('touchend', handleTouchEnd)
    container.removeEventListener('touchcancel', handleTouchCancel)
    container.removeEventListener('contextmenu', handleContextMenu)
  }
}
