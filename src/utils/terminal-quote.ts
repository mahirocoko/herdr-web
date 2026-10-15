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
// Only selections wholly contained by the viewer-owned text surface qualify.
export const ownedDisplayedExcerpt = (
  owner: Pick<Node, 'contains'> | null,
  selection: Pick<Selection, 'anchorNode' | 'focusNode' | 'toString'> | null
): string | null =>
  owner &&
  selection?.anchorNode &&
  selection.focusNode &&
  owner.contains(selection.anchorNode) &&
  owner.contains(selection.focusNode)
    ? quotedText(selection.toString())
    : null

export const formatReviewQuote = (
  path: string,
  scope: string,
  excerpt?: string | null
) => {
  const label = `${JSON.stringify(path)} — ${scope}`
  return excerpt
    ? formatTerminalQuote({
        label: `${label} (selected displayed excerpt)`,
        text: excerpt
      })!
    : label
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
