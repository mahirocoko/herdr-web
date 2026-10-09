// MIT License - Copyright (c) 2026 devswha
// Adapted from devswha/herdr-web-ui
import type {
  ConversationPart,
  IConversationTurn
} from '../types/conversation.ts'

export type ToolPart = Extract<ConversationPart, { kind: 'tool' }>
export type ThinkingPart = Extract<ConversationPart, { kind: 'thinking' }>
export type TextPart = Extract<ConversationPart, { kind: 'text' }>

export interface ISplitTurn {
  work: ConversationPart[]
  answer: TextPart[]
}

export type WorkCategory = 'edit' | 'read' | 'command' | 'other'

export const CATEGORY_LABEL: Record<
  WorkCategory,
  [singular: string, plural: string]
> = {
  edit: ['{n} edit', '{n} edits'],
  read: ['{n} file read', '{n} file reads'],
  command: ['{n} command', '{n} commands'],
  other: ['{n} other tool', '{n} other tools']
}

export function isTodoTool(name: string): boolean {
  const lower = name.toLowerCase()
  return /todo|update_plan/.test(lower)
}

function categorize(name: string): WorkCategory {
  const lower = name.toLowerCase()
  if (/edit|write|patch|create_file|multiedit/.test(lower)) return 'edit'
  if (/^(read|glob|grep|ls|list|search|find|cat)/.test(lower)) return 'read'
  if (/bash|command|shell|exec|eval|run/.test(lower)) return 'command'
  return 'other'
}

export function splitTurn(parts: ConversationPart[]): ISplitTurn {
  let lastAction = -1
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part?.kind !== 'text' || part.phase === 'commentary') lastAction = index
  }
  const isProse = (part: ConversationPart): part is TextPart =>
    part.kind === 'text' && part.text.trim().length > 0
  return {
    work: parts.filter(
      (part, index) =>
        part.kind !== 'text' ||
        (isProse(part) && part.phase !== 'final_answer' && index <= lastAction)
    ),
    answer: parts.filter(
      (part, index): part is TextPart =>
        isProse(part) && (part.phase === 'final_answer' || index > lastAction)
    )
  }
}

export function workStartsOpen(
  live: boolean,
  parts: ConversationPart[]
): boolean {
  if (live) return true
  const lastAnswer = splitTurn(parts).answer.at(-1)
  const after = lastAnswer === undefined ? 0 : parts.lastIndexOf(lastAnswer) + 1
  return parts
    .slice(after)
    .some((part) => part.kind === 'text' && part.text.trim().length > 0)
}

export function workSummary(parts: readonly ConversationPart[]): string {
  const counts: Record<WorkCategory, number> = {
    edit: 0,
    read: 0,
    command: 0,
    other: 0
  }
  for (const part of parts) {
    if (part.kind !== 'tool') continue
    if (!isTodoTool(part.name)) counts[categorize(part.name)] += 1
  }
  const categories: WorkCategory[] = ['edit', 'read', 'command', 'other']
  return categories
    .filter((cat) => counts[cat] > 0)
    .map((cat) => {
      const n = counts[cat]
      const [singular, plural] = CATEGORY_LABEL[cat]
      return (n === 1 ? singular : plural).replace('{n}', String(n))
    })
    .join(' · ')
}

export function workFailed(parts: readonly ConversationPart[]): number {
  return parts.filter((part) => part.kind === 'tool' && part.error === true)
    .length
}

export function formatWorkDuration(
  startTs: string | null,
  endTs: string | null
): string | null {
  if (startTs === null || endTs === null) return null
  const ms = Date.parse(endTs) - Date.parse(startTs)
  if (!Number.isFinite(ms) || ms < 0) return null
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function isLiveWorkTurn(
  turn: IConversationTurn,
  last: boolean,
  status?: string,
  sentOver?: IConversationTurn | null
): boolean {
  if (turn === sentOver) return false
  return (
    last &&
    turn.role === 'assistant' &&
    (status === 'working' || status === 'blocked')
  )
}

export function isWaitingWorkTurn(live: boolean, status?: string): boolean {
  return live && status === 'blocked'
}
