// MIT License - Copyright (c) 2026 devswha
// Adapted from devswha/herdr-web-ui 5979118: codex.ts, conversation.ts,
// codex-images.ts, transcript-records.ts and skill-activity.ts. Source-native
// semantics only; filesystem/process authority stays in the fenced reader.
import { createHash } from 'node:crypto'
import { withoutMemoryCitations } from './codex-memory-citations.ts'
import { basename, dirname } from 'node:path'
import type { ISkillActivity } from '../../src/types/conversation.ts'
import type {
  ConversationPart,
  IConversationContribution
} from '../../src/types/conversation.ts'
export type PairSource = 'codex-transcript' | 'claude-transcript'
type Row = Record<string, any>
const record = (value: unknown): Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Row)
    : {}
const string = (value: unknown): string =>
  typeof value === 'string' ? value : ''
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const LIMIT = 16000
const nativeId = (value: unknown): string | undefined => typeof value === 'string' && /^[A-Za-z0-9_:.-]{1,128}$/.test(value) ? value : undefined
const clip = (text: string) => ({
  text: text.slice(0, LIMIT),
  truncated: text.length > LIMIT
})
const contextOnly = (text: string) => {
  const value = text.trim()
  return (
    (value.startsWith('# AGENTS.md instructions for ') &&
      value.includes('</INSTRUCTIONS>')) ||
    /^<(environment_context|permissions instructions|turn_aborted|subagent_notification)>[\s\S]*<\/\1>$/.test(
      value
    )
  )
}
export const pairText = (
  value: unknown,
  codex = false,
  user = false
): string =>
  typeof value === 'string'
    ? user && contextOnly(value)
      ? ''
      : value
    : Array.isArray(value)
      ? value
          .flatMap((raw) => {
            const part = record(raw)
            return (codex
              ? ['input_text', 'output_text', 'text', 'summary_text'].includes(
                  part.type
                )
              : typeof part.text === 'string') &&
              typeof part.text === 'string' &&
              !(user && contextOnly(part.text))
              ? [part.text]
              : []
          })
          .join(codex ? '\n' : '')
      : ''
export const isPairClear = (row: Row, source: PairSource) =>
  source === 'claude-transcript' &&
  row.type === 'user' &&
  !row.isMeta &&
  !row.isCompactSummary &&
  row.message?.role === 'user' &&
  typeof row.message.content === 'string' &&
  /^\s*<command-name>\s*\/clear\s*<\/command-name>(?:\s*<command-message>clear<\/command-message>)?(?:\s*<command-args>\s*<\/command-args>)?\s*$/.test(
    row.message.content
  )
const command = (text: string) =>
  text.startsWith('<command-') ||
  text.startsWith('<local-command') ||
  text.startsWith('<task-')
const unwrapPastes = (text: string): string => {
  let changed = false
  const visible = text.replace(
    /<pasted_content id="([^"\r\n]+)">\r?\n([\s\S]*?)\r?\n<\/pasted_content id="([^"\r\n]+)">/g,
    (whole, opening, body, closing) => {
      if (
        opening !== closing ||
        opening.length > 64 ||
        !/^[\w-]+$/.test(opening)
      )
        return whole
      changed = true
      return body
    }
  )
  return changed ? visible.replace(/^\n+|\n+$/g, '') : visible
}
const selectedSkill = (text: string) => {
  const match =
    /^<skill>\s*<name>([^<>\r\n]+)<\/name>\s*<path>([^<>\r\n]+)<\/path>[\s\S]*<\/skill>$/.exec(
      text.trim()
    )
  return match &&
    match[1].length <= 200 &&
    match[2].length <= 4096 &&
    match[2].replaceAll('\\', '/').endsWith('/SKILL.md')
    ? {
        name: match[1],
        path: match[2],
        evidence: 'instructions' as const,
        status: 'loaded' as const
      }
    : null
}
const questionReply = (text: string): string | null => {
  const match = text.trim().match(/^<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>$/)
  if (!match) return null
  try {
    const items: unknown = JSON.parse(match[1]!)
    if (!Array.isArray(items)) return null
    const answers = items.map(item => string(record(item).answer).trim()).filter(Boolean)
    return answers.length > 0 ? answers.join('\n') : null
  } catch { return null }
}
export interface INativeImage {
  key: string
  mediaType: string
  value: string
  inline: boolean
}
const DATA_IMAGE =
  /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/
