// Adapted upstream terminalQuote.test.ts (MIT, copyright 2026 devswha).
import { expect, test } from 'bun:test'
import {
  appendQuote,
  formatTerminalQuote,
  quoteMatchesTarget,
  quotedText
} from '../terminal-quote.ts'
test('empty selection quotes nothing', () => {
  expect(quotedText('\n  \r\n')).toBeNull()
  expect(formatTerminalQuote({ label: 'a', text: '\n\n' })).toBeNull()
})
test('normalized CRLF heading has no fabricated native line numbers', () => {
  expect(
    formatTerminalQuote({ label: ' my  pane ', text: '\n\nerr\r\nat x\n' })
  ).toBe('my pane:\n```\nerr\nat x\n```')
})
test('backticks inside selection cannot close the quote', () => {
  expect(formatTerminalQuote({ label: 'p', text: 'a\n```\nb' })).toBe(
    'p:\n````\na\n```\nb\n````'
  )
})
test('appends without overwrite with UTF-8 boundary', () => {
  for (const draft of ['why?', 'why?\n', 'why?\n\n'])
    expect(appendQuote(draft, 'Q', 100)).toBe('why?\n\nQ\n')
  expect(appendQuote('', 'ก', 4)).toBe('ก\n')
  expect(appendQuote('', 'ก', 3)).toBeNull()
})
test('stale target and A to B to A generation cannot quote', () => {
  expect(quoteMatchesTarget('a', 0, 'a', 0)).toBe(true)
  expect(quoteMatchesTarget('a', 0, 'b', 1)).toBe(false)
  expect(quoteMatchesTarget('a', 0, 'a', 2)).toBe(false)
  expect(quoteMatchesTarget(null, 0, null, 0)).toBe(false)
})
