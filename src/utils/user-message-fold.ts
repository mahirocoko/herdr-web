// MIT License - Copyright (c) 2026 devswha; Copyright (c) 2026 T3 Tools Inc.
// Adapted from dc2f11de lib/userMessageFold.ts (t3code shouldCollapseUserMessage).
export const USER_MESSAGE_FOLD_LINES = 12
export const USER_MESSAGE_FOLD_CHARS = 900
const MARKDOWN_LINK = /!?\[([^\]\n]*)\]\((?:<[^>\n]*>|[^\s)]*)\)/g
export const visibleUserMessageText = (text: string): string =>
  text.replace(MARKDOWN_LINK, '$1')
export const shouldFoldUserMessage = (text: string): boolean => {
  const visible = visibleUserMessageText(text).trim()
  return (
    visible.length > USER_MESSAGE_FOLD_CHARS ||
    visible.split('\n').length > USER_MESSAGE_FOLD_LINES
  )
}
