// Adapted from devswha/herdr-web-ui@5979118 server/omo-ask.ts.
// MIT License, Copyright (c) 2026 devswha.

/** Pure native-record fold. Transcript selection/open/descriptor fences belong the native reader. */
export const OMO_ASK_TOOLS: ReadonlySet<string> = new Set([
  'ask_user_question',
  'request_user_input'
])

export interface IOmoAskCall {
  id: string
  wait: boolean
  args: unknown
}
export type OmoAsks = readonly IOmoAskCall[]
interface IEntry {
  type?: unknown
  customType?: unknown
  data?: unknown
  message?: {
    role?: unknown
    content?: unknown
    toolCallId?: unknown
    isError?: unknown
    details?: unknown
  }
}
const ANSWER_FRAME_RE = /^\[Answer to question ([^\]\r\n]+)\]\r?\n/
const waits = (args: unknown): boolean => {
  const record =
    typeof args === 'object' && args !== null
      ? (args as Record<string, unknown>)
      : {}
  return (record.waitForAnswer ?? record.wait_for_answer) !== false
}
const without = (open: OmoAsks, id: string): OmoAsks =>
  open.some((call) => call.id === id)
    ? open.filter((call) => call.id !== id)
    : open

/** Open calls, oldest first. Assistant narration is never evidence of an answer. */
export const omoAsksAfter = (open: OmoAsks, entry: IEntry): OmoAsks => {
  if (entry.type === 'custom') {
    const id =
      entry.customType === 'ask-user:settlement'
        ? (entry.data as { requestId?: unknown } | null)?.requestId
        : undefined
    return typeof id === 'string' ? without(open, id) : open
  }
  const message = entry.type === 'message' ? entry.message : undefined
  if (message?.role === 'assistant') {
    const calls = (
      Array.isArray(message.content)
        ? (message.content as Record<string, unknown>[])
        : []
    )
      .filter(
        (part) =>
          part?.type === 'toolCall' &&
          typeof part.id === 'string' &&
          OMO_ASK_TOOLS.has(part.name as string) &&
          part.incomplete !== true
      )
      .map((part) => ({
        id: part.id as string,
        wait: waits(part.arguments),
        args: part.arguments
      }))
    const ids = new Set(calls.map((call) => call.id))
    return calls.length > 0
      ? [...open.filter((call) => !ids.has(call.id)), ...calls]
      : open
  }
  if (
    message?.role === 'toolResult' &&
    typeof message.toolCallId === 'string'
  ) {
    const details = (message.details ?? {}) as {
      accepted?: unknown
      status?: unknown
    }
    const accepted =
      message.isError !== true &&
      details.accepted === true &&
      details.status === 'pending'
    return accepted ? open : without(open, message.toolCallId)
  }
  if (message?.role === 'user') {
    const texts =
      typeof message.content === 'string'
        ? [message.content]
        : Array.isArray(message.content)
          ? (message.content as { type?: unknown; text?: unknown }[]).flatMap(
              (part) =>
                part?.type === 'text' && typeof part.text === 'string'
                  ? [part.text]
                  : []
            )
          : []
    return texts.reduce((rest, text) => {
      const id = ANSWER_FRAME_RE.exec(text)?.[1]
      return id === undefined ? rest : without(rest, id)
    }, open)
  }
  return open
}