const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
}
export const pairImages = (row: Row, source: PairSource): INativeImage[] => {
  if (source === 'claude-transcript') {
    if (
      row.type !== 'user' ||
      typeof row.uuid !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(row.uuid) ||
      !Array.isArray(row.message?.content)
    )
      return []
    return row.message.content.flatMap((block: any, index: number) =>
      index <= 999 && block?.type === 'image' &&
      block.source?.type === 'base64' &&
      typeof block.source.data === 'string' &&
      Object.values(TYPES).includes(block.source.media_type)
        ? [
            {
              key: `${row.uuid}:${index}`,
              mediaType: block.source.media_type,
              value: block.source.data,
              inline: true
            }
          ]
        : []
    )
  }
  const p = record(row.payload)
  const values: string[] =
    row.type === 'event_msg' &&
    p.type === 'user_message' &&
    (!p.kind || p.kind === 'plain')
      ? [p.local_images, p.images].flatMap((value) =>
          Array.isArray(value)
            ? value.filter((item): item is string => typeof item === 'string')
            : []
        )
      : row.type === 'response_item' &&
          p.type === 'message' &&
          p.role === 'user' &&
          Array.isArray(p.content)
        ? p.content.flatMap((raw: any) =>
            raw?.type === 'input_image' && typeof raw.image_url === 'string'
              ? [raw.image_url]
              : raw?.type === 'local_image' && typeof raw.path === 'string'
                ? [raw.path]
                : []
          )
        : []
  return [...new Set(values)].flatMap((value) => {
    if (
      !value ||
      value.includes('\0') ||
      value.length > (8 * 1024 * 1024 * 4) / 3 + 128
    )
      return []
    const inline = DATA_IMAGE.exec(value)
    if (!inline && /^[a-z][a-z\d+.-]*:/i.test(value)) return []
    const mediaType =
      inline?.[1] ?? TYPES[value.split('.').at(-1)?.toLowerCase() ?? '']
    return mediaType
      ? [
          {
            key: `codex-${hash(value)}`,
            mediaType,
            value: inline ? inline[2] : value,
            inline: !!inline
          }
        ]
      : []
  })
}
export const pairOutputs = (
  row: Row,
  source: PairSource
): { id: string; callId: string; output: string; error: boolean }[] => {
  const p = record(row.payload)
  if (source === 'codex-transcript') {
    if (
      row.type !== 'response_item' ||
      !['function_call_output', 'custom_tool_call_output'].includes(p.type) ||
      !nativeId(p.call_id)
    )
      return []
    const output = pairText(p.output, true)
    const head = output.slice(0, 2000)
    const code =
      /^(?:Process exited with code|Exit code:) (\d+)$/m.exec(head) ??
      /"exit_code":\s*(\d+)/.exec(head)
    return [
      {
        id: `codex-result:${p.call_id}`,
        callId: p.call_id,
        output,
        error:
          !/^Script completed\b/m.test(head) &&
          (/^Script failed\b/m.test(head) ||
            /apply_patch verification failed/.test(head) ||
            (code !== null && code[1] !== '0'))
      }
    ]
  }
  return row.type === 'user' &&
    !row.isMeta &&
    Array.isArray(row.message?.content)
    ? row.message.content.flatMap((block: any) =>
        block?.type === 'tool_result' && !!nativeId(block.tool_use_id)
          ? [
              {
                id: `claude-result:${block.tool_use_id}`,
                callId: block.tool_use_id,
                output: pairText(block.content),
                error: block.is_error === true
              }
            ]
          : []
      )
    : []
}
const skillDocument = (value: unknown): ISkillActivity | null => {
  if (typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value))
    return null
  const normalized = value.replaceAll('\\', '/')
  if (!normalized.endsWith('/SKILL.md')) return null
  const name = basename(dirname(normalized))
  return name && name !== '.' && name.length <= 200 && !/[\r\n<>]/.test(name)
    ? { name, path: value, evidence: 'instructions', status: 'loaded' }
    : null
}
const codexReadCall = (name: string, args: Row): ISkillActivity | null => {
  if (name === 'read_file' || name === 'Read') {
    const skill = skillDocument(args.file_path ?? args.path)
    return skill ? { ...skill, status: 'requested' } : null
  }
  if (name !== 'exec_command' && name !== 'shell_command' && name !== 'shell')
    return null
  const cmd = args.cmd ?? args.command
  if (typeof cmd !== 'string' || /[\n;&|<>`$]/.test(cmd)) return null
  const match =
    /^(?:cat|head(?:\s+-n\s+\d+)?|sed\s+-n\s+['"]?\d+(?:,\d+)?p['"]?)\s+(?:"([^"\n]+)"|'([^'\n]+)'|(\S+))\s*$/.exec(
      cmd.trim()
    )
  const skill = match ? skillDocument(match[1] ?? match[2] ?? match[3]) : null
  return skill ? { ...skill, status: 'requested' } : null
}
const tool = (
  id: string,
  name: string,
  raw: unknown,
  codex = false
): ConversationPart => {
  let args = record(raw)
  if (typeof raw === 'string') {
    try {
      args = record(JSON.parse(raw))
    } catch {
      /* native freeform */
    }
  }
  const input = !codex ? JSON.stringify(typeof raw === 'object' && raw !== null ? raw : {}, null, 2) : Object.keys(args).length
    ? JSON.stringify(args, null, 2)
    : string(raw)
  const questionTitles = Array.isArray(args.questions) ? args.questions.map((question: unknown) => string(record(question).title) || string(record(question).question)).filter(Boolean) : []
  const summary = /^request_user_input/.test(name) && questionTitles.length ? questionTitles.join(' · ') :
    [
      args.cmd,
      args.command,
      args.file_path,
      args.path,
      args.pattern,
      args.description,
      args.url
    ].find((v) => typeof v === 'string') ?? name
  const skill =
    name === 'Skill' &&
    typeof args.skill === 'string' &&
    args.skill.length <= 200 &&
    !/[\r\n<>]/.test(args.skill)
      ? {
          name: args.skill,
          evidence: 'invocation' as const,
          status: 'requested' as const
        }
      : codex
        ? (codexReadCall(name, args) ?? undefined)
        : undefined
  return {
    kind: 'tool',
    id,
    name,
    summary:
      skill?.evidence === 'invocation'
        ? skill.name
        : string(summary).slice(0, 120),
    input: input.slice(0, LIMIT),
    inputTruncated: input.length > LIMIT,
    output: '',
    pending: true,
    skill
  }
}
/** A row can contain several Claude tool results; preserve each native call ID. */
export const pairContributions = (
  line: string,
  position: number,
  source: PairSource
): IConversationContribution[] => {
  const row = record(JSON.parse(line))
  const p = record(row.payload)
  const m = record(row.message)
  const ts = typeof row.timestamp === 'string' ? row.timestamp : null
  const base =
    source === 'claude-transcript'
      ? nativeId(row.uuid) || `claude-byte:${position}`
      : nativeId(p.id) || `codex-byte:${position}`
  const provenance = { nativeRecordId: source === 'claude-transcript' ? nativeId(row.uuid) : nativeId(p.id), messageId: source === 'claude-transcript' ? nativeId(m.id) : undefined }
  const outputs = pairOutputs(row, source).map((result) => ({
    ...provenance,
    id: result.id,
    position,
    role: 'tool-result' as const,
    ts,
    parts: [],
    result: {
      callId: result.callId,
      output: result.output.slice(0, LIMIT),
      truncated: result.output.length > LIMIT,
      error: result.error,
      pairing: 'native-id' as const
    }
  }))
  if (source === 'claude-transcript' && row.isMeta) return []
  if (isPairClear(row, source))
    return [
      { id: base, position, role: 'activity', ts, parts: [], reset: true }
    ]
  const images = pairImages(row, source).map((image) => ({
    kind: 'image' as const,
    ref: image.key,
    media_type: image.mediaType
  }))
  const parts: ConversationPart[] = []
  let role: IConversationContribution['role'] = 'activity'
  let model: string | null =
    source === 'claude-transcript'
      ? typeof m.model === 'string'
        ? m.model
        : null
      : null
  let reasoning: string | null = null
  let duplicateSource: 'event' | 'response' | undefined
  let duplicateText: string | undefined
  let turnStart: string | undefined
  let turnEnd: boolean | undefined
  let nativeTurnId: string | undefined
  let skillEventId: string | undefined
  if (source === 'claude-transcript') {
    if (row.isCompactSummary) {
      role = 'user'
      parts.push({
        kind: 'compact',
        ...clip(typeof m.content === 'string' ? m.content : pairText(m.content))
      })
    } else if (
      row.type === 'attachment' &&
      row.attachment?.type === 'queued_command' &&
      row.attachment.commandMode === 'prompt' &&
      row.attachment.origin?.kind === 'human' &&
      typeof row.attachment.prompt === 'string' && row.attachment.prompt.trim() &&
      !command(row.attachment.prompt.trim())
    ) {
      role = 'user'
      parts.push({ kind: 'text', ...clip(unwrapPastes(row.attachment.prompt)) })
    } else if (
      row.type === 'system' &&
      row.subtype === 'local_command' &&
      typeof row.content === 'string'
    ) {
      const match =
        /^\s*<local-command-(stdout|stderr)>([\s\S]*)<\/local-command-\1>\s*$/.exec(
          row.content
        )
      if (match) {
        const text = match[2]
          .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
          .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
          .replace(/\u001b./g, '')
          .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
          .trim()
        if (text.length) { role = 'user'; parts.push({ kind: 'notice', source: 'local-command', text: text.length > 4000 ? `${text.slice(0,4000)}\u2026` : text, truncated: text.length > 4000 }) }
      }
    } else if (row.type === 'user') {
      const content =
        typeof m.content === 'string'
          ? [{ type: 'text', text: m.content }]
          : Array.isArray(m.content)
            ? m.content
            : []
      const prompt = content
        .flatMap((b: any) =>
          b?.type === 'text' &&
          typeof b.text === 'string' &&
          !command(b.text.trim())
            ? [b.text]
            : []
        )
        .join('\n')
      if (prompt.trim() || images.length) {
        role = 'user'
        parts.push(...images)
        if (prompt.trim())
          parts.push({ kind: 'text', ...clip(unwrapPastes(prompt)) })
      }
    } else if (row.type === 'assistant' && Array.isArray(m.content)) {
      role = 'assistant'
      for (const b of m.content) {
        if (b?.type === 'text' && typeof b.text === 'string' && b.text.length > 0)
          parts.push({ kind: 'text', ...clip(b.text) })
        else if (b?.type === 'thinking') {
          const thinking = typeof b.thinking === 'string' ? b.thinking : string(b.text)
          if (thinking.length > 0) parts.push({ kind: 'thinking', ...clip(thinking) })
        }
        else if (
          b?.type === 'tool_use' &&
          typeof b.name === 'string' &&
          !!nativeId(b.id)
        )
          parts.push(tool(b.id, b.name, b.input))
      }
    }
  } else {
    if (row.type === 'turn_context') {
      model = typeof p.model === 'string' ? p.model : null
      reasoning =
        typeof p.effort === 'string'
          ? p.effort
          : typeof p.reasoning_effort === 'string'
            ? p.reasoning_effort
            : null
    }
    if (row.type === 'event_msg') {
      if (p.type === 'task_started') {
        turnStart = string(p.started_at) || ts || undefined
        nativeTurnId = nativeId(p.turn_id)
      }
      if (p.type === 'task_complete' || p.type === 'turn_aborted')
        turnEnd = true
      if (p.type === 'user_message' && (!p.kind || p.kind === 'plain')) {
        role = 'user'
        duplicateSource = 'event'
        const nativeText = pairText(p.message, true, true)
        const text = questionReply(nativeText) ?? nativeText
        duplicateText = text
        parts.push(...images)
        if (text.trim()) parts.push({ kind: 'text', ...clip(text) })
      } else if (p.type === 'agent_message') {
        role = 'assistant'
        duplicateSource = 'event'
        duplicateText = withoutMemoryCitations(pairText(p.message, true))
        if (duplicateText.trim()) parts.push({
          kind: 'text',
          ...clip(withoutMemoryCitations(pairText(p.message, true))),
          ...(p.phase === 'commentary' || p.phase === 'final_answer'
            ? { phase: p.phase }
            : {})
        })
      } else if (
        p.type === 'item_completed' &&
        p.item?.type === 'CommandExecution' &&
        ['completed', 'failed'].includes(p.item.status) &&
        Array.isArray(p.item.parsed_cmd)
      ) {
        role = 'assistant'
        skillEventId = nativeId(p.item.id)
        nativeTurnId = nativeId(p.turn_id)
        if (skillEventId) for (const cmd of p.item.parsed_cmd) {
          const skill = cmd?.type === 'read' ? skillDocument(cmd.path) : null
          if (skill && typeof p.item.exit_code === 'number') parts.push({kind:'skill',skill:{...skill,status:p.item.exit_code===0?'loaded':'failed'}})
        }
      }
    } else if (row.type === 'response_item') {
      if (p.type === 'message' && p.role === 'user') {
        role = 'user'
        duplicateSource = 'response'
        const content = Array.isArray(p.content)
          ? p.content
          : [{ type: 'input_text', text: p.content }]
        const visible = content.filter(
          (b: any) => !selectedSkill(string(b?.text))
        )
        const nativeText = pairText(visible, true, true)
        const text = questionReply(nativeText) ?? nativeText
        duplicateText = text
        parts.push(...images)
        if (text.trim()) parts.push({ kind: 'text', ...clip(text) })
        for (const b of content) {
          const skill = selectedSkill(string(b?.text))
          if (skill) parts.push({ kind: 'skill', skill })
        }
      } else if (
        p.type === 'message' &&
        p.role === 'assistant' &&
        (p.channel === 'analysis' || !p.recipient || p.recipient === 'all')
      ) {
        role = 'assistant'
        duplicateSource = p.channel === 'analysis' ? undefined : 'response'
        duplicateText = withoutMemoryCitations(pairText(p.content, true))
        const body = p.channel === 'analysis' ? pairText(p.content, true) : duplicateText
        if (body.trim()) parts.push({
          kind: p.channel === 'analysis' ? 'thinking' : 'text',
          ...clip(
            p.channel === 'analysis'
              ? pairText(p.content, true)
              : withoutMemoryCitations(pairText(p.content, true))
          ),
          ...(p.phase === 'commentary' || p.phase === 'final_answer'
            ? { phase: p.phase }
            : {})
        })
      } else if (p.type === 'reasoning') {
        role = 'assistant'
        const body = pairText(p.summary, true)
        if (body.trim()) parts.push({ kind: 'thinking', ...clip(body) })
      } else if (
        ['function_call', 'custom_tool_call'].includes(p.type) &&
        !!nativeId(p.call_id)
      ) {
        role = 'assistant'
        parts.push(
          tool(
            p.call_id,
            string(p.name) || 'tool',
            p.type === 'function_call' ? p.arguments : p.input,
            true
          )
        )
      }
    }
  }
  const selected =
    source === 'codex-transcript' && role === 'user'
      ? parts.filter((part) => part.kind === 'skill')
      : []
  const visible = selected.length
    ? parts.filter((part) => part.kind !== 'skill')
    : parts
  const contribution: IConversationContribution = {
    ...provenance,
    id: base,
    position,
    role,
    ts,
    parts: visible,
    model,
    reasoning_effort: reasoning,
    duplicateSource,
    duplicateKey: duplicateText === undefined ? undefined : hash(duplicateText),
    turnStart,
    nativeTurnId,
    skillEventId,
    turnEnd
  }
  return [
    ...(visible.length || model || reasoning || turnStart || turnEnd
      ? [contribution]
      : []),
    ...(selected.length
      ? [
          {
            id: `${base}:skills`,
            position,
            role: 'assistant' as const,
            ts,
            parts: selected
          }
        ]
      : []),
    ...outputs
  ]
}
/** Native event/response mirrors pair once within the source's eight-record horizon. */
export const reconcilePairMirrors = (rows: IConversationContribution[]) => {
  const messages: IConversationContribution[] = []
  const omitted = new Set<IConversationContribution>()
  const paired = new Set<IConversationContribution>()
  for (const row of rows) {
    if (!row.duplicateSource) continue
    const body = row.duplicateKey
    const previous = messages
      .slice(-8)
      .reverse()
      .find(
        (other) =>
          !paired.has(other) &&
          other.role === row.role &&
          other.duplicateSource !== row.duplicateSource &&
          other.duplicateKey === body &&
          (other.ts === row.ts ||
            Math.abs(Date.parse(other.ts ?? '') - Date.parse(row.ts ?? '')) <=
              1000)
      )
    if (previous) {
      paired.add(previous)
      omitted.add(row)
      const phase = row.parts.find((p) => p.kind === 'text')?.phase
      if (phase)
        for (const part of previous.parts)
          if (part.kind === 'text') part.phase = phase
      const images = row.parts.filter((p) => p.kind === 'image')
      if (
        images.length &&
        (row.duplicateSource === 'event' ||
          !previous.parts.some((p) => p.kind === 'image'))
      )
        previous.parts = [
          ...images,
          ...previous.parts.filter((p) => p.kind !== 'image')
        ]
    } else messages.push(row)
  }
  return rows.filter((row) => !omitted.has(row))
}
