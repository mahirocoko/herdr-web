import { describe, expect, it } from 'bun:test'
import { evaluateComposerKey } from '@/utils/prompt-composer.ts'
import {
  calculateVisibleViewportGeometry,
  resolveLayoutViewportHeight
} from '@/utils/visual-viewport.ts'

describe('terminal-composer-safeguards: Thai IME and Enter submission', () => {
  it('blocks Enter submission during active IME composition (isComposing = true)', () => {
    const decision = evaluateComposerKey(
      'Enter',
      false, // shiftKey
      true, // isComposing
      25, // trimmedLength
      false, // isBusy
      false, // isDisabled
      13 // keyCode
    )
    expect(decision.shouldSubmit).toBe(false)
    expect(decision.shouldPreventDefault).toBe(false)
  })

  it('blocks Enter submission when keyCode is 229 (IME processing code)', () => {
    const decision = evaluateComposerKey(
      'Enter',
      false, // shiftKey
      false, // isComposing flag may lag on some mobile browsers
      25, // trimmedLength
      false, // isBusy
      false, // isDisabled
      229 // keyCode = 229
    )
    expect(decision.shouldSubmit).toBe(false)
    expect(decision.shouldPreventDefault).toBe(false)
  })

  it('allows Shift+Enter newline insertion without submitting', () => {
    const decision = evaluateComposerKey(
      'Enter',
      true, // shiftKey
      false, // isComposing
      25, // trimmedLength
      false, // isBusy
      false // isDisabled
    )
    expect(decision.shouldSubmit).toBe(false)
    expect(decision.shouldPreventDefault).toBe(false)
  })

  it('prevents default newline and blocks submit when text is empty', () => {
    const decision = evaluateComposerKey(
      'Enter',
      false,
      false,
      0, // empty
      false,
      false
    )
    expect(decision.shouldSubmit).toBe(false)
    expect(decision.shouldPreventDefault).toBe(true)
  })

  it('submits cleanly when not composing, not busy, and text is present', () => {
    const decision = evaluateComposerKey(
      'Enter',
      false,
      false,
      10,
      false,
      false
    )
    expect(decision.shouldSubmit).toBe(true)
    expect(decision.shouldPreventDefault).toBe(true)
  })
})

describe('terminal-composer-safeguards: Mobile Visual Viewport calculation', () => {
  it('calculates visible viewport height and detects keyboard state when mobile keyboard rises', () => {
    // Layout height = 844px, keyboard open: visual height = 500px, offsetTop = 0
    const layoutHeight = 844
    const geometry = calculateVisibleViewportGeometry(
      {
        height: 500,
        offsetTop: 0,
        scale: 1,
        hasEditableFocus: true
      },
      layoutHeight
    )

    expect(geometry).not.toBeNull()
    expect(geometry?.height).toBe(500)
    expect(geometry?.offsetTop).toBe(0)
    expect(geometry?.isKeyboardOpen).toBe(true)
  })

  it('safely handles non-zero offsetTop when browser chrome scrolls', () => {
    const layoutHeight = 844
    const geometry = calculateVisibleViewportGeometry(
      {
        height: 480,
        offsetTop: 40,
        scale: 1,
        hasEditableFocus: true
      },
      layoutHeight
    )

    expect(geometry).not.toBeNull()
    expect(geometry?.height).toBe(480)
    expect(geometry?.offsetTop).toBe(40)
    expect(geometry?.isKeyboardOpen).toBe(true)
  })

  it('returns null when user is pinch-zooming (scale != 1)', () => {
    const geometry = calculateVisibleViewportGeometry(
      {
        height: 400,
        offsetTop: 0,
        scale: 1.5,
        hasEditableFocus: true
      },
      844
    )
    expect(geometry).toBeNull()
  })

  it('resolves layout viewport height from available window parameters', () => {
    const height = resolveLayoutViewportHeight({
      windowInnerHeight: 844,
      documentClientHeight: 844,
      visualHeight: 500,
      visualOffsetTop: 0
    })
    expect(height).toBe(844)
  })
})
