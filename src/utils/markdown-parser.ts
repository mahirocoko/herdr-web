// MIT License - Copyright (c) 2026 devswha
// Adapted from devswha/herdr-web-ui

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'math'; value: string }
  | { type: 'strong' | 'em' | 'del'; children: InlineNode[] }
  | { type: 'link'; href: string; children: InlineNode[] }
  | { type: 'file'; path: string; children: InlineNode[] }

export interface IListItem {
  content: InlineNode[]
  blocks?: MarkdownBlock[]
}

export interface IListBlock {
  type: 'list'
  ordered: boolean
  start?: number
  items: IListItem[]
}

export type MarkdownBlock =
  | { type: 'math'; value: string }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: InlineNode[] }
  | { type: 'paragraph'; lines: InlineNode[][] }
  | IListBlock
  | { type: 'blockquote'; blocks: MarkdownBlock[] }
  | { type: 'code'; language: string; value: string }
  | { type: 'table'; header: InlineNode[][]; rows: InlineNode[][][] }
  | { type: 'hr' }

export function fileUriPath(uri: string): string | null {
  if (!/^file:\/\/\//i.test(uri) || /[\u0000-\u001f\u007f]/.test(uri))
    return null
  try {
    const url = new URL(uri)
    if (url.host || url.search || url.hash) return null
    const path = decodeURIComponent(url.pathname)
    if (/[\u0000-\u001f\u007f]/.test(path) || /^[\\/]{2}/.test(path))
      return null
    return /^\/[A-Za-z]:[\\/]/.test(path) ? path.slice(1) : path
  } catch {
    return null
  }
}

export function safeMarkdownHref(href: string): string | null {
  const value = href.trim()
  return /^(?:https?:\/\/|mailto:)/i.test(value) ? value : null
}

export function webLikeHref(target: string): string | null {
  const value = target.trim()
  if (
    /^(?:localhost(?::\d+)?|\d{1,3}(?:\.\d{1,3}){3}:\d+|\d{1,3}(?:\.\d{1,3}){3}(?=\/))(?:\/\S*)?$/i.test(
      value
    )
  )
    return `http://${value}`
  const match =
    /^([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?::\d+)?(\/\S*)?$/i.exec(value)
  if (match === null) return null
  const [, host, path] = match
  return /^www\./i.test(host!) || path !== undefined ? `https://${value}` : null
}

export function markdownFileTarget(href: string): string | null {
  const value = href.trim()
  if (/^file:\/\/\//i.test(value)) return fileUriPath(value)
  if (value === '' || value.startsWith('#')) return null
  const withoutAnchor = value.replace(/#.*$/, '')
  const path = withoutAnchor.replace(/(?::\d+){1,2}$/, '')
  if (
    path === '' ||
    /^[a-z][a-z0-9+.-]*:/i.test(path) ||
    (path !== withoutAnchor && !/[./]/.test(path))
  )
    return null
  return path
}

export function trimUrl(url: string): string {
  let end = url.length
  let opened = 0
  let closed = 0
  for (let index = 0; index < end; index += 1) {
    if (url[index] === '(') opened += 1
    else if (url[index] === ')') closed += 1
  }
  for (;;) {
    const last = url[end - 1]
    if (last !== undefined && '.,:;!?\'"*_~'.includes(last)) {
      end -= 1
      continue
    }
    if (last === ')' && closed > opened) {
      end -= 1
      closed -= 1
      continue
    }
    break
  }
  return url.slice(0, end)
}

const MAX_INLINE_DEPTH = 16

export function* inlineMarks(source: string): Generator<RegExpExecArray> {
  const marker =
    /(`[^`\n]+`|\\\(.+?\\\)|\[[^\]\n]+\]\([^\s)]+\)|<https?:\/\/[^\s<>]+>|file:\/\/\/[!#-;=?-_a-~]+|https?:\/\/[!-;=?-~]+|(?<![\w.@/-])www\.[!-;=?-~]+|\*\*[^*\n]+\*\*|(?<![\p{L}\p{N}\p{M}_])__(?=\S)[^\n]*?\S__(?![\p{L}\p{N}\p{M}_])|~~[^~\n]+~~|(?<!\*)\*[^*\n]+\*(?!\*)|(?<![\p{L}\p{N}\p{M}_])_(?=\S)[^\n]*?\S_(?![\p{L}\p{N}\p{M}_]))/uy
  const emphasis =
    /(?<![\p{L}\p{N}\p{M}_])_(?=\S)[^\n]*?\S_(?![\p{L}\p{N}\p{M}_])/uy
  const opener = /[`[<*_~]|\\\(|file:\/\/\/|https?:\/\/|www\./g
  const next = (pattern: RegExp): ((from: number) => number) => {
    let found = -1
    return (from) => {
      if (found < from) {
        pattern.lastIndex = from
        found = pattern.exec(source)?.index ?? Infinity
      }
      return found
    }
  }
  const lineEnd = next(/\n/g)
  const mathBreak = next(/[\n\r\u2028\u2029]/g)
  const mathClose = next(/\\\)/g)
  const labelEnd = next(/[\]\n]/g)
  const targetEnd = next(/[\s)]/g)
  const emphasisClose = next(/(?<=\S)_(?![\p{L}\p{N}\p{M}_])/gu)
  const strongClose = next(/(?<=\S)__(?![\p{L}\p{N}\p{M}_])/gu)
  let from = 0
  for (;;) {
    opener.lastIndex = from
    const start = opener.exec(source)?.index
    if (start === undefined) return
    from = start + 1
    let pattern: RegExp | null = marker
    const char = source[start]
    if (char === '\\') {
      if (!(mathClose(start + 3) < mathBreak(start + 2))) pattern = null
    } else if (char === '[') {
      const label = labelEnd(start + 1)
      const target = label + 2
      if (!(
        label > start + 1 &&
        source[label] === ']' &&
        source[label + 1] === '('
      ))
        pattern = null
      else {
        const end = targetEnd(target)
        if (!(end > target && source[end] === ')')) pattern = null
      }
    } else if (char === '_') {
      const end = lineEnd(start + 1)
      if (!(source[start + 1] === '_' && strongClose(start + 3) < end))
        pattern = emphasisClose(start + 2) < end ? emphasis : null
    }
    if (pattern === null) continue
    pattern.lastIndex = start
    const match = pattern.exec(source)
    if (match === null) continue
    from = start + match[0].length
    yield match
  }
}

export function parseInline(
  source: string,
  links = true,
  depth = 0
): InlineNode[] {
  if (depth > MAX_INLINE_DEPTH)
    return source === '' ? [] : [{ type: 'text', value: source }]
  const nodes: InlineNode[] = []
  let offset = 0
  for (const match of inlineMarks(source)) {
    const index = match.index ?? 0
    if (index > offset)
      nodes.push({ type: 'text', value: source.slice(offset, index) })
    let token = match[0]
    if (token.startsWith('file:///')) {
      token = trimUrl(token)
      const path = fileUriPath(token)
      nodes.push(
        links && path !== null
          ? { type: 'file', path, children: [{ type: 'text', value: token }] }
          : { type: 'text', value: token }
      )
    } else if (token.startsWith('<')) {
      const url = token.slice(1, -1)
      nodes.push(
        links
          ? {
              type: 'link',
              href: url,
              children: [{ type: 'text', value: url }]
            }
          : { type: 'text', value: token }
      )
    } else if (/^(?:https?:|www\.)/i.test(token)) {
      token = trimUrl(token)
      const href = /^www\./i.test(token) ? `https://${token}` : token
      nodes.push(
        links
          ? {
              type: 'link',
              href: href,
              children: [{ type: 'text', value: token }]
            }
          : { type: 'text', value: token }
      )
    } else if (token.startsWith('`')) {
      nodes.push({ type: 'code', value: token.slice(1, -1) })
    } else if (token.startsWith('\\(')) {
      nodes.push({ type: 'math', value: token.slice(2, -2) })
    } else if (token.startsWith('[')) {
      const split = token.lastIndexOf('](')
      const label = token.slice(1, split)
      const target = token.slice(split + 2, -1)
      const href = safeMarkdownHref(target) ?? webLikeHref(target)
      const file = href === null ? markdownFileTarget(target) : null
      nodes.push(
        href !== null
          ? { type: 'link', href, children: parseInline(label, false, depth) }
          : file !== null
            ? {
                type: 'file',
                path: file,
                children: parseInline(label, false, depth)
              }
            : { type: 'text', value: label }
      )
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push({
        type: 'strong',
        children: parseInline(token.slice(2, -2), links, depth + 1)
      })
    } else if (token.startsWith('~~')) {
      nodes.push({
        type: 'del',
        children: parseInline(token.slice(2, -2), links, depth + 1)
      })
    } else {
      nodes.push({
        type: 'em',
        children: parseInline(token.slice(1, -1), links, depth + 1)
      })
    }
    offset = index + token.length
  }
  if (offset < source.length)
    nodes.push({ type: 'text', value: source.slice(offset) })
  return nodes
}

const listLine = /^(\s*)([-*]|\d+\.)\s+(.+)$/s

export function isTableSeparator(line: string): boolean {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|')) row = row.slice(0, -1)
  const columns = row.split('|')
  return (
    columns.length >= 2 &&
    columns.every((column) => /^:?-{3,}:?$/.test(column.trim()))
  )
}

function cells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function lineAt(lines: string[], index: number): string {
  return lines[index] ?? ''
}

function startsTable(lines: string[], index: number): boolean {
  return (
    lineAt(lines, index).includes('|') &&
    isTableSeparator(lineAt(lines, index + 1))
  )
}

function parseTable(
  lines: string[],
  start: number,
  within = 0
): { block: MarkdownBlock; next: number } {
  const header = cells(lineAt(lines, start)).map((cell) => parseInline(cell))
  let index = start + 2
  const rows: InlineNode[][][] = []
  const inItem = (line: string): boolean =>
    within === 0 ||
    ((/^\s*/.exec(line)?.[0].length ?? 0) >= within && !listLine.test(line))
  while (
    index < lines.length &&
    lineAt(lines, index).includes('|') &&
    lineAt(lines, index).trim() !== '' &&
    inItem(lineAt(lines, index))
  ) {
    rows.push(cells(lineAt(lines, index)).map((cell) => parseInline(cell)))
    index += 1
  }
  return { block: { type: 'table', header, rows }, next: index }
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? ''
  return (
    /^\s*\\\[/.test(line) ||
    /^\s*\$\$/.test(line) ||
    /^\s{0,3}```/.test(line) ||
    /^#{1,6}\s+/.test(line) ||
    /^\s*>/.test(line) ||
    /^(?:\s*[-*_]){3,}\s*$/.test(line) ||
    listLine.test(line) ||
    startsTable(lines, index)
  )
}

function parseList(
  lines: string[],
  start: number
): { block: IListBlock; next: number } {
  const first = listLine.exec(lineAt(lines, start))
  if (first === null)
    return {
      block: { type: 'list', ordered: false, items: [] },
      next: start + 1
    }
  const baseIndent = (first[1] ?? '').length
  const ordered = /\d/.test(first[2] ?? '')
  const number = ordered ? Number.parseInt(first[2] ?? '1', 10) : 1
  const block: IListBlock = {
    type: 'list',
    ordered,
    ...(ordered && number !== 1 ? { start: number } : {}),
    items: []
  }
  let index = start
  while (index < lines.length) {
    if (block.items.length > 0 && !listLine.test(lineAt(lines, index))) {
      let ahead = index
      while (ahead < lines.length && lineAt(lines, ahead).trim() === '')
        ahead += 1
      const line = lineAt(lines, ahead)
      const indent = /^\s*/.exec(line)?.[0].length ?? 0
      const sibling = listLine.exec(line)
      if (
        sibling !== null &&
        (sibling[1] ?? '').length === baseIndent &&
        /\d/.test(sibling[2] ?? '') === ordered
      ) {
        index = ahead
        continue
      }
      if (sibling !== null && (sibling[1] ?? '').length >= baseIndent + 2) {
        index = ahead
        continue
      }
      if (
        ahead < lines.length &&
        sibling === null &&
        indent >= baseIndent + 2 &&
        startsTable(lines, ahead)
      ) {
        const item = block.items.at(-1)!
        const table = parseTable(lines, ahead, baseIndent + 2)
        ;(item.blocks ??= []).push(table.block)
        index = table.next
        continue
      }
      if (
        ahead < lines.length &&
        sibling === null &&
        indent >= baseIndent + 2 &&
        !/^\s*```/.test(line)
      ) {
        const item = block.items.at(-1)!
        const last = item.blocks?.at(-1)
        if (last === undefined) {
          item.content.push({ type: 'text', value: ' ' })
          for (const node of parseInline(line.trim())) item.content.push(node)
        } else {
          if (startsBlock(lines, ahead)) break
          if (last.type === 'paragraph' && ahead === index)
            last.lines.push(parseInline(line.trim()))
          else
            item.blocks!.push({
              type: 'paragraph',
              lines: [parseInline(line.trim())]
            })
        }
        index = ahead + 1
        continue
      }
      break
    }
    const match = listLine.exec(lineAt(lines, index))
    if (match === null || (match[1] ?? '').length < baseIndent) break
    if ((match[1] ?? '').length >= baseIndent + 2) {
      const parent = block.items.at(-1)
      if (parent === undefined) break
      const nested = parseList(lines, index)
      ;(parent.blocks ??= []).push(nested.block)
      index = nested.next
      continue
    }
    if (
      (match[1] ?? '').length !== baseIndent ||
      /\d/.test(match[2] ?? '') !== ordered
    )
      break
    block.items.push({ content: parseInline(match[3] ?? '') })
    index += 1
  }
  return { block, next: index }
}

const MAX_MATH_DEPTH = 100

export function mathNestsTooDeep(value: string): boolean {
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '\\') index += 1
    else if (char === '{') {
      depth += 1
      if (depth > MAX_MATH_DEPTH) return true
    } else if (char === '}' && depth > 0) depth -= 1
  }
  return false
}

