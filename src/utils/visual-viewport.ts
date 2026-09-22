export interface IVisualViewportMetrics {
  height: number
  layoutHeight?: number
  offsetTop?: number
  offsetLeft?: number
  scale?: number
  hasEditableFocus?: boolean
}

export interface IVisualViewportGeometry {
  height: number
  offsetTop: number
  isKeyboardOpen: boolean
}

export interface ILayoutViewportHeightMetrics {
  windowInnerHeight?: number
  documentClientHeight?: number
  visualHeight?: number
  visualOffsetTop?: number
}

/**
 * Minimum layout-minus-visual height reduction (in CSS pixels) required while an editable element
 * has focus to classify the viewport reduction as an active software keyboard rather
 * than browser URL bar/chrome expansion, subpixel fluctuations, or hardware keyboard accessory bars.
 */
export const KEYBOARD_MIN_HEIGHT_THRESHOLD_PX = 120

/**
 * Resolves a layout bound that cannot collapse above the visible viewport bottom.
 * iOS Safari may shrink window.innerHeight while the keyboard also pans visualViewport,
 * so using innerHeight alone can clamp a valid offsetTop back to zero.
 */
export const resolveLayoutViewportHeight = (
  metrics: ILayoutViewportHeightMetrics
): number => {
  const finitePositive = (value: number | undefined): number => {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : 0
  }

  const visualHeight = finitePositive(metrics.visualHeight)
  const visualOffsetTop = typeof metrics.visualOffsetTop === 'number' &&
    Number.isFinite(metrics.visualOffsetTop)
    ? Math.max(0, metrics.visualOffsetTop)
    : 0

  return Math.max(
    finitePositive(metrics.windowInnerHeight),
    finitePositive(metrics.documentClientHeight),
    visualHeight > 0 ? visualHeight + visualOffsetTop : 0
  )
}

/**
 * Calculates bounded visible viewport geometry (height and offsetTop).
 * Requires a finite positive layout-viewport height (via layoutHeight parameter or metrics.layoutHeight).
 * Rejects missing/non-finite/non-positive layout bounds and non-positive visual heights (never returns a zero-height app).
 * Ignores material pinch zoom (scale deviating from 1 by >= 0.05) returning null so layout falls back to 100dvh.
 * Rounds and clamps visual height to layout height.
 * Clamps offsetTop to 0..(layoutHeight - height) so offsetTop + height cannot escape the layout viewport.
 * Sanitizes and rounds offset values to prevent subpixel jitter and negative bounds.
 * Sets isKeyboardOpen to true only when an editable element has focus AND the height reduction is at least the threshold.
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

  // Software keyboard detection: only when an editable element has focus AND layout height
  // minus bounded visual height is at least the threshold.
  // Note: offsetTop is deliberately not used for this reduction because Safari may pan
  // the visual viewport downward while the software keyboard consumes layout height.
  // Browser chrome alone, editable focus with hardware keyboard, and pinch zoom do not count.
  const isKeyboardOpen = Boolean(
    metrics.hasEditableFocus &&
    (roundedLayout - height) >= KEYBOARD_MIN_HEIGHT_THRESHOLD_PX
  )

  return {
    height,
    offsetTop,
    isKeyboardOpen
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
