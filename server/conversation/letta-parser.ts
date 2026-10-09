import type {
  ConversationPart,
  IConversationMetadata,
  IConversationTurn
} from '../../src/types/conversation.ts'

import { toolSummary } from './tool-summary.ts'

const MAX_PART_CHARS = 16_000

/** Harness context is not human chat. Only strip the known runtime envelopes,
 * not arbitrary HTML/XML or the user's ordinary Markdown/code examples.
 */
export const stripLettaRuntimeContext = (text: string): string => {
  let visible = text
  for (const tag of [
    'system-reminder',
    'user_timestamp',
    'terminal_file_link_contract',
    'skill_content',
    'task-notification'
  ]) {
    visible = visible.replace(
      new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, 'g'),
      ''
    )
  }
  return visible.trim()
}

const textContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
}

const timeString = (message: any): string | null => {
  const value = message.metadata?.created_at ?? message.timestamp
  const date = new Date(value)
  return value != null && Number.isFinite(date.getTime())
    ? date.toISOString()
    : null
}

/** Native v2 pi-session-entry JSONL. Last complete snapshot of a message wins;
 * half-written records are ignored, tool outputs pair only by native call ID.
 * Compaction/system/provider metadata never masquerades as a user turn.
 */
export const parseLettaTranscript = (
  text: string
): {
  turns: IConversationTurn[]
  metadata: IConversationMetadata
} => {
  const messages = new Map<string, any>()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (
        entry.type !== 'message' ||
        !entry.message ||
        typeof entry.message.id !== 'string'
      )
        continue
      messages.delete(entry.message.id)
      messages.set(entry.message.id, entry.message)
    } catch {
      /* Native append can leave an incomplete last line. */
    }
  }

  const turns: IConversationTurn[] = []
  const tools = new Map<string, Extract<ConversationPart, { kind: 'tool' }>>()
  const metadata: IConversationMetadata = {
    model: null,
    reasoning_effort: null
  }
  let assistant: IConversationTurn | null = null
  for (const message of messages.values()) {
    const ts = timeString(message)
    if (message.role === 'user') {
      const visible = stripLettaRuntimeContext(textContent(message.content))
      const imageCount = Array.isArray(message.content)
        ? message.content.filter((part: any) => part?.type === 'image').length
        : 0
      // Pure runtime messages do not split a genuine assistant work block.
      if (!visible && !imageCount) continue
      turns.push({
        id: message.id,
        role: 'user',
        ts,
        parts: [
          ...(visible
            ? [
                {
                  kind: 'text' as const,
                  text: visible.slice(0, MAX_PART_CHARS),
                  ...(visible.length > MAX_PART_CHARS
                    ? { truncated: true }
                    : {})
                }
              ]
            : []),
          ...(imageCount
            ? [
                {
                  kind: 'notice' as const,
                  text: `${imageCount} image attachment${imageCount === 1 ? '' : 's'} (preview not available in Chat yet)`
                }
              ]
            : [])
        ]
      })
      assistant = null
    } else if (message.role === 'assistant') {
      if (typeof message.model === 'string') metadata.model = message.model
      if (!assistant) {
        assistant = { id: message.id, role: 'assistant', ts, parts: [] }
        turns.push(assistant)
      }
      if (ts) assistant.end_ts = ts
      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        const detail =
          typeof message.errorMessage === 'string' &&
          message.errorMessage.trim()
            ? message.errorMessage
            : message.stopReason === 'aborted'
              ? 'Letta generation was interrupted.'
              : 'Letta runtime failed; details were not recorded.'
        assistant.parts.push({
          kind: 'notice',
          source: 'letta-runtime',
          severity: message.stopReason === 'error' ? 'error' : 'warning',
          text: detail.slice(0, MAX_PART_CHARS),
          ...(detail.length > MAX_PART_CHARS ? { truncated: true } : {})
        })
      }
      for (const part of Array.isArray(message.content)
        ? message.content
        : []) {
        if (
          part?.type === 'text' &&
          typeof part.text === 'string' &&
          part.text.trim()
        ) {
          assistant.parts.push({
            kind: 'text',
            text: part.text.slice(0, MAX_PART_CHARS),
            ...(part.text.length > MAX_PART_CHARS ? { truncated: true } : {}),
            phase: message.stopReason === 'stop' ? 'final_answer' : 'commentary'
          })
        } else if (
          part?.type === 'thinking' &&
          typeof part.thinking === 'string' &&
          part.thinking.trim()
        ) {
          assistant.parts.push({
            kind: 'thinking',
            text: part.thinking.slice(0, MAX_PART_CHARS),
            ...(part.thinking.length > MAX_PART_CHARS
              ? { truncated: true }
              : {})
          })
        } else if (
          part?.type === 'toolCall' &&
          typeof part.id === 'string' &&
          typeof part.name === 'string'
        ) {
          const tool: Extract<ConversationPart, { kind: 'tool' }> = {
            kind: 'tool',
            id: part.id,
            name: part.name,
            summary: toolSummary(part.arguments),
            input: JSON.stringify(part.arguments ?? {}, null, 2).slice(
              0,
              MAX_PART_CHARS
            ),
            output: '',
            pending: true,
            ...(JSON.stringify(part.arguments ?? {}, null, 2).length >
            MAX_PART_CHARS
              ? { inputTruncated: true }
              : {})
          }
          tools.set(part.id, tool)
          assistant.parts.push(tool)
        }
      }
    } else if (
      message.role === 'toolResult' &&
      typeof message.toolCallId === 'string'
    ) {
      const tool = tools.get(message.toolCallId)
      if (!tool) continue
      const output = textContent(message.content)
      tool.output = output.slice(0, MAX_PART_CHARS)
      tool.truncated = output.length > MAX_PART_CHARS
      tool.error = message.isError === true
      tool.pending = false
      if (assistant && ts) assistant.end_ts = ts
    }
  }
  return { turns: turns.filter((turn) => turn.parts.length > 0), metadata }
}
