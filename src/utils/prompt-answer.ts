// Adapted from devswha/herdr-web-ui@5979118 src/lib/promptAnswer.ts.
// MIT License, Copyright (c) 2026 devswha.
import {
  validatePromptAnswerIntent,
  type IInteractivePrompt,
  type PromptAnswerIntent
} from '../types/interactive-prompt.ts'

const choices = (prompt: IInteractivePrompt): number[] =>
  prompt.options.flatMap((_, index) =>
    index === prompt.custom_option_index ? [] : [index]
  )
const boundLetter = (label: string): string | null =>
  label.match(/\(([a-z])\)$/i)?.[1]?.toLowerCase() ?? null
const bareLabel = (label: string): string =>
  label
    .replace(/\s*\((?:[a-z]|esc|recommended)\)$/i, '')
    .trim()
    .toLowerCase()

/** No generic composer fall-through: an unrecognized answer stays inert. */
export const answerFromText = (
  prompt: IInteractivePrompt,
  text: string
): PromptAnswerIntent | null => {
  const value = text.trim()
  if (!value || prompt.fallback) return null
  const valid = choices(prompt)
  const byNumber = (token: string): number | null => {
    if (!/^\d+$/.test(token)) return null
    const index = Number(token) - 1
    return valid.includes(index) ? index : null
  }
  if (prompt.multi_select) {
    const indices = value
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(byNumber)
    return indices.every((index) => index !== null)
      ? validatePromptAnswerIntent({ option_indices: indices })
      : null
  }
  const numbered = byNumber(value)
  if (numbered !== null)
    return validatePromptAnswerIntent({ option_index: numbered })
  const lower = value.toLowerCase()
  const named = valid.find((index) => {
    const label = prompt.options[index]!.label
    return (
      label.toLowerCase() === lower ||
      bareLabel(label) === lower ||
      boundLetter(label) === lower
    )
  })
  if (named !== undefined)
    return validatePromptAnswerIntent({ option_index: named })
  return prompt.custom_option_index !== null
    ? validatePromptAnswerIntent({ custom_text: value })
    : null
}
const range = (prompt: IInteractivePrompt): string => {
  const numbers = choices(prompt).map((index) => index + 1)
  return numbers.length > 1
    ? `${numbers[0]}–${numbers.at(-1)}`
    : String(numbers[0] ?? 1)
}
export const answerHint = (prompt: IInteractivePrompt): string => {
  if (prompt.fallback) return 'Use the answer buttons above'
  if (prompt.multi_select) return 'Type the numbers you choose, e.g. 1 3'
  if (choices(prompt).length === 0) return 'Type your reply…'
  return prompt.custom_option_index !== null
    ? `Type ${range(prompt)} or your own reply…`
    : `Type ${range(prompt)} to choose…`
}
export const answerRefusal = (prompt: IInteractivePrompt): string =>
  prompt.fallback
    ? 'Use the answer buttons above.'
    : prompt.multi_select
      ? 'Choose with the option numbers above, e.g. 1 3.'
      : `Choose one of the options above: type ${range(prompt)}.`
export const needsConfirmation = (
  prompt: IInteractivePrompt,
  answer: PromptAnswerIntent
): boolean =>
  (prompt.kind === 'approval' ||
    prompt.kind === 'plan' ||
    prompt.kind === 'menu') &&
  answer.option_index !== undefined

export type PressOrigin = 'keyboard' | 'mouse' | 'touch' | 'pen' | 'unknown'
export const pressOrigin = (
  press:
    | {
        pointerType?: string
        downType?: string
        detail?: number
        keyed: boolean
      }
    | undefined
): PressOrigin => {
  if (press === undefined) return 'keyboard'
  for (const pointer of ['touch', 'pen', 'mouse'] as const) {
    if (press.downType === pointer || press.pointerType === pointer)
      return pointer
  }
  return press.detail === 0 && press.keyed ? 'keyboard' : 'unknown'
}
export const focusFollowsAnswer = ({
  fromCard,
  origin,
  coarse,
  cardMounted,
  inCard,
  onPage
}: {
  fromCard: boolean
  origin: PressOrigin
  coarse: boolean
  cardMounted: boolean
  inCard: boolean
  onPage: boolean
}): boolean => {
  const pressed =
    origin === 'keyboard' ||
    origin === 'mouse' ||
    (origin === 'unknown' && !coarse)
  return fromCard && pressed && cardMounted && (inCard || onPage)
}
