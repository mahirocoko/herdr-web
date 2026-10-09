// MIT License - Copyright (c) 2026 devswha
// Adapted from transcript-records.ts / skill-activity.ts at 5979118.
import type {
  IConversationContribution,
  ConversationPart,
  IOmoTaskResult
} from '../../src/types/conversation.ts'
import type { INativeImage } from './pair-parser.ts'
export type FamilySource =
  'omp-transcript' | 'omo-transcript' | 'gjc-transcript' | 'pi-transcript'
export const isFamilySource = (source: string): source is FamilySource =>
  /^(omp|omo|gjc|pi)-transcript$/.test(source)
const record = (value: any): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
const first = (...values: any[]) =>
  values.find((value) => typeof value === 'string')
const text = (value: any): string =>
  typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value
          .map((block) => (typeof block?.text === 'string' ? block.text : ''))
          .join('')
      : ''
const LIMIT = 16000
const clip = (value: string) => ({
  text: value.slice(0, LIMIT),
  truncated: value.length > LIMIT
})
const skillPrompt = (
  text: string
): {
  skills: Extract<ConversationPart, { kind: 'skill' }>[]
  request: string
} | null => {
  const instruction =
    /^The user explicitly invoked the "([^"]+)" skill\. Follow the instructions in <skill-instruction> as binding for this request, while respecting higher-priority instructions\.\n\n<skill-instruction name="([^"]+)" location="([^"]+)">\n[\s\S]*?\n<\/skill-instruction>/
  const skills: Extract<ConversationPart, { kind: 'skill' }>[] = []
  const add = (name: string, location: string) => {
    if (
      !name ||
      name.length > 200 ||
      /[\r\n<>]/.test(name) ||
      !location ||
      location.length > 4096 ||
      /[\r\n]/.test(location)
    )
      return false
    skills.push({
      kind: 'skill',
      skill: {
        name,
        path: location,
        evidence: 'instructions',
        status: 'loaded'
      }
    })
    return true
  }
  let remainder = text,
    match = instruction.exec(remainder)
  while (match) {
    if (match[1] !== match[2] || !add(match[1], match[3]) || skills.length > 64)
      return null
    remainder = remainder.slice(match[0].length)
    if (!remainder.startsWith('\n\nThe user explicitly invoked the ')) break
    remainder = remainder.slice(2)
    match = instruction.exec(remainder)
    if (!match) return null
  }
  if (skills.length) {
    if (!remainder)
      return {
        skills,
        request: skills.map((part) => `/skill:${part.skill.name}`).join(' ')
      }
    const request = /^\n\n<user-request>\n([\s\S]*?)\n<\/user-request>$/.exec(
      remainder
    )
    return request ? { skills, request: request[1].trim() } : null
  }
  const legacy =
    /^<skill name="([^"\r\n<>]+)" location="([^"\r\n]+)">\n[\s\S]*?\n<\/skill>(?:\n\n([\s\S]+))?$/.exec(
      text
    )
  return legacy && add(legacy[1], legacy[2])
    ? { skills, request: legacy[3]?.trim() || `/skill:${legacy[1]}` }
    : null
}
export const familyMessage = (entry: any): Record<string, any> | null => {
  const message = record(entry?.message)
  if (
    entry?.type !== 'message' ||
    entry.display === false ||
    message.display === false
  )
    return null
  const raw =
    typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : Array.isArray(message.content)
        ? message.content
        : []
  return {
    ...message,
    toolCallId: first(message.toolCallId, message.callId),
    content: raw.map((value: any) => {
      const block = record(value)
      if (block.type === 'toolCall')
        return {
          ...block,
          name: first(block.toolName, block.name),
          id: first(block.toolCallId, block.id, block.callId),
          arguments: block.toolInput ?? block.input ?? block.arguments
        }
      if (block.type === 'toolResult')
        return {
          ...block,
          toolCallId: first(block.toolCallId, block.callId, block.id),
          content: block.output ?? block.content ?? block.result
        }
      return block
    })
  }
}
export const isFamilyClear = (entry: any) =>
  entry?.type === 'custom' && entry.customType === 'context_clear'
export const familyOutputs = (
  entry: any
): { id: string; callId: string; output: string; error: boolean }[] => {
  const message = familyMessage(entry)
  if (!message) return []
  const blocks =
    message.role === 'toolResult'
      ? [message]
      : message.content.filter((block: any) => block.type === 'toolResult')
  return blocks.flatMap((block: any, index: number) =>
    typeof block.toolCallId === 'string'
      ? [
          {
            id: `${entry.id}:result:${index}`,
            callId: block.toolCallId,
            output: text(block.content),
            error: block.isError === true
          }
        ]
      : []
  )
}
export const familyTaskTitles = (entry: any): [string, string][] => {
  const message = familyMessage(entry)
  if (message?.role !== 'toolResult' || message.toolName !== 'task') return []
  const details = record(message.details)
  return (Array.isArray(details.items) ? details.items : [details]).flatMap(
    (item: any) =>
      typeof item?.task_id === 'string' &&
      typeof (item.task_summary ?? item.description) === 'string'
        ? [
            [item.task_id, item.task_summary ?? item.description] as [
              string,
              string
            ]
          ]
        : []
  )
}
export const familyTaskResults = (
  entry: any,
  titles: ReadonlyMap<string, string>
): IOmoTaskResult[] => {
  if (
    entry?.type !== 'custom_message' ||
    entry.customType !== 'omo-senpi:wake' ||
    !Array.isArray(entry.details)
  )
    return []
  const label = (value: any) =>
    typeof value === 'string' && value.trim() ? value.trim() : null
  const amount = (value: any) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? value
      : null
  const tasks = new Map<string, IOmoTaskResult>()
  for (const group of entry.details)
    if (
      group?.customType === 'senpi-task.completion' &&
      Array.isArray(group.details)
    )
      for (const value of group.details) {
        const task = record(value),
          id = label(task.task_id),
          status = label(task.status)
        if (!id || !status) continue
        const stats = record(task.run_stats),
          agent =
            label(task.agent_type) ??
            label(task.category) ??
            label(task.subagent_type),
          name = label(task.name),
          result = label(task.final_response) ?? label(task.error) ?? ''
        tasks.set(id, {
          id,
          title: titles.get(id) ?? (name && name !== id ? name : (agent ?? id)),
          agent,
          model:
            label(record(task.resolved_model).display) ?? label(task.model),
          status:
            status === 'completed'
              ? 'completed'
              : ['cancelled', 'canceled', 'aborted'].includes(status)
                ? 'cancelled'
                : 'failed',
          duration_ms: amount(task.duration_ms) ?? amount(stats.runtime_ms),
          turns: amount(stats.turns),
          tool_calls: amount(stats.tool_calls),
          tokens: amount(stats.total_tokens) ?? amount(task.tokens),
          result: result.slice(0, LIMIT),
          ...(result.length > LIMIT ? { result_cut: true } : {})
        })
      }
  return [...tasks.values()]
}
export const familyImages = (
  entry: any
): (INativeImage & { callId?: string })[] => {
  const message = familyMessage(entry)
  if (!message) return []
  const result: (INativeImage & { callId?: string })[] = []
  const append = (blocks: any[], prefix: string, callId?: string) =>
    blocks.forEach((block, index) => {
      const mediaType = block?.mimeType ?? block?.media_type
      if (
        block?.type === 'image' &&
        ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
          mediaType
        ) &&
        typeof block.data === 'string'
      )
        result.push({
          key: `${prefix}:${index}`,
          mediaType,
          value: block.data,
          inline: true,
          ...(callId ? { callId } : {})
        })
    })
  if (message.role === 'user' || message.role === 'toolResult')
    append(
      message.content,
      'image',
      message.role === 'toolResult' ? message.toolCallId : undefined
    )
  message.content.forEach((block: any, index: number) => {
    if (block.type === 'toolResult' && Array.isArray(block.content))
      append(block.content, `result:${index}`, block.toolCallId)
  })
  return result
}
export const familyContributions = (
  line: string,
  position: number,
  taskTitles: ReadonlyMap<string, string> = new Map()
): IConversationContribution[] => {
  const entry = JSON.parse(line)
  if (typeof entry?.id !== 'string' || !entry.id || entry.id.length > 128)
    return []
  const base = {
    id: entry.id,
    position,
    ts: typeof entry.timestamp === 'string' ? entry.timestamp : null
  }
  if (isFamilyClear(entry))
    return [{ ...base, role: 'activity', parts: [], reset: true }]
  const tasks = familyTaskResults(entry, taskTitles)
  if (tasks.length)
    return [{ ...base, role: 'user', parts: [{ kind: 'task_result', tasks }] }]
  if (entry.type === 'model_change')
    return [
      {
        ...base,
        role: 'activity',
        parts: [],
        model: typeof entry.modelId === 'string' ? entry.modelId : null
      }
    ]
  if (entry.type === 'thinking_level_change')
    return [
      {
        ...base,
        role: 'activity',
        parts: [],
        reasoning_effort:
          typeof entry.thinkingLevel === 'string' ? entry.thinkingLevel : null
      }
    ]
  if (entry.type === 'compaction' && typeof entry.summary === 'string')
    return [
      {
        ...base,
        role: 'user',
        parts: [{ kind: 'compact', ...clip(entry.summary) }]
      }
    ]
  if (
    entry.type === 'custom_message' &&
    entry.display !== false &&
    typeof entry.content === 'string'
  )
    return [
      {
        ...base,
        role: 'user',
        parts: [
          {
            kind: 'notice',
            ...clip(
              entry.content
                .trim()
                .replace(/^<system-notice>\s*/, '')
                .replace(/\s*<\/system-notice>$/, '')
            )
          }
        ]
      }
    ]
  const message = familyMessage(entry)
  if (!message) return []
  const rows: IConversationContribution[] = familyOutputs(entry).map(
    (output) => ({
      ...base,
      id: output.id,
      role: 'tool-result',
      parts: [],
      result: {
        callId: output.callId,
        output: output.output.slice(0, LIMIT),
        truncated: output.output.length > LIMIT,
        error: output.error,
        pairing: 'native-id'
      }
    })
  )
  const parts: ConversationPart[] = []
  if (message.role === 'user' || message.role === 'assistant') {
    for (const block of message.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const invocation =
          message.role === 'user' ? skillPrompt(block.text) : null
        if (invocation)
          parts.push(
            { kind: 'text', ...clip(invocation.request) },
            ...invocation.skills
          )
        else parts.push({ kind: 'text', ...clip(block.text) })
      } else if (
        message.role === 'assistant' &&
        block.type === 'thinking' &&
        typeof (block.thinking ?? block.text) === 'string'
      )
        parts.push({ kind: 'thinking', ...clip(block.thinking ?? block.text) })
      else if (
        message.role === 'assistant' &&
        block.type === 'toolCall' &&
        typeof block.name === 'string' &&
        typeof block.id === 'string'
      ) {
        const args = record(block.arguments),
          input = JSON.stringify(args, null, 2)
        parts.push({
          kind: 'tool',
          id: block.id,
          name: block.name,
          summary: String(
            block.intent ??
              args.command ??
              args.path ??
              args.file_path ??
              block.name
          ).slice(0, 120),
          input: input.slice(0, LIMIT),
          inputTruncated: input.length > LIMIT,
          output: '',
          pending: true
        })
      }
    }
    if (
      message.stopReason === 'error' &&
      typeof message.errorMessage === 'string'
    )
      parts.push({
        kind: 'notice',
        severity: 'error',
        ...clip(message.errorMessage)
      })
    rows.unshift({
      ...base,
      role: message.role,
      parts,
      model: typeof message.model === 'string' ? message.model : undefined,
      turnEnd: message.stopReason === 'stop',
      closesAssistantTurn: message.stopReason === 'stop'
    })
  }
  const images = familyImages(entry)
  for (const image of images) {
    const part: ConversationPart = {
      kind: 'image',
      ref: image.key,
      media_type: image.mediaType
    }
    const owner = image.callId
      ? rows.find((row) => row.result?.callId === image.callId)
      : rows.find((row) => row.id === entry.id)
    if (owner) owner.parts.push(part)
  }
  return rows
}
