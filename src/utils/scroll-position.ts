export interface IScrollBounds {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export interface ICalculateNewScrollTopParams {
  followLatest: boolean
  prevScrollTop: number
  prevScrollHeight: number
  newScrollHeight: number
  clientHeight: number
  prevDistanceFromBottom?: number
}

/**
 * Returns true if the scroll position is within threshold px of the bottom,
 * or if the content completely fits within the viewport.
 */
export const isNearBottom = (
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = 48
): boolean => {
  if (scrollHeight <= clientHeight) {
    return true
  }
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight
  return distanceFromBottom <= threshold
}

/**
 * Calculates current distance from bottom in pixels, clamped to >= 0.
 */
export const calculateDistanceFromBottom = (
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number
): number => {
  return Math.max(0, scrollHeight - scrollTop - clientHeight)
}

/**
 * Calculates the target scrollTop after a content update or poll.
 * If followLatest is true, snaps to the newest bottom output.
 * If followLatest is false, preserves user's reading position using distance-from-bottom
 * or stable scrollTop so new content at the bottom does not disrupt the user.
 */
export const calculateNewScrollTop = ({
  followLatest,
  prevScrollTop,
  newScrollHeight,
  clientHeight,
  prevDistanceFromBottom
}: ICalculateNewScrollTopParams): number => {
  const maxScroll = Math.max(0, newScrollHeight - clientHeight)

  if (followLatest) {
    return maxScroll
  }

  // When reading position was preserved by distance from bottom
  if (typeof prevDistanceFromBottom === 'number') {
    const preserved = newScrollHeight - clientHeight - prevDistanceFromBottom
    return Math.min(Math.max(0, preserved), maxScroll)
  }

  // Fallback to previous scrollTop clamped to current scroll bounds
  return Math.min(Math.max(0, prevScrollTop), maxScroll)
}
