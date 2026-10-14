// MIT License - Copyright (c) 2026 devswha
// Adapted from herdr-web-ui dc2f11d src/lib/chatSearch.ts
import type { IConversationTurn } from '@/types/conversation.ts'

export interface IChatSearchRow {
  key: string
  text: string
}
export interface IChatSearchMatch {
  rowKey: string
  /** UTF-16 offsets into supplied source, not rendered Markdown. */
  start: number
  end: number
}

export const searchLoadedChatRows = (
  rows: readonly IChatSearchRow[],
  query: string,
  matchCase = false
) => {
  const matches: IChatSearchMatch[] = []
  if (!query) return { matches, count: 0 }
  const pattern = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    matchCase ? 'gu' : 'giu'
  )
  for (const row of rows)
    for (const match of row.text.matchAll(pattern)) {
      // A one-character query over the 16 MiB retained window must not allocate millions of ranges.
      if (matches.length === 10000)
        return { matches, count: matches.length, limited: true }
      matches.push({
        rowKey: row.key,
        start: match.index,
        end: match.index + match[0].length
      })
    }
  return { matches, count: matches.length }
}

/** Only supplied native source. Images and synthetic retention notices are not searchable. */
export const chatSearchText = (turn: IConversationTurn): string => {
  if (turn.id === 'loaded-chat-limit') return ''
  return turn.parts
    .map((part) => {
      switch (part.kind) {
        case 'text':
        case 'thinking':
        case 'compact':
        case 'notice':
          return part.text
        case 'tool':
          return [part.name, part.summary, part.input, part.output].join('\n')
        case 'skill':
          return [part.skill.name, part.skill.path ?? ''].join('\n')
        case 'task_result':
          return part.tasks
            .map((task) => `${task.title}\n${task.result}`)
            .join('\n')
        case 'image':
          return ''
      }
    })
    .filter(Boolean)
    .join('\n\n')
}

/** Platform Mod only: on macOS Ctrl+F remains the editor's caret command. */
export const isChatFindShortcut = (
  event: Pick<
    KeyboardEvent,
    'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
  >,
  mac: boolean
) =>
  event.key.toLowerCase() === 'f' &&
  !event.altKey &&
  !event.shiftKey &&
  (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
