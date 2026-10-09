import { describe, expect, it } from 'bun:test'
import {
  answerFromText,
  answerHint,
  focusFollowsAnswer,
  needsConfirmation,
  pressOrigin
} from '../prompt-answer.ts'
import {
  promptAcceptsIntent,
  validatePromptAnswerIntent,
  type IInteractivePrompt
} from '../../types/interactive-prompt.ts'

export const prompt: IInteractivePrompt = {
  id: 'occurrence',
  agent: 'codex',
  kind: 'question',
  title: 'Question',
  question: 'Which?',
  body: null,
  options: [
    { label: 'Yes (y)', description: null },
    { label: 'No (Recommended)', description: 'Safe' },
    { label: 'Other', description: null }
  ],
  multi_select: false,
  custom_option_index: 2
}
describe('browser answer intent', () => {
  it('allows exactly one bounded intent, never native keys/plans/paths', () => {
    for (const value of [
      null,
      [],
      {},
      { keys: ['Enter'] },
      { text: 'yes' },
      { plan: [] },
      { custom_text: 'hello', path: '/private' },
      { option_index: 0, option_indices: [1] },
      { option_index: -1 },
      { option_index: 0.5 },
      { option_index: 256 },
      { option_indices: [] },
      { option_indices: [0, '1'] },
      { custom_text: '\u001b[1m' },
      { custom_text: 'line\nEnter' },
      { custom_text: '  ' }
    ])
      expect(validatePromptAnswerIntent(value)).toBeNull()
    expect(validatePromptAnswerIntent({ option_indices: [2, 1, 1] })).toEqual({
      option_indices: [1, 2]
    })
    expect(validatePromptAnswerIntent({ custom_text: '  ไทย  ' })).toEqual({
      custom_text: 'ไทย'
    })
  })
  it('bounds multi-byte custom input by bytes, not string length', () => {
    expect(
      validatePromptAnswerIntent({ custom_text: 'ก'.repeat(1365) })
    ).not.toBeNull()
    expect(
      validatePromptAnswerIntent({ custom_text: 'ก'.repeat(1366) })
    ).toBeNull()
  })
  it('maps number, full/bare label, bound letter and custom text without dispatch', () => {
    for (const text of ['1', 'Yes (y)', 'yes', 'y'])
      expect(answerFromText(prompt, text)).toEqual({ option_index: 0 })
    expect(answerFromText(prompt, 'No')).toEqual({ option_index: 1 })
    expect(answerFromText(prompt, 'custom ไทย')).toEqual({
      custom_text: 'custom ไทย'
    })
    expect(
      answerFromText(
        { ...prompt, custom_option_index: null },
        'unrecognized shell command'
      )
    ).toBeNull()
    expect(answerFromText({ ...prompt, fallback: true }, '1')).toBeNull()
  })
  it('multi choices are deduped, custom row and unknown commands cannot answer', () => {
    const multi = { ...prompt, multi_select: true }
    expect(answerFromText(multi, '2, 1 2')).toEqual({ option_indices: [0, 1] })
    for (const text of ['1 abc', '3', 'echo hello'])
      expect(answerFromText(multi, text)).toBeNull()
    expect(promptAcceptsIntent(multi, { option_index: 0 })).toBe(false)
    expect(promptAcceptsIntent(multi, { custom_text: 'hello' })).toBe(false)
    expect(promptAcceptsIntent(multi, { option_indices: [2] })).toBe(false)
    expect(promptAcceptsIntent(prompt, { option_index: 5 })).toBe(false)
  })
  it('typed approval, plan and menu options require confirmation, questions do not', () => {
    for (const kind of ['approval', 'plan', 'menu'] as const)
      expect(needsConfirmation({ ...prompt, kind }, { option_index: 0 })).toBe(
        true
      )
    expect(needsConfirmation(prompt, { option_index: 0 })).toBe(false)
    expect(
      needsConfirmation(
        { ...prompt, kind: 'plan' },
        { custom_text: 'feedback' }
      )
    ).toBe(false)
    expect(answerHint({ ...prompt, fallback: true })).toContain('buttons')
  })
})
describe('answer focus provenance', () => {
  it('touch down wins over Safari mouse-named click and zero-detail alone is not keyboard', () => {
    expect(
      pressOrigin({
        pointerType: 'mouse',
        downType: 'touch',
        detail: 1,
        keyed: false
      })
    ).toBe('touch')
    expect(pressOrigin({ detail: 0, keyed: false })).toBe('unknown')
    expect(pressOrigin({ detail: 0, keyed: true })).toBe('keyboard')
    expect(pressOrigin(undefined)).toBe('keyboard')
  })
  it('never raises keyboard after touch or steals focus from another surface', () => {
    const state = {
      fromCard: true,
      origin: 'keyboard' as const,
      coarse: true,
      cardMounted: true,
      inCard: false,
      onPage: true
    }
    expect(focusFollowsAnswer(state)).toBe(true)
    expect(focusFollowsAnswer({ ...state, origin: 'touch' })).toBe(false)
    expect(focusFollowsAnswer({ ...state, onPage: false })).toBe(false)
    expect(focusFollowsAnswer({ ...state, cardMounted: false })).toBe(false)
  })
})
