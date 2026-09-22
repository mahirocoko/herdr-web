import { describe, expect, it } from 'bun:test'
import {
  calculateVisibleViewportGeometry,
  calculateVisibleViewportHeight,
  KEYBOARD_MIN_HEIGHT_THRESHOLD_PX,
  resolveLayoutViewportHeight
} from '../visual-viewport.ts'

describe('resolveLayoutViewportHeight', () => {
  it('preserves the document layout height when iOS shrinks window.innerHeight', () => {
    expect(resolveLayoutViewportHeight({
      windowInnerHeight: 405,
      documentClientHeight: 844,
      visualHeight: 405,
      visualOffsetTop: 306
    })).toBe(844)
  })

  it('never clamps below the panned visual viewport bottom', () => {
    expect(resolveLayoutViewportHeight({
      windowInnerHeight: 405,
      documentClientHeight: 405,
      visualHeight: 405,
      visualOffsetTop: 306
    })).toBe(711)
  })

  it('ignores invalid candidates and returns zero when no bound is usable', () => {
    expect(resolveLayoutViewportHeight({
      windowInnerHeight: NaN,
      documentClientHeight: -1,
      visualHeight: 0,
      visualOffsetTop: Infinity
    })).toBe(0)
  })
})

describe('calculateVisibleViewportGeometry', () => {
  it('sanitizes and rounds offsetTop values within layout bounds', () => {
    // Normal rounding within 800px layout
    expect(calculateVisibleViewportGeometry({ height: 500, offsetTop: 45.6, scale: 1 }, 800)).toEqual({
      height: 500,
      offsetTop: 46,
      isKeyboardOpen: false
    })
    expect(calculateVisibleViewportGeometry({ height: 500, offsetTop: 45.4, scale: 1 }, 800)).toEqual({
      height: 500,
      offsetTop: 45,
      isKeyboardOpen: false
    })
    // Negative offset clamped to zero (e.g. rubber banding)
    expect(calculateVisibleViewportGeometry({ height: 500, offsetTop: -15, scale: 1 }, 800)).toEqual({
      height: 500,
      offsetTop: 0,
      isKeyboardOpen: false
    })
    // Non-finite offsets sanitized to zero
    expect(calculateVisibleViewportGeometry({ height: 500, offsetTop: NaN, scale: 1 }, 800)).toEqual({
      height: 500,
      offsetTop: 0,
      isKeyboardOpen: false
    })
    expect(calculateVisibleViewportGeometry({ height: 500, offsetTop: Infinity, scale: 1 }, 800)).toEqual({
      height: 500,
      offsetTop: 0,
      isKeyboardOpen: false
    })
  })

  it('rejects missing, non-finite, and non-positive layout bounds', () => {
    expect(calculateVisibleViewportGeometry({ height: 500, scale: 1 }, undefined)).toBeNull()
    expect(calculateVisibleViewportGeometry({ height: 500, scale: 1 }, 0)).toBeNull()
    expect(calculateVisibleViewportGeometry({ height: 500, scale: 1 }, -500)).toBeNull()
    expect(calculateVisibleViewportGeometry({ height: 500, scale: 1 }, NaN)).toBeNull()
    expect(calculateVisibleViewportGeometry({ height: 500, scale: 1 }, Infinity)).toBeNull()
    expect(calculateVisibleViewportGeometry(null, 800)).toBeNull()
    expect(calculateVisibleViewportGeometry(undefined, 800)).toBeNull()
  })

  it('rejects non-positive visual heights and never returns a zero-height app', () => {
    expect(calculateVisibleViewportGeometry({ height: 0, scale: 1 }, 800)).toBeNull()
    expect(calculateVisibleViewportGeometry({ height: -10, scale: 1 }, 800)).toBeNull()
    expect(calculateVisibleViewportGeometry({ height: NaN, scale: 1 }, 800)).toBeNull()
    expect(calculateVisibleViewportGeometry({ height: Infinity, scale: 1 }, 800)).toBeNull()
  })

  it('calculates bounded geometry for normal keyboard pan without editable focus as false', () => {
    expect(calculateVisibleViewportGeometry({ height: 420.4, offsetTop: 85.6, scale: 1.0 }, 800)).toEqual({
      height: 420,
      offsetTop: 86,
      isKeyboardOpen: false
    })
    expect(calculateVisibleViewportGeometry({ height: 450, offsetTop: 120, scale: 1.01 }, 800)).toEqual({
      height: 450,
      offsetTop: 120,
      isKeyboardOpen: false
    })
  })

  it('resets/falls back to null when pinch-zoom is active', () => {
    expect(calculateVisibleViewportGeometry({ height: 300, offsetTop: 50, scale: 1.5 }, 800)).toBeNull()
    expect(calculateVisibleViewportGeometry({ height: 250, offsetTop: 80, scale: 2.0 }, 800)).toBeNull()
    expect(calculateVisibleViewportGeometry({ height: 500, offsetTop: 40, scale: 0.8 }, 800)).toBeNull()
    expect(calculateVisibleViewportGeometry({ height: 500, offsetTop: 40, scale: 1.06 }, 800)).toBeNull()
    // Pinch zoom with editable focus must still return null
    expect(calculateVisibleViewportGeometry({ height: 400, offsetTop: 50, scale: 1.5, hasEditableFocus: true }, 800)).toBeNull()
  })

  it('handles zero offset and omitted offsetTop correctly', () => {
    expect(calculateVisibleViewportGeometry({ height: 800, offsetTop: 0, scale: 1 }, 800)).toEqual({
      height: 800,
      offsetTop: 0,
      isKeyboardOpen: false
    })
    expect(calculateVisibleViewportGeometry({ height: 600, scale: 1 }, 800)).toEqual({
      height: 600,
      offsetTop: 0,
      isKeyboardOpen: false
    })
  })

  it('bounds absurd height and offset to preserve offset+height invariant', () => {
    // Visual height exceeding layout height is clamped to layout height
    const overflowHeight = calculateVisibleViewportGeometry({ height: 5000, offsetTop: 100, scale: 1 }, 800)
    expect(overflowHeight).toEqual({
      height: 800,
      offsetTop: 0,
      isKeyboardOpen: false
    })
    expect(overflowHeight!.offsetTop + overflowHeight!.height).toBeLessThanOrEqual(800)

    // Absurd offsetTop is clamped to layoutHeight - height
    const overflowOffset = calculateVisibleViewportGeometry({ height: 500, offsetTop: 9999, scale: 1 }, 800)
    expect(overflowOffset).toEqual({
      height: 500,
      offsetTop: 300,
      isKeyboardOpen: false
    })
    expect(overflowOffset!.offsetTop + overflowOffset!.height).toBeLessThanOrEqual(800)
  })

  it('adapts when layout bound changes', () => {
    const metrics = { height: 500, offsetTop: 350, scale: 1 }

    // In 800px layout, max offset is 800 - 500 = 300
    expect(calculateVisibleViewportGeometry(metrics, 800)).toEqual({
      height: 500,
      offsetTop: 300,
      isKeyboardOpen: false
    })

    // In 600px layout, max offset is 600 - 500 = 100
    expect(calculateVisibleViewportGeometry(metrics, 600)).toEqual({
      height: 500,
      offsetTop: 100,
      isKeyboardOpen: false
    })

    // In 400px layout, height is clamped to 400, max offset is 0
    expect(calculateVisibleViewportGeometry(metrics, 400)).toEqual({
      height: 400,
      offsetTop: 0,
      isKeyboardOpen: false
    })
  })

  describe('software keyboard detection (isKeyboardOpen)', () => {
    it('reports true for focused large reduction even with offset pan', () => {
      // Large reduction: layout 844px - visual 500px = 344px >= threshold 120px
      // Safari pans visual viewport downward so offsetTop > 0
      expect(calculateVisibleViewportGeometry({
        height: 500,
        offsetTop: 150,
        scale: 1,
        hasEditableFocus: true
      }, 844)).toEqual({
        height: 500,
        offsetTop: 150,
        isKeyboardOpen: true
      })
    })

    it('reports false when large reduction occurs without editable focus', () => {
      // Window resize, split-view, or browser chrome without editable focus
      expect(calculateVisibleViewportGeometry({
        height: 500,
        offsetTop: 150,
        scale: 1,
        hasEditableFocus: false
      }, 844)).toEqual({
        height: 500,
        offsetTop: 150,
        isKeyboardOpen: false
      })
      expect(calculateVisibleViewportGeometry({
        height: 500,
        offsetTop: 150,
        scale: 1
      }, 844)).toEqual({
        height: 500,
        offsetTop: 150,
        isKeyboardOpen: false
      })
    })

    it('reports false for focused browser-chrome-sized reduction', () => {
      // Small reduction (e.g. 844 - 780 = 64px < 120px threshold)
      expect(calculateVisibleViewportGeometry({
        height: 780,
        offsetTop: 0,
        scale: 1,
        hasEditableFocus: true
      }, 844)).toEqual({
        height: 780,
        offsetTop: 0,
        isKeyboardOpen: false
      })
    })

    it('reports false for editable focus with hardware keyboard (no layout reduction)', () => {
      // Focused on input but no software keyboard up (height === layoutHeight)
      expect(calculateVisibleViewportGeometry({
        height: 844,
        offsetTop: 0,
        scale: 1,
        hasEditableFocus: true
      }, 844)).toEqual({
        height: 844,
        offsetTop: 0,
        isKeyboardOpen: false
      })
    })

    it('exports named threshold around 120px', () => {
      expect(KEYBOARD_MIN_HEIGHT_THRESHOLD_PX).toBe(120)
    })
  })
})

