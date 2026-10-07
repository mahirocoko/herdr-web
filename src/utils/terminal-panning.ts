/**
 * Pure helpers for terminal observer panning, cursor follow, and Latest affordance.
 */

export interface IScrollBounds {
  scrollTop: number
  scrollLeft: number
  clientHeight: number
  scrollHeight: number
  clientWidth: number
  scrollWidth: number
}

/**
 * Determines if auto-follow should remain active.
 * Auto-follow stops when the user has panned or when an active selection exists.
 */
export const shouldFollowLatest = (
  isPanned: boolean,
  hasSelection: boolean
): boolean => {
  return !isPanned && !hasSelection
}

/** A native grid can have blank rows BELOW its prompt; bottom distance is not reading intent. */
export const isScrolledAwayFromCursor = (
  scrollTop: number,
  cursorTargetTop: number,
  threshold = 24
): boolean => Math.abs(scrollTop - cursorTargetTop) > threshold

/**
 * Calculates follow scrollTop based on active cursor row in terminal screen.
 * Keeps cursor/prompt in view: top if it fits, else scrolls down so cursor row is visible.
 */
export const calculateFollowScrollTop = (
  cursorY: number,
  totalRows: number,
  screenHeight: number,
  screenOffsetTop: number,
  clientHeight: number,
  scrollHeight: number
): number => {
  if (totalRows <= 0 || screenHeight <= 0 || scrollHeight <= clientHeight) {
    return 0
  }

  const rowHeight = screenHeight / totalRows
  const cursorBottom = screenOffsetTop + (cursorY + 1) * rowHeight
  const maxScroll = Math.max(0, scrollHeight - clientHeight)

  if (cursorBottom <= clientHeight) {
    return 0
  }

  const target = cursorBottom - clientHeight
  return Math.min(maxScroll, Math.max(0, target))
}

/**
 * Computes Latest restore scroll position.
 * Crucially preserves horizontal pan position (scrollLeft), only restoring vertical visibility.
 */
export const calculateLatestScrollPosition = (
  currentScrollLeft: number,
  maxScrollTop: number
): { scrollLeft: number; scrollTop: number } => {
  return {
    scrollLeft: Math.max(0, currentScrollLeft),
    scrollTop: Math.max(0, maxScrollTop)
  }
}

/**
 * Checks if the user is scrolled away from the bottom.
 * Threshold prevents jitter when near the bottom boundary.
 */
export const isScrolledAwayFromBottom = (
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold = 24
): boolean => {
  if (scrollHeight <= clientHeight) return false
  return scrollTop + clientHeight < scrollHeight - threshold
}
