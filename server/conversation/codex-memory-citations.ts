// MIT License - Copyright (c) 2026 devswha
// Pure helper adapted verbatim (formatting only) from codex.ts at 5979118.
export function withoutMemoryCitations(text: string): string {
  const opening = '<oai-mem-citation>'
  const closing = '</oai-mem-citation>'
  if (!text.includes(opening)) return text.trimEnd()
  type Line = {
    kind: 'line'
    index: number
    quoteDepth: number
    indent: number
    listIndent?: number
    blank: boolean
  }
  type Token =
    | Line
    | { kind: 'fence'; index: number; marker: string; info: string; line: Line }
    | { kind: 'ticks'; index: number; size: number }
    | { kind: 'citation'; index: number }
  const tokens: Token[] = []
  const quote = /[ \t]*>[ \t]?/y
  for (const match of text.matchAll(/([^\r\n]*)(?:\r\n?|\n|$)/g)) {
    const source = match[1]!
    let offset = 0
    let quoteDepth = 0
    quote.lastIndex = 0
    while (quote.exec(source)) {
      offset = quote.lastIndex
      quoteDepth++
    }
    const indent = /^[ \t]*/.exec(source.slice(offset))![0].length
    const content = source.slice(offset + indent)
    const list = /^(?:[-+*]|\d+[.)])[ \t]+/.exec(content)
    const line: Line = {
      kind: 'line',
      index: match.index!,
      quoteDepth,
      indent,
      ...(list ? { listIndent: indent + list[0].length } : {}),
      blank: content.trim() === ''
    }
    tokens.push(line)
    const body = content.slice(list?.[0].length ?? 0)
    const marker = /^(`{3,}|~{3,})/.exec(body)?.[0]
    const info = marker ? body.slice(marker.length) : ''
    if (marker && (marker[0] !== '`' || !info.includes('`')))
      tokens.push({
        kind: 'fence',
        index: match.index! + offset + indent + (list?.[0].length ?? 0),
        marker,
        info,
        line
      })
    for (const token of source.matchAll(/`+|<oai-mem-citation>/g)) {
      tokens.push(
        token[0] === opening
          ? { kind: 'citation', index: match.index! + token.index! }
          : {
              kind: 'ticks',
              index: match.index! + token.index!,
              size: token[0].length
            }
      )
    }
  }
  const closes = new Map<number, number>()
  const pairs: number[] = []
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]!
    if (token.kind !== 'ticks') {
      if (token.kind === 'line') closes.clear()
      continue
    }
    let backslashes = 0
    for (let at = token.index - 1; at >= 0 && text[at] === '\\'; at--)
      backslashes++
    const length = token.size - (backslashes % 2)
    pairs[i] = length > 0 ? (closes.get(length) ?? -1) : -1
    closes.set(token.size, i)
  }
  const parts: string[] = []
  const listIndents: number[] = []
  let quoteDepth = 0
  let kept = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (token.kind === 'line') {
      if (token.quoteDepth !== quoteDepth) {
        listIndents.length = 0
        quoteDepth = token.quoteDepth
      }
      if (token.blank) continue
      while (listIndents.length > 0 && listIndents.at(-1)! > token.indent)
        listIndents.pop()
      if (token.listIndent !== undefined) listIndents.push(token.listIndent)
      continue
    }
    if (token.kind === 'fence') {
      const within = token.line.listIndent ?? listIndents.at(-1) ?? 0
      const indent =
        token.line.listIndent === undefined ? token.line.indent - within : 0
      if (indent < 0 || indent > 3) continue
      for (i++; i < tokens.length; i++) {
        const end = tokens[i]!
        if (
          end.kind === 'line' &&
          (end.quoteDepth < token.line.quoteDepth ||
            (within > 0 &&
              end.quoteDepth === token.line.quoteDepth &&
              !end.blank &&
              end.indent < within))
        ) {
          i--
          break
        }
        if (
          end.kind === 'fence' &&
          end.line.quoteDepth === token.line.quoteDepth &&
          end.marker[0] === token.marker[0] &&
          end.marker.length >= token.marker.length &&
          /^[ \t]*$/.test(end.info)
        ) {
          while (i + 1 < tokens.length && tokens[i + 1]!.kind !== 'line') i++
          break
        }
      }
      continue
    }
    const pair = pairs[i]
    if (pair !== undefined && pair >= 0) {
      i = pair
      continue
    }
    if (token.kind !== 'citation') continue
    parts.push(text.slice(kept, token.index))
    const close = text.indexOf(closing, token.index + opening.length)
    kept = close === -1 ? text.length : close + closing.length
    while (i + 1 < tokens.length && tokens[i + 1]!.index < kept) i++
  }
  parts.push(text.slice(kept))
  return parts.join('').trimEnd()
}
