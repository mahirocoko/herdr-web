// Adapted from devswha/herdr-web-ui@5979118 server/codex.ts scanQuestions.
// MIT License, Copyright (c) 2026 devswha.

/** Private native evidence, not a browser DTO or proof of the TUI's front question. */
export interface IQueuedQuestion {
  key: string
  title: string
  options: string[]
}
export interface ICodexQuestionState {
  asked: readonly IQueuedQuestion[]
  answered: ReadonlySet<string>
}
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const string = (value: unknown): string =>
  typeof value === 'string' ? value : ''
const contentText = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.map((part) => string(record(part).text)).join('\n')
      : ''

/**
 * Fold only descriptor-fenced complete native rows from the exact Codex reader owner.
 * No transcript opening, HOME discovery, newest/CWD scan or terminal-role synthesis.
 * Native skips may leave no record: verify actual opened question before answering.
 */
export const codexQuestionsAfter = (
  state: ICodexQuestionState,
  value: unknown
): ICodexQuestionState => {
  const entry = record(value)
  if (entry.type !== 'response_item') return state
  const payload = record(entry.payload)
  if (
    payload.type === 'function_call' &&
    payload.name === 'request_user_input_async'
  ) {
    let args: Record<string, unknown>
    try {
      args = record(JSON.parse(string(payload.arguments)))
    } catch {
      return state
    }
    const questions = Array.isArray(args.questions)
      ? args.questions.map(record)
      : []
    const callId = string(payload.call_id)
    if (!callId) return state
    const added = questions.map((question, index) => ({
      key: `${callId}:${index}`,
      title: string(question.title) || string(question.question),
      options: Array.isArray(question.options)
        ? question.options
            .map((option) =>
              typeof option === 'string' ? option : string(record(option).label)
            )
            .filter(Boolean)
        : []
    }))
    return { asked: [...state.asked, ...added], answered: state.answered }
  }
  if (payload.type !== 'message' || payload.role !== 'user') return state
  const reply = contentText(payload.content)
    .trim()
    .match(
      /^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/
    )
  let items: unknown
  try {
    items = JSON.parse(reply?.[1] ?? '[]')
  } catch {
    return state
  }
  const answered = new Set(state.answered)
  for (const item of Array.isArray(items) ? items : []) {
    let id: unknown
    try {
      id = JSON.parse(string(record(item).questionItemId))
    } catch {
      continue
    }
    // Only this tool's native frame can settle an async question, not another tool's ID.
    if (
      Array.isArray(id) &&
      id[0] === 'request_user_input_async' &&
      typeof id[1] === 'string' &&
      Number.isInteger(id[2]) &&
      (id[2] as number) >= 0
    )
      answered.add(`${id[1]}:${id[2]}`)
  }
  return { asked: state.asked, answered }
}
export const unansweredCodexQuestions = (
  state: ICodexQuestionState
): IQueuedQuestion[] =>
  state.asked.filter((question) => !state.answered.has(question.key))
