import { describe, expect, it } from 'bun:test'
import {
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  calculateComposerHeight,
  evaluateComposerKey,
  resolveDraftAfterSubmit
} from '../prompt-composer.ts'

describe('resolveDraftAfterSubmit', () => {
  it('retains draft when submission fails with boolean false', () => {
    expect(resolveDraftAfterSubmit('echo hello', 'echo hello', false, 'pane-1', 'pane-1', 1, 1)).toBe('echo hello')
    expect(resolveDraftAfterSubmit('echo hello', 'echo hello', false, 'pane-2', 'pane-1', 2, 1)).toBe('echo hello')
  })

  it('retains exact draft when action was skipped_busy', () => {
    expect(
      resolveDraftAfterSubmit('echo hello', 'echo hello', 'skipped_busy', 'pane-1', 'pane-1', 1, 1)
    ).toBe('echo hello')
    expect(
      resolveDraftAfterSubmit('multiline\ndraft', 'multiline\ndraft', 'skipped_busy', 'pane-1', 'pane-1', 1, 1)
    ).toBe('multiline\ndraft')
  })

  it('clears draft when action status is acknowledged and draft, pane, and generation remain unchanged', () => {
    expect(resolveDraftAfterSubmit('echo hello', 'echo hello', 'acknowledged', 'pane-1', 'pane-1', 1, 1)).toBe('')
    expect(resolveDraftAfterSubmit('echo hello', 'echo hello', true, 'pane-1', 'pane-1', 1, 1)).toBe('')
  })

  it('clears multiline draft on acknowledged when exact multiline text is unchanged', () => {
    const multiline = 'line 1\nline 2\nline 3'
    expect(resolveDraftAfterSubmit(multiline, multiline, 'acknowledged', 'pane-1', 'pane-1', 1, 1)).toBe('')
  })

  it('retains multiline draft when submission fails or is skipped_busy', () => {
    const multiline = 'line 1\nline 2\nline 3'
    expect(resolveDraftAfterSubmit(multiline, multiline, false, 'pane-1', 'pane-1', 1, 1)).toBe(multiline)
    expect(resolveDraftAfterSubmit(multiline, multiline, 'skipped_busy', 'pane-1', 'pane-1', 1, 1)).toBe(multiline)
  })

  it('retains draft on success when pane changed during submission (A -> B)', () => {
    expect(resolveDraftAfterSubmit('echo hello', 'echo hello', true, 'pane-2', 'pane-1', 2, 1)).toBe('echo hello')
    expect(resolveDraftAfterSubmit('echo hello', 'echo hello', true, 'pane-other', 'pane-1', 5, 1)).toBe('echo hello')
  })

  it('retains draft on switch-away-and-back (A -> B -> A)', () => {
    // Current pane is pane-1 again, but generation has increased because user navigated to B and back to A
    expect(resolveDraftAfterSubmit('echo hello', 'echo hello', true, 'pane-1', 'pane-1', 3, 1)).toBe('echo hello')
  })

  it('retains draft on success when current pane is unselected or null', () => {
    expect(resolveDraftAfterSubmit('echo hello', 'echo hello', true, null, 'pane-1', 2, 1)).toBe('echo hello')
    expect(resolveDraftAfterSubmit('echo hello', 'echo hello', true, 'pane-1', null, 1, 1)).toBe('echo hello')
  })

  it('retains new typed text on success if user typed while submission was in flight', () => {
    expect(resolveDraftAfterSubmit('echo hello and more', 'echo hello', true, 'pane-1', 'pane-1', 1, 1)).toBe('echo hello and more')
    expect(resolveDraftAfterSubmit('new message', 'old message', true, 'pane-1', 'pane-1', 1, 1)).toBe('new message')
  })

  it('retains draft when both pane/generation changed and text changed', () => {
    expect(resolveDraftAfterSubmit('modified text', 'original text', true, 'pane-2', 'pane-1', 2, 1)).toBe('modified text')
    expect(resolveDraftAfterSubmit('modified text', 'original text', true, 'pane-1', 'pane-1', 3, 1)).toBe('modified text')
  })
})

