import { describe, expect, it } from 'bun:test'
import {
  calculateFollowScrollTop,
  calculateLatestScrollPosition,
  isScrolledAwayFromCursor,
  isScrolledAwayFromBottom,
  shouldFollowLatest
} from '../terminal-panning.ts'

describe('terminal-panning: shouldFollowLatest', () => {
  it('follows when not panned and no selection', () => {
    expect(shouldFollowLatest(false, false)).toBe(true)
  })

  it('stops following when panned by user', () => {
    expect(shouldFollowLatest(true, false)).toBe(false)
  })

  it('stops following when user has an active text selection', () => {
    expect(shouldFollowLatest(false, true)).toBe(false)
    expect(shouldFollowLatest(true, true)).toBe(false)
  })
})

describe('native cursor intent, not screen bottom', () => {
  it('keeps follow enabled for a shell prompt above blank rows', () => {
    const cursorTop = calculateFollowScrollTop(3, 52, 936, 8, 500, 952)
    expect(cursorTop).toBe(0)
    expect(isScrolledAwayFromCursor(0, cursorTop)).toBe(false)
  })
  it('recognizes manual reading below a top-positioned prompt', () => {
    expect(isScrolledAwayFromCursor(300, 0)).toBe(true)
  })
  it('Latest cursor restore does not immediately pause follow again', () => {
    const cursorTop = calculateFollowScrollTop(3, 52, 936, 8, 500, 952)
    const restored = calculateLatestScrollPosition(200, cursorTop)
    expect(restored).toEqual({ scrollLeft: 200, scrollTop: 0 })
    expect(isScrolledAwayFromCursor(restored.scrollTop, cursorTop)).toBe(false)
  })
})

describe('terminal-panning: calculateFollowScrollTop', () => {
  it('returns 0 when total rows or screen height are invalid', () => {
    expect(calculateFollowScrollTop(10, 0, 500, 0, 400, 800)).toBe(0)
    expect(calculateFollowScrollTop(10, 24, 0, 0, 400, 800)).toBe(0)
    expect(calculateFollowScrollTop(10, 24, 500, 0, 800, 400)).toBe(0)
  })

  it('returns 0 when cursor row fits comfortably within viewport', () => {
    // 52 rows, screenHeight = 1040 (20px per row), cursor at row 5 (y = 120px)
    // clientHeight = 600, scrollHeight = 1040
    const scrollTop = calculateFollowScrollTop(5, 52, 1040, 0, 600, 1040)
    expect(scrollTop).toBe(0)
  })

  it('scrolls down when cursor row exceeds viewport height', () => {
    // 52 rows, 20px per row, cursor at row 49 (cursorBottom = 50 * 20 = 1000px)
    // clientHeight = 600, scrollHeight = 1040
    // target = 1000 - 600 = 400px
    const scrollTop = calculateFollowScrollTop(49, 52, 1040, 0, 600, 1040)
    expect(scrollTop).toBe(400)
  })

  it('clamps scroll to maxScroll (scrollHeight - clientHeight)', () => {
    // cursor at row 51 (cursorBottom = 52 * 20 = 1040px)
    // maxScroll = 1040 - 600 = 440px
    const scrollTop = calculateFollowScrollTop(51, 52, 1040, 0, 600, 1040)
    expect(scrollTop).toBe(440)
  })
})

describe('terminal-panning: calculateLatestScrollPosition', () => {
  it('preserves horizontal scrollLeft while restoring vertical bottom', () => {
    const result = calculateLatestScrollPosition(250, 440)
    expect(result.scrollLeft).toBe(250)
    expect(result.scrollTop).toBe(440)
  })

  it('handles zero or negative coordinates safely', () => {
    const result = calculateLatestScrollPosition(-10, -50)
    expect(result.scrollLeft).toBe(0)
    expect(result.scrollTop).toBe(0)
  })
})

describe('terminal-panning: isScrolledAwayFromBottom', () => {
  it('returns false when content fits within clientHeight', () => {
    expect(isScrolledAwayFromBottom(0, 600, 400)).toBe(false)
  })

  it('returns false when at bottom within threshold', () => {
    // scrollHeight = 1000, clientHeight = 600 -> maxScroll = 400
    expect(isScrolledAwayFromBottom(400, 600, 1000, 24)).toBe(false)
    expect(isScrolledAwayFromBottom(380, 600, 1000, 24)).toBe(false)
  })

  it('returns true when scrolled away beyond threshold', () => {
    // scrollTop = 300, clientHeight = 600 -> bottom edge is at 900 < 1000 - 24
    expect(isScrolledAwayFromBottom(300, 600, 1000, 24)).toBe(true)
  })
})
