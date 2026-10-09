import type {
  ConversationPart,
  IConversationMetadata,
  IConversationTurn
} from '../../src/types/conversation.ts'

import { toolSummary } from './tool-summary.ts'

const MAX_PART_CHARS = 16_000

/**
 * Strips Agy runtime envelopes, injected system tags, and MemFS memory dumps.
 * Ordinary user Markdown, code blocks, or text are preserved.
 */
export const stripAgyRuntimeContext = (text: string): string => {
  let visible = text

  // Strip system blocks and prompt wrappers
  for (const tag of [
    'identity',
    'user_information',
    'mcp_servers',
    'user_rules',
    'skills',
    'subagents',
    'messaging',
    'conversation_transcript',
    'artifacts',
    'slash_commands',
    'guidelines',
    'communication_style',
    'ADDITIONAL_METADATA',
    'USER_SETTINGS_CHANGE',
    'SYSTEM_MESSAGE'
  ]) {
    visible = visible.replace(
      new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, 'g'),
      ''
    )
  }

  // If text is wrapped in <USER_REQUEST>, extract inner content
  const userRequestMatch = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/.exec(
    visible
  )
  if (userRequestMatch) {
    visible = userRequestMatch[1]
  }

  // Strip MemFS injection headers if present
  visible = visible.replace(/\[MemFS Active Memory\][\s\S]*?(?=\n\n|$)/g, '')
  visible = visible.replace(
    /🔒 \*\*\[Authority Boundary\]\*\*[\s\S]*?(?=\n\n|$)/g,
    ''
  )

  return visible.trim()
}

const textContent = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (part) =>
        part &&
        (typeof part === 'string' ||
          (part.type === 'text' && typeof part.text === 'string'))
    )
    .map((part) => (typeof part === 'string' ? part : part.text))
    .join('\n')
}

const timeString = (val: unknown): string | null => {
  if (!val) return null
  const date = new Date(val as string | number)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

interface IAgyRow {
  step_index: number
  source?: string
  type?: string
  status?: string
  created_at?: string
  content?: unknown
  thinking?: string
  tool_calls?: Array<{ name: string; args?: Record<string, unknown> }>
  model?: string
}

/**
 * Native Agy 1.3.1 transcript parser.
 * - Deduplicates entries by native `step_index`.
 * - Excludes `EPHEMERAL_MESSAGE` and `SYSTEM_SDK` / `SYSTEM` sources.
 * - Pairs sequential tool results (GENERIC) to preceding single tool calls.
 * - Suppresses MemFS context and system envelopes.
 */
export const parseAgyTranscript = (
  text: string
): {
  turns: IConversationTurn[]
  metadata: IConversationMetadata
} => {
  const stepMap = new Map<number, IAgyRow>()

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      if (typeof row.step_index !== 'number') continue
      stepMap.set(row.step_index, row)
    } catch {
      /* Incomplete trailing line during active append */
    }
  }

  // Sort rows strictly by step_index
  const rows = [...stepMap.values()].sort((a, b) => a.step_index - b.step_index)

  const turns: IConversationTurn[] = []
  const metadata: IConversationMetadata = {
    model: null,
    reasoning_effort: null
  }

  let assistantTurn: IConversationTurn | null = null
  let pendingTool: Extract<ConversationPart, { kind: 'tool' }> | null = null

  for (const row of rows) {
    const source = row.source || ''
    const type = row.type || ''

    // Exclude system envelopes and ephemeral bookkeeping
    if (
      type === 'EPHEMERAL_MESSAGE' ||
      source === 'SYSTEM_SDK' ||
      source === 'SYSTEM'
    ) {
      continue
    }

    const immediatelyPending = pendingTool
    pendingTool = null

    if (row.model && typeof row.model === 'string') {
      metadata.model = row.model
    }

    const ts = timeString(row.created_at)

    if (
      type === 'USER_INPUT' &&
      (source === 'USER_EXPLICIT' || source === 'USER')
    ) {
      const rawText = textContent(row.content)
      const visible = stripAgyRuntimeContext(rawText)
      if (!visible) continue

      turns.push({
        id: `agy-step-${row.step_index}`,
        role: 'user',
        ts,
        parts: [
          {
            kind: 'text',
            text: visible.slice(0, MAX_PART_CHARS),
            ...(visible.length > MAX_PART_CHARS ? { truncated: true } : {})
          }
        ]
      })

      assistantTurn = null
      pendingTool = null
    } else if (type === 'PLANNER_RESPONSE' && source === 'MODEL') {
      if (!assistantTurn) {
        assistantTurn = {
          id: `agy-step-${row.step_index}`,
          role: 'assistant',
          ts,
          parts: []
        }
        turns.push(assistantTurn)
      }
      if (ts) assistantTurn.end_ts = ts

      // Thinking block
      if (typeof row.thinking === 'string' && row.thinking.trim()) {
        assistantTurn.parts.push({
          kind: 'thinking',
          text: row.thinking.trim().slice(0, MAX_PART_CHARS),
          ...(row.thinking.trim().length > MAX_PART_CHARS
            ? { truncated: true }
            : {})
        })
      }

      // Tool calls
      const calls = Array.isArray(row.tool_calls) ? row.tool_calls : []
      let singleTool: Extract<ConversationPart, { kind: 'tool' }> | null = null
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i]
        if (!call || typeof call.name !== 'string') continue
        const toolPart: Extract<ConversationPart, { kind: 'tool' }> = {
          kind: 'tool',
          id: `tool-${row.step_index}-${i}`,
          name: call.name,
          summary: toolSummary(call.args),
          input: JSON.stringify(call.args ?? {}, null, 2).slice(
            0,
            MAX_PART_CHARS
          ),
          output: '',
          pending: true,
          ...(JSON.stringify(call.args ?? {}, null, 2).length > MAX_PART_CHARS
            ? { inputTruncated: true }
            : {})
        }
        assistantTurn.parts.push(toolPart)
        singleTool = toolPart
      }

      // If exactly one tool call was emitted, mark as pendingTool for unambiguous pairing
      pendingTool = calls.length === 1 ? singleTool : null

      // Content prose
      const content = textContent(row.content).trim()
      if (content) {
        assistantTurn.parts.push({
          kind: 'text',
          text: content.slice(0, MAX_PART_CHARS),
          ...(content.length > MAX_PART_CHARS ? { truncated: true } : {}),
          phase: calls.length > 0 ? 'commentary' : 'final_answer'
        })
      }
    } else if (type === 'GENERIC' && source === 'MODEL') {
      const outputText = textContent(row.content).trim()
      if (ts && assistantTurn) assistantTurn.end_ts = ts

      if (immediatelyPending) {
        pendingTool = immediatelyPending
        // Unambiguous pairing with preceding single validated tool call
        pendingTool.output = outputText.slice(0, MAX_PART_CHARS)
        pendingTool.truncated = outputText.length > MAX_PART_CHARS
        pendingTool.error = row.status === 'ERROR'
        pendingTool.pending = false
        pendingTool = null
      } else if (assistantTurn && outputText) {
        // Unpaired or multi-call result rendered truthfully as notice
        assistantTurn.parts.push({
          kind: 'notice',
          text: outputText.slice(0, 1000)
        })
      }
    }
  }

  return {
    turns: turns.filter((turn) => turn.parts.length > 0),
    metadata
  }
}
