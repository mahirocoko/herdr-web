import type { IConversationContribution } from '../../src/types/conversation.ts'
import { parseLettaTranscript } from './letta-parser.ts'
import { parseAgyTranscript } from './agy-parser.ts'
import { pairOutputs, pairContributions } from './pair-parser.ts'
import {
  isFamilySource,
  familyOutputs,
  familyContributions,
  type FamilySource
} from './pi-family-parser.ts'

const LIMIT = 16_000
const textContent = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .filter((p) => p?.type === 'text' && typeof p.text === 'string')
          .map((p) => p.text)
          .join('\n')
      : ''
const timestamp = (value: unknown): string | null => {
  if (value == null) return null
  const date = new Date(value as string | number)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

/** Exact recorded output, before presentation clipping. Never accepts an arbitrary row role. */
export const nativeRecordedOutput = (
  line: string,
  source:
    | 'letta-transcript'
    | 'agy-transcript'
    | 'codex-transcript'
    | 'claude-transcript'
    | FamilySource,
  resultId?: string
): { id: string; callId?: string; output: string } | null => {
  const row = JSON.parse(line)
  if (isFamilySource(source)) {
    const outputs = familyOutputs(row).filter(
      (output) => !resultId || output.id === resultId
    )
    return outputs.length === 1 ? outputs[0] : null
  }
  if (source === 'codex-transcript' || source === 'claude-transcript') {
    const outputs = pairOutputs(row, source).filter(
      (output) => !resultId || output.id === resultId
    )
    return outputs.length === 1 ? outputs[0] : null
  }
  if (source === 'letta-transcript') {
    const message = row?.message
    if (
      row?.type !== 'message' ||
      message?.role !== 'toolResult' ||
      typeof message.id !== 'string' ||
      typeof message.toolCallId !== 'string'
    )
      return null
    return {
      id: message.id,
      callId: message.toolCallId,
      output: textContent(message.content)
    }
  }
  if (
    row?.type !== 'GENERIC' ||
    row.source !== 'MODEL' ||
    !Number.isSafeInteger(row.step_index) ||
    row.step_index < 0
  )
    return null
  // Agy's native GENERIC carrier is sequential, not an ID-bearing tool call.
  // Preserve the recorded whitespace; clipping is a separate presentation concern.
  return { id: `agy-step-${row.step_index}`, output: textContent(row.content) }
}

/** Normalize exactly one complete native row. No cross-window pairing or fabricated role. */
export const nativeContribution = (
  line: string,
  position: number,
  source:
    | 'letta-transcript'
    | 'agy-transcript'
    | 'codex-transcript'
    | 'claude-transcript'
    | FamilySource
): IConversationContribution | null => {
  const row = JSON.parse(line)
  if (isFamilySource(source))
    return familyContributions(line, position)[0] ?? null
  if (source === 'codex-transcript' || source === 'claude-transcript')
    return pairContributions(line, position, source)[0] ?? null
  if (source === 'letta-transcript') {
    if (row.type !== 'message' || typeof row.message?.id !== 'string')
      return null
    const message = row.message
    const id = message.id
    const ts = timestamp(message.metadata?.created_at ?? message.timestamp)
    if (message.role === 'toolResult') {
      const output = textContent(message.content)
      return {
        id,
        position,
        role: 'tool-result',
        ts,
        parts: [],
        result: {
          callId:
            typeof message.toolCallId === 'string'
              ? message.toolCallId
              : undefined,
          output: output.slice(0, LIMIT),
          truncated: output.length > LIMIT,
          error: message.isError === true,
          pairing: 'native-id'
        }
      }
    }
    const parsed = parseLettaTranscript(line)
    const turn = parsed.turns[0]
    if (!turn)
      return message.role === 'user' || message.role === 'assistant'
        ? {
            id,
            position,
            role: 'activity',
            ts,
            parts: [],
            model: parsed.metadata.model
          }
        : null
    return {
      id,
      position,
      role: turn.role,
      ts: turn.ts,
      parts: turn.parts,
      model: parsed.metadata.model
    }
  }
  if (!Number.isSafeInteger(row.step_index) || row.step_index < 0) return null
  if (
    row.type === 'EPHEMERAL_MESSAGE' ||
    row.source === 'SYSTEM_SDK' ||
    row.source === 'SYSTEM'
  )
    return {
      id: `agy-step-${row.step_index}`,
      position,
      sequence: row.step_index,
      role: 'activity',
      ts: null,
      parts: [],
      ephemeral: true
    }
  const id = `agy-step-${row.step_index}`
  const ts = timestamp(row.created_at)
  if (row.type === 'GENERIC' && row.source === 'MODEL') {
    const output = textContent(row.content).trim()
    return {
      id,
      position,
      sequence: row.step_index,
      role: 'tool-result',
      ts,
      parts: [],
      result: {
        output: output.slice(0, LIMIT),
        truncated: output.length > LIMIT,
        error: row.status === 'ERROR',
        pairing: 'previous-single'
      }
    }
  }
  const parsed = parseAgyTranscript(line)
  const turn = parsed.turns[0]
  return turn
    ? {
        id,
        position,
        sequence: row.step_index,
        immediateTool:
          Array.isArray(row.tool_calls) &&
          row.tool_calls.length === 1 &&
          typeof row.tool_calls[0]?.name === 'string',
        role: turn.role,
        ts: turn.ts,
        parts: turn.parts,
        model: parsed.metadata.model
      }
    : {
        id,
        position,
        sequence: row.step_index,
        role: 'activity',
        ts,
        parts: []
      }
}