export const FOLD_CODE_AFTER_LINES = 30
export const FOLDED_CODE_LINES = 20

export function foldCode(
  value: string
): { head: string; lines: number } | null {
  const lines = value.split('\n')
  if (lines.length <= FOLD_CODE_AFTER_LINES) return null
  return {
    head: lines.slice(0, FOLDED_CODE_LINES).join('\n'),
    lines: lines.length
  }
}

const MAX_QUOTE_DEPTH = 32

export function parseMarkdown(source: string, depth = 0): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0
  let unclosedMath = 0
  while (index < lines.length) {
    const line = lineAt(lines, index)
    if (line.trim() === '') {
      index += 1
      continue
    }

    const fence = /^( {0,3})```\s*([^\s`]*)/.exec(line)
    if (fence !== null) {
      const indent = fence[1] ?? ''
      const body: string[] = []
      index += 1
      while (
        index < lines.length &&
        !/^\s{0,3}```\s*$/.test(lineAt(lines, index))
      ) {
        const bodyLine = lineAt(lines, index++)
        body.push(
          bodyLine.startsWith(indent)
            ? bodyLine.slice(indent.length)
            : bodyLine.trimStart()
        )
      }
      if (index < lines.length) index += 1
      blocks.push({
        type: 'code',
        language: fence[2] ?? '',
        value: body.join('\n')
      })
      continue
    }

    const dollarDisplay = /^\s*\$\$(.*)$/.exec(line)
    const display =
      index < unclosedMath
        ? null
        : (dollarDisplay ?? /^\s*\\\[(.*)$/.exec(line))
    if (display !== null) {
      const body: string[] = []
      let next = index
      let part = display[1] ?? ''
      let complete = false
      while (true) {
        const close = part.indexOf(dollarDisplay ? '$$' : '\\]')
        if (close !== -1 && part.slice(close + 2).trim() === '') {
          body.push(part.slice(0, close))
          blocks.push({ type: 'math', value: body.join('\n').trim() })
          index = next + 1
          complete = true
          break
        }
        body.push(part)
        next += 1
        if (next >= lines.length || /^\s{0,3}```/.test(lineAt(lines, next)))
          break
        part = lineAt(lines, next)
      }
      if (complete) continue
      unclosedMath = next
    }

    const heading = /^(#{1,6})\s+(.+)$/s.exec(line)
    if (heading !== null) {
      blocks.push({
        type: 'heading',
        level: (heading[1] ?? '#').length as 1 | 2 | 3 | 4 | 5 | 6,
        content: parseInline(heading[2] ?? '')
      })
      index += 1
      continue
    }

    if (/^(?:\s*[-*_]){3,}\s*$/.test(line)) {
      blocks.push({ type: 'hr' })
      index += 1
      continue
    }

    if (/^\s*>/.test(line)) {
      const quoted: string[] = []
      while (index < lines.length && /^\s*>/.test(lineAt(lines, index)))
        quoted.push(lineAt(lines, index++).replace(/^\s*>\s?/, ''))
      blocks.push({
        type: 'blockquote',
        blocks:
          depth < MAX_QUOTE_DEPTH
            ? parseMarkdown(quoted.join('\n'), depth + 1)
            : [
                {
                  type: 'paragraph',
                  lines: quoted.map((quotedLine) => parseInline(quotedLine))
                }
              ]
      })
      continue
    }

    if (listLine.test(line)) {
      const parsed = parseList(lines, index)
      blocks.push(parsed.block)
      index = parsed.next
      continue
    }

    if (startsTable(lines, index)) {
      const table = parseTable(lines, index)
      blocks.push(table.block)
      index = table.next
      continue
    }

    const paragraph: InlineNode[][] = []
    while (
      index < lines.length &&
      lineAt(lines, index).trim() !== '' &&
      (paragraph.length === 0 || !startsBlock(lines, index))
    ) {
      paragraph.push(parseInline(lineAt(lines, index)))
      index += 1
    }
    blocks.push({ type: 'paragraph', lines: paragraph })
  }
  return blocks
}
