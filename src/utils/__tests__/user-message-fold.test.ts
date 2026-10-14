// MIT License - Copyright (c) 2026 devswha
import { expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  shouldFoldUserMessage,
  visibleUserMessageText,
  USER_MESSAGE_FOLD_CHARS,
  USER_MESSAGE_FOLD_LINES
} from '../user-message-fold.ts'
const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `line ${i}`).join('\n')
it('folds only beyond exact line/character boundaries (upstream rule)', () => {
  expect(shouldFoldUserMessage(lines(USER_MESSAGE_FOLD_LINES))).toBe(false)
  expect(shouldFoldUserMessage(lines(USER_MESSAGE_FOLD_LINES + 1))).toBe(true)
  expect(shouldFoldUserMessage('x'.repeat(USER_MESSAGE_FOLD_CHARS))).toBe(false)
  expect(shouldFoldUserMessage('x'.repeat(USER_MESSAGE_FOLD_CHARS + 1))).toBe(
    true
  )
  expect(shouldFoldUserMessage('   \n\n')).toBe(false)
  expect(shouldFoldUserMessage(`\n\n${lines(12)}\n\n`)).toBe(false)
  expect(shouldFoldUserMessage(`Log:\n\`\`\`\n${lines(12)}\n\`\`\``)).toBe(true)
})
it('counts link labels not URLs and retains Thai source unchanged', () => {
  const url = `https://example.test/${'a'.repeat(2000)}`
  expect(
    shouldFoldUserMessage(`See [the file](${url}) and ![shot](<${url}>).`)
  ).toBe(false)
  expect(visibleUserMessageText(`[the file](${url})`)).toBe('the file')
  const thai = 'ข้อความไทย'.repeat(120)
  expect(shouldFoldUserMessage(thai)).toBe(true)
  expect(visibleUserMessageText(thai)).toBe(thai)
})
it('keeps stylesheet cap and full Markdown/copy/source-match owners (source evidence only)', () => {
  const css = readFileSync(
    new URL('../../components/chat-view.css', import.meta.url),
    'utf8'
  )
  expect(css).toContain(`--chat-fold-lines: ${USER_MESSAGE_FOLD_LINES};`)
  expect(css.replace(/\s+/g, '')).toContain(
    'calc(var(--chat-fold-lines)*var(--chat-fs-body)*var(--lh-prose))'
  )
  const view = readFileSync(
    new URL('../../components/chat-view.tsx', import.meta.url),
    'utf8'
  )
  expect(view).toContain('<Markdown>{text}</Markdown>')
  expect(view).toContain('<CopyButton text={text} label="Copy message" />')
  expect(view).toContain(
    '<ChatMatchSource text={chatSearchText(turn)} match={match} />'
  )
})
