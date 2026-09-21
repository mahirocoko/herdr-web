export interface ITerminalDimensions {
  cols: number
  rows: number
}

export const DEFAULT_TERMINAL_DIMENSIONS: ITerminalDimensions = {
  cols: 80,
  rows: 24
}

export const MIN_COLS = 20
export const MAX_COLS = 500
export const MIN_ROWS = 5
export const MAX_ROWS = 200

export const MIN_CONTROL_COLS = 40
export const MAX_CONTROL_COLS = 240
export const MIN_CONTROL_ROWS = 12
export const MAX_CONTROL_ROWS = 80
export const DEFAULT_CONTROL_COLS = 80
export const DEFAULT_CONTROL_ROWS = 24

export const clampControlDimensions = (
  cols: number,
  rows: number
): ITerminalDimensions => {
  const parsedCols = Number.isFinite(cols) ? Math.floor(cols) : DEFAULT_CONTROL_COLS
  const parsedRows = Number.isFinite(rows) ? Math.floor(rows) : DEFAULT_CONTROL_ROWS

  const safeCols = Math.max(MIN_CONTROL_COLS, Math.min(MAX_CONTROL_COLS, parsedCols))
  const safeRows = Math.max(MIN_CONTROL_ROWS, Math.min(MAX_CONTROL_ROWS, parsedRows))

  return { cols: safeCols, rows: safeRows }
}

export const clampTerminalDimensions = (
  cols: number,
  rows: number
): ITerminalDimensions => {
  const parsedCols = Number.isFinite(cols) ? Math.floor(cols) : DEFAULT_TERMINAL_DIMENSIONS.cols
  const parsedRows = Number.isFinite(rows) ? Math.floor(rows) : DEFAULT_TERMINAL_DIMENSIONS.rows

  const safeCols = Math.max(MIN_COLS, Math.min(MAX_COLS, parsedCols))
  const safeRows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, parsedRows))

  return { cols: safeCols, rows: safeRows }
}

export const haveDimensionsChanged = (
  prev: ITerminalDimensions,
  next: ITerminalDimensions
): boolean => {
  return prev.cols !== next.cols || prev.rows !== next.rows
}

export const debounce = <T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number
): { (...args: Parameters<T>): void; cancel: () => void } => {
  let timer: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: Parameters<T>) => {
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, delayMs)
  }

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return debounced
}