describe('calculateVisibleViewportHeight', () => {
  it('returns null when metrics or layout bounds are missing or invalid', () => {
    expect(calculateVisibleViewportHeight(null, 800)).toBeNull()
    expect(calculateVisibleViewportHeight(undefined, 800)).toBeNull()
    expect(calculateVisibleViewportHeight({ height: NaN }, 800)).toBeNull()
    expect(calculateVisibleViewportHeight({ height: Infinity }, 800)).toBeNull()
    expect(calculateVisibleViewportHeight({ height: 500 }, undefined)).toBeNull()
    expect(calculateVisibleViewportHeight({ height: 500 }, 0)).toBeNull()
    expect(calculateVisibleViewportHeight({ height: 500 }, -200)).toBeNull()
  })

  it('returns rounded height clamped to layout bounds when scale is normal (~1.0)', () => {
    expect(calculateVisibleViewportHeight({ height: 500.4, scale: 1 }, 800)).toBe(500)
    expect(calculateVisibleViewportHeight({ height: 620.8, scale: 1.02 }, 800)).toBe(621)
    expect(calculateVisibleViewportHeight({ height: 450, scale: 0.98 }, 800)).toBe(450)
    expect(calculateVisibleViewportHeight({ height: 950, scale: 1 }, 800)).toBe(800)
  })

  it('returns null when user is pinch-zoomed', () => {
    expect(calculateVisibleViewportHeight({ height: 300, scale: 1.5 }, 800)).toBeNull()
    expect(calculateVisibleViewportHeight({ height: 250, scale: 2.0 }, 800)).toBeNull()
    expect(calculateVisibleViewportHeight({ height: 500, scale: 0.8 }, 800)).toBeNull()
  })

  it('rejects non-positive heights and returns null', () => {
    expect(calculateVisibleViewportHeight({ height: -10, scale: 1 }, 800)).toBeNull()
    expect(calculateVisibleViewportHeight({ height: 0, scale: 1 }, 800)).toBeNull()
  })
})
