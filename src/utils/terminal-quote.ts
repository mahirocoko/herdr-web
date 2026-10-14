// Adapted from devswha/herdr-web-ui terminalQuote.ts (MIT, copyright 2026 devswha).
import { MAX_DRAFT_BYTES, utf8Bytes } from './composer-draft.ts'
export const quotedText = (text: string): string | null => {
  const normalized = text.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
  return normalized.trim() === '' ? null : normalized
}
export const formatTerminalQuote = (quote: {
  label: string
  text: string
}): string | null => {
  const text = quotedText(quote.text)
  if (text === null) return null
  const label = quote.label.replace(/\s+/g, ' ').trim() || 'terminal'
  let fence = '```'
  for (const run of text.match(/`{3,}/g) ?? [])
    if (run.length >= fence.length) fence = '`'.repeat(run.length + 1)
  // xterm selection coordinates are viewport-local, not native history line numbers.
  return `${label}:\n${fence}\n${text}\n${fence}`
}
export const appendQuote = (
  draft: string,
  block: string,
  max = MAX_DRAFT_BYTES
): string | null => {
  const gap =
    draft === ''
      ? ''
      : draft.endsWith('\n\n')
        ? ''
        : draft.endsWith('\n')
          ? '\n'
          : '\n\n'
  const next = `${draft}${gap}${block}\n`
  return utf8Bytes(next) > max ? null : next
}
export const quoteMatchesTarget = (
  capturedScope: string | null,
  capturedGeneration: number,
  scope: string | null,
  generation: number
) =>
  capturedScope !== null &&
  capturedScope === scope &&
  capturedGeneration === generation
