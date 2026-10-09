// Adapted from devswha/herdr-web-ui@5979118 shared/protocol.ts.
// MIT License, Copyright (c) 2026 devswha.

/** Browser projection only. Native responder metadata and key plans stay server-owned. */
export interface IInteractivePrompt {
  id: string
  agent: string
  kind: 'question' | 'approval' | 'plan' | 'menu'
  title: string
  question: string
  body: string | null
  options: IInteractivePromptOption[]
  multi_select: boolean
  custom_option_index: number | null
  queued?: 'collapsed' | 'open'
  steps?: IInteractivePromptStep[]
  fallback?: true
}

export interface IInteractivePromptStep {
  label: string
  answered: boolean
  current: boolean
}

export interface IInteractivePromptOption {
  label: string
  description: string | null
}

/** Exactly one intent. Browser keys, native plans, paths and provider IDs are not answers. */
export type PromptAnswerIntent =
  | { option_index: number; option_indices?: never; custom_text?: never }
  | { option_indices: number[]; option_index?: never; custom_text?: never }
  | { custom_text: string; option_index?: never; option_indices?: never }

export interface IInteractivePromptRead {
  prompt: IInteractivePrompt | null
  suggestion: string | null
}

/** The byte bound includes multi-byte text; no control sequences reach native text input. */
export const MAX_PROMPT_ANSWER_BYTES = 4096
export const MAX_PROMPT_SELECTIONS = 256

export const validatePromptAnswerIntent = (
  value: unknown
): PromptAnswerIntent | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1) return null
  if (keys[0] === 'option_index') {
    const index = record.option_index
    return typeof index === 'number' &&
      Number.isSafeInteger(index) &&
      index >= 0 &&
      index < MAX_PROMPT_SELECTIONS
      ? { option_index: index }
      : null
  }
  if (keys[0] === 'option_indices') {
    const indices = record.option_indices
    if (
      !Array.isArray(indices) ||
      indices.length === 0 ||
      indices.length > MAX_PROMPT_SELECTIONS ||
      indices.some(
        (index) =>
          typeof index !== 'number' ||
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= MAX_PROMPT_SELECTIONS
      )
    )
      return null
    return {
      option_indices: [...new Set(indices as number[])].sort((a, b) => a - b)
    }
  }
  if (keys[0] === 'custom_text') {
    const text = record.custom_text
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      /[\x00-\x1f\x7f-\x9f]/.test(text) ||
      new TextEncoder().encode(text).byteLength > MAX_PROMPT_ANSWER_BYTES
    )
      return null
    return { custom_text: text.trim() }
  }
  return null
}

/** Displayed capability check, not native authorization; server answerKeys must check again. */
export const promptAcceptsIntent = (
  prompt: IInteractivePrompt,
  answer: PromptAnswerIntent
): boolean => {
  if (answer.custom_text !== undefined)
    return !prompt.multi_select && prompt.custom_option_index !== null
  const indices = answer.option_indices ?? [answer.option_index]
  return (
    prompt.multi_select === (answer.option_indices !== undefined) &&
    indices.every(
      (index) =>
        Number.isSafeInteger(index) &&
        index >= 0 &&
        index < prompt.options.length &&
        index !== prompt.custom_option_index
    )
  )
}
