export interface IVisualViewportMetrics {
  height: number
  layoutHeight?: number
  offsetTop?: number
  offsetLeft?: number
  scale?: number
}

export interface IVisualViewportGeometry {
  height: number
  offsetTop: number
}

/**
 * Calculates bounded visible viewport geometry (height and offsetTop).
 * Requires a finite positive layout-viewport height (via layoutHeight parameter or metrics.layoutHeight).
 * Rejects missing/non-finite/non-positive layout bounds and non-positive visual heights (never returns a zero-height app).
 * Ignores material pinch zoom (scale deviating from 1 by >= 0.05) returning null so layout falls back to 100dvh.
 * Rounds and clamps visual height to layout height.
 * Clamps offsetTop to 0..(layoutHeight - height) so offsetTop + height cannot escape the layout viewport.
 * Sanitizes and rounds offset values to prevent subpixel jitter and negative bounds.
 */
export const calculateVisibleViewportGeometry = (
  metrics: IVisualViewportMetrics | null | undefined,
  layoutHeight?: number
): IVisualViewportGeometry | null => {
  if (!metrics) {
    return null
  }

  const resolvedLayoutHeight = typeof layoutHeight === 'number'
    ? layoutHeight
    : metrics.layoutHeight

  if (
    typeof resolvedLayoutHeight !== 'number' ||
    !Number.isFinite(resolvedLayoutHeight) ||
    resolvedLayoutHeight <= 0
  ) {
    return null
  }

  if (
    typeof metrics.height !== 'number' ||
    !Number.isFinite(metrics.height) ||
    metrics.height <= 0
  ) {
    return null
  }

  const scale = metrics.scale ?? 1
  // If user is pinch-zooming (scale deviates from 1), do not constrain layout (fall back to 100dvh)
  if (Math.abs(scale - 1) >= 0.05) {
    return null
  }

  const roundedLayout = Math.round(resolvedLayoutHeight)
  if (roundedLayout <= 0) {
    return null
  }

  const roundedVisual = Math.round(metrics.height)
  if (roundedVisual <= 0) {
    return null
  }

  // Round and clamp visual height to layout height; never return zero or negative height
  const height = Math.min(roundedLayout, roundedVisual)
  if (height <= 0) {
    return null
  }

  let rawOffsetTop = 0
  if (typeof metrics.offsetTop === 'number' && Number.isFinite(metrics.offsetTop)) {
    rawOffsetTop = Math.max(0, Math.round(metrics.offsetTop))
  }

  // Clamp offsetTop to 0..(layoutHeight - height) so offset + height cannot escape layout viewport
  const maxOffsetTop = Math.max(0, roundedLayout - height)
  const offsetTop = Math.min(maxOffsetTop, rawOffsetTop)

  return {
    height,
    offsetTop
  }
}

/**
 * Backward-compatible helper for callers that only require height.
 */
export const calculateVisibleViewportHeight = (
  metrics: IVisualViewportMetrics | null | undefined,
  layoutHeight?: number
): number | null => {
  return calculateVisibleViewportGeometry(metrics, layoutHeight)?.height ?? null
}