describe('evaluateComposerKey', () => {
  it('triggers submit and prevents default newline on plain Enter with non-empty text', () => {
    const decision = evaluateComposerKey('Enter', false, false, 10, false, false)
    expect(decision).toEqual({ shouldSubmit: true, shouldPreventDefault: true })
  })

  it('allows Shift+Enter to insert a newline natively without submitting', () => {
    const decision = evaluateComposerKey('Enter', true, false, 10, false, false)
    expect(decision).toEqual({ shouldSubmit: false, shouldPreventDefault: false })
  })

  it('never submits mid-composition when isComposing is true', () => {
    // During IME composition, Enter confirms IME suggestion
    const decision = evaluateComposerKey('Enter', false, true, 10, false, false)
    expect(decision).toEqual({ shouldSubmit: false, shouldPreventDefault: false })
  })

  it('never submits mid-composition when keyCode is 229', () => {
    // Mobile/desktop browsers often signal IME active with keyCode 229
    const decision = evaluateComposerKey('Enter', false, false, 10, false, false, 229)
    expect(decision).toEqual({ shouldSubmit: false, shouldPreventDefault: false })
  })

  it('prevents default and does not submit when text is empty or whitespace only', () => {
    const decision = evaluateComposerKey('Enter', false, false, 0, false, false)
    expect(decision).toEqual({ shouldSubmit: false, shouldPreventDefault: true })
  })

  it('prevents default and does not submit when composer is busy sending', () => {
    const decision = evaluateComposerKey('Enter', false, false, 12, true, false)
    expect(decision).toEqual({ shouldSubmit: false, shouldPreventDefault: true })
  })

  it('prevents default and does not submit when composer is disabled', () => {
    const decision = evaluateComposerKey('Enter', false, false, 12, false, true)
    expect(decision).toEqual({ shouldSubmit: false, shouldPreventDefault: true })
  })

  it('allows standard typing keys to pass through with native behavior', () => {
    expect(evaluateComposerKey('a', false, false, 0, false, false)).toEqual({
      shouldSubmit: false,
      shouldPreventDefault: false
    })
    expect(evaluateComposerKey('Backspace', false, false, 5, false, false)).toEqual({
      shouldSubmit: false,
      shouldPreventDefault: false
    })
    expect(evaluateComposerKey('Tab', false, false, 5, false, false)).toEqual({
      shouldSubmit: false,
      shouldPreventDefault: false
    })
  })
})

describe('calculateComposerHeight', () => {
  it('clamps to minimum height (44px) when scrollHeight is less than or equal to minimum', () => {
    expect(calculateComposerHeight(20)).toBe(COMPOSER_MIN_HEIGHT)
    expect(calculateComposerHeight(44)).toBe(COMPOSER_MIN_HEIGHT)
    expect(calculateComposerHeight(0)).toBe(COMPOSER_MIN_HEIGHT)
  })

  it('grows dynamically as content expands between min and max bounds', () => {
    expect(calculateComposerHeight(66)).toBe(66)
    expect(calculateComposerHeight(88)).toBe(88)
    expect(calculateComposerHeight(110)).toBe(110)
  })

  it('caps at maximum height (~5 text rows / 132px) when scrollHeight exceeds maximum', () => {
    expect(calculateComposerHeight(132)).toBe(COMPOSER_MAX_HEIGHT)
    expect(calculateComposerHeight(200)).toBe(COMPOSER_MAX_HEIGHT)
    expect(calculateComposerHeight(500)).toBe(COMPOSER_MAX_HEIGHT)
  })

  it('accepts custom bounds if provided', () => {
    expect(calculateComposerHeight(30, 40, 100)).toBe(40)
    expect(calculateComposerHeight(60, 40, 100)).toBe(60)
    expect(calculateComposerHeight(120, 40, 100)).toBe(100)
  })
})
