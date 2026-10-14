// MIT License - Copyright (c) 2026 devswha; Copyright (c) 2026 T3 Tools Inc.
// Adapted from herdr-web-ui dc2f11d src/lib/chatScrollMemory.ts (see THIRD_PARTY_NOTICES).
export interface IChatPosition {
  turn: string
  offset: number
  atEnd: boolean
}
const positions = new Map<string, IChatPosition>()
/** Document-lifetime only; exact pane/terminal/native session/source/history identity. */
export const chatPositionScope = (
  pane: string,
  terminal: string | undefined,
  session: string | undefined,
  source: string | null,
  history: string
) => JSON.stringify([pane, terminal ?? null, session ?? null, source, history])
export const rememberChatPosition = (
  scope: string,
  position: IChatPosition
) => {
  positions.delete(scope)
  positions.set(scope, position)
  if (positions.size > 100) positions.delete(positions.keys().next().value!)
}
export const readChatPosition = (scope: string) => positions.get(scope)
export const forgetChatPositions = () => positions.clear()
export const chatRestoreIndex = (
  position: IChatPosition | undefined,
  anchors: readonly string[]
): number | null => {
  if (!position || position.atEnd) return null
  const index = anchors.indexOf(position.turn)
  return index < 0 ? null : index
}
export const captureChatPosition = (
  node: HTMLElement,
  atEnd: boolean
): IChatPosition => {
  const top = node.getBoundingClientRect().top
  const row = [...node.querySelectorAll<HTMLElement>('[data-chat-row]')].find(
    (row) => row.getBoundingClientRect().bottom > top
  )
  return {
    turn: row?.dataset.chatRow ?? '',
    offset: row ? row.getBoundingClientRect().top - top : 0,
    atEnd: atEnd || !row
  }
}
