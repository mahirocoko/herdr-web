// MIT License - Copyright (c) 2026 devswha
// Pair-only adaptation of conversation-metadata.ts at 5979118.
import type { IConversationMetadata } from '../../src/types/conversation.ts'
import { isPairClear, type PairSource } from './pair-parser.ts'
const record = (value: unknown): Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {}
const label = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() && !value.startsWith('<')
    ? value.trim()
    : null
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
export const pairMetadata = (
  text: string,
  source: PairSource,
  before?: IConversationMetadata
): IConversationMetadata => {
  const metadata: IConversationMetadata = before
    ? { ...before }
    : { model: null, reasoning_effort: null }
  for (const line of text.split('\n')) {
    let row: Record<string, any>
    try {
      row = record(JSON.parse(line))
    } catch {
      continue
    }
    if (isPairClear(row, source)) {
      metadata.model = null
      metadata.reasoning_effort = null
      delete metadata.context
      continue
    }
    const p = record(row.payload),
      m = record(row.message)
    if (source === 'codex-transcript') {
      if (row.type === 'event_msg' && p.type === 'token_count') {
        const info = record(p.info),
          used = count(record(info.last_token_usage).total_tokens),
          window = count(info.model_context_window)
        if (used) metadata.context = { used, window: window || null }
      } else if (row.type === 'turn_context' || row.type === 'session_meta') {
        const settings = record(record(p.collaboration_mode).settings)
        const model = label(p.model) ?? label(settings.model)
        const effort =
          'effort' in p
            ? p.effort
            : 'reasoning_effort' in p
              ? p.reasoning_effort
              : settings.reasoning_effort
        if (model) metadata.model = model
        if (model || effort !== undefined)
          metadata.reasoning_effort = label(effort)
      }
    } else if (row.type === 'assistant') {
      if (label(m.model)) metadata.model = label(m.model)
      if ('effort' in row) metadata.reasoning_effort = label(row.effort)
      if (row.isSidechain !== true && label(m.model)) {
        const usage = record(m.usage),
          used =
            count(usage.input_tokens) +
            count(usage.cache_creation_input_tokens) +
            count(usage.cache_read_input_tokens)
        if (used) {
          const long =
            metadata.model?.startsWith('claude') &&
            (used > 200000 || metadata.context?.window === 1000000)
          metadata.context = { used, window: long ? 1000000 : null }
        }
      }
    }
  }
  return metadata
}
