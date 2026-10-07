export interface IBufferCellPosition {
  x: number // 1-based column
  y: number // 1-based line number
}

export interface IBufferRange {
  start: IBufferCellPosition
  end: IBufferCellPosition
}

export interface IImageLinkCandidate {
  raw: string
  cleanedPath: string
  range: IBufferRange
}

export interface ILink {
  range: IBufferRange
  text: string
  activate: (event: MouseEvent, text: string) => void
  hover?: (event: MouseEvent, text: string) => void
  leave?: (event: MouseEvent, text: string) => void
  dispose?: () => void
}

export interface ILinkProvider {
  provideLinks: (
    bufferLineNumber: number,
    callback: (links: ILink[] | undefined) => void
  ) => void
}

export interface IBufferCellLike {
  getChars: () => string
  getWidth: () => number
}

export interface IBufferLineLike {
  length: number
  isWrapped?: boolean
  translateToString: (
    trimRight?: boolean,
    startCol?: number,
    endCol?: number
  ) => string
  getCell?: (x: number) => IBufferCellLike | undefined
}

export const IMAGE_EXTENSIONS_REGEX = /\.(png|jpe?g|webp)$/i

export const isImageExtension = (filename: string): boolean => {
  return IMAGE_EXTENSIONS_REGEX.test(filename.trim())
}

export const isImageUrl = (candidate: string): boolean => {
  return /^(https?|file|ftp):\/\//i.test(candidate.trim())
}

export const cleanCandidatePath = (raw: string): string => {
  let cleaned = raw.trim()
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim()
  }
  // Strip trailing punctuation attached to path
  cleaned = cleaned.replace(/[,;:)>\]]+$/, '')
  return cleaned
}

export interface ICharCoord {
  lineNumber: number
  startX: number
  endX: number
}

export interface IProcessedLine {
  lineNumber: number
  text: string
  charCoords: ICharCoord[]
  isWrapped: boolean
  cols: number
  toolImageRow?: number
  continuationStart?: number
}

/**
 * Maps each character in the line back to actual xterm 1-based cell coordinates.
 * Accounts for CJK double-width (width 2) and combining marks (e.g. Thai vowels/tone marks with width 0).
 * Falls back to 1:1 ASCII coordinates when getCell is not available on unit fixture mocks.
 */
export const processBufferLine = (
  line: IBufferLineLike,
  lineNumber: number
): IProcessedLine => {
  const lineCols = line.length || 0
  const isWrapped = Boolean(line.isWrapped)

  if (typeof line.getCell === 'function') {
    let text = ''
    const charCoords: ICharCoord[] = []

    for (let x = 0; x < lineCols; x++) {
      const cell = line.getCell(x)
      if (!cell) continue

      const chars = cell.getChars()
      const width = cell.getWidth()

      // width === 0 and chars === '' is continuation cell for wide character
      if (width === 0 && chars === '') {
        continue
      }

      if (chars.length > 0) {
        const startX = x + 1
        const endX = width > 1 ? x + width : x + 1
        for (let i = 0; i < chars.length; i++) {
          text += chars[i]
          charCoords.push({ lineNumber, startX, endX })
        }
      } else {
        text += ' '
        charCoords.push({ lineNumber, startX: x + 1, endX: x + 1 })
      }
    }

    return {
      lineNumber,
      text,
      charCoords,
      isWrapped,
      cols: lineCols
    }
  }

  // Fallback for simple unit test mocks without getCell
  const text = line.translateToString(false)
  const charCoords: ICharCoord[] = []
  for (let i = 0; i < text.length; i++) {
    charCoords.push({
      lineNumber,
      startX: i + 1,
      endX: i + 1
    })
  }

  return {
    lineNumber,
    text,
    charCoords,
    isWrapped,
    cols: lineCols || text.length
  }
}

const isPathChar = (ch: string): boolean => {
  return /[a-zA-Z0-9_\-./~@\u0E00-\u0E7F]/.test(ch)
}

// Formatting indentation is removable only inside a recognized View Image argument.
// Other indented text, fresh rooted paths and following tool records stay separate.
const annotateToolImageRows = (
  index: number,
  getLine: (index: number) => IProcessedLine | undefined
) => {
  for (
    let start = Math.max(0, index - MAX_WINDOW_ROWS + 1);
    start <= index;
    start++
  ) {
    const header = getLine(start)
    if (!header) continue
    const match =
      /^[ \t]*(?:[•●·*]\s*)?View Image[ \t]+((?:~\/|\/|\.{1,2}\/|\.?[a-zA-Z0-9_-]+\/)\S+)$/.exec(
        header.text.trimEnd()
      )
    if (!match || isImageExtension(match[1])) continue
    const argumentStart = match[0].length - match[1].length
    const indent = (header.charCoords[argumentStart]?.startX ?? 1) - 1
    let argument = match[1]
    for (let next = start + 1; next <= index; next++) {
      const line = getLine(next)
      if (!line || isImageExtension(argument)) break
      const leading = line.text.length - line.text.trimStart().length
      const tail = line.text.slice(leading).trimEnd()
      const previous = getLine(next - 1)
      const aligned =
        leading > 0 && (line.charCoords[leading]?.startX ?? 1) - 1 === indent
      const nativeWrap =
        leading === 0 &&
        previous !== undefined &&
        canLinesConnect(previous, line)
      if (
        (!aligned && !nativeWrap) ||
        !tail ||
        !Array.from(tail).every(isPathChar) ||
        /^(?:~\/|\/|\.{1,2}\/)/.test(tail)
      )
        break
      header.toolImageRow = header.lineNumber
      line.toolImageRow = header.lineNumber
      line.continuationStart = leading
      argument += tail
    }
  }
}

/**
 * Checks if line A connects/wraps into line B (line A immediately precedes line B).
 * Defends against inventing an assistant parser or concatenating unrelated paragraphs.
 */
export const canLinesConnect = (
  a: IProcessedLine,
  b: IProcessedLine
): boolean => {
  if (a.toolImageRow !== undefined && a.toolImageRow === b.toolImageRow) {
    return true
  }
  if (b.isWrapped) return true

  const aTrimmed = a.text.trimEnd()
  const bTrimmed = b.text.trimStart()
  if (aTrimmed.length === 0 || bTrimmed.length === 0) return false

  // 1. Quoted string continuation across rows
  const singleQuotes = (a.text.match(/(?<!\\)'/g) || []).length
  const doubleQuotes = (a.text.match(/(?<!\\)"/g) || []).length
  if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0) {
    return true
  }

  // 2. Unquoted path continuation
  // Line A ends with path character (and reached margin or ended in slash)
  // Line B begins at column 1 with path character (no leading space)
  const aLastChar = aTrimmed[aTrimmed.length - 1]
  const bFirstChar = b.text[0]

  if (isPathChar(aLastChar) && isPathChar(bFirstChar)) {
    if (
      aTrimmed.length >= a.cols ||
      aLastChar === '/' ||
      // Native word wrapping can leave padding after a path's hyphen boundary.
      // Require path anatomy rather than joining arbitrary hyphenated prose.
      (aLastChar === '-' && aTrimmed.includes('/')) ||
      aTrimmed.length === a.text.length
    ) {
      return true
    }
  }

  return false
}

export const MAX_WINDOW_ROWS = 12
export const MAX_WINDOW_CHARS = 4096

/**
 * Finds all candidate image paths across a bounded window of physical lines.
 */
export const findImageCandidatesInWindow = (
  lines: IProcessedLine[],
  activeLineNumber: number
): IImageLinkCandidate[] => {
  if (lines.length === 0) return []

  // Check if lines are within the bounded window
  const totalChars = lines.reduce((acc, l) => acc + l.text.length, 0)
  if (lines.length > MAX_WINDOW_ROWS || totalChars > MAX_WINDOW_CHARS) {
    return []
  }

  // Build unified text and coordinate map for the contiguous block
  let blockText = ''
  const blockCoords: ICharCoord[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // If line connects to next line via unquoted wrap, trim trailing space
    const textToAdd =
      i < lines.length - 1 && canLinesConnect(line, lines[i + 1])
        ? line.text.trimEnd()
        : line.text

    for (let j = line.continuationStart ?? 0; j < textToAdd.length; j++) {
      blockText += textToAdd[j]
      blockCoords.push(line.charCoords[j])
    }
  }

  const candidates: IImageLinkCandidate[] = []

  // 1. Quoted paths (preserves spaces across rows and Thai unicode)
  const quotedRegex = /(["'])(~?\/?[^"'\r\n\0]+\.(?:png|jpe?g|webp))\1/gi
  let match: RegExpExecArray | null

  while ((match = quotedRegex.exec(blockText)) !== null) {
    const raw = match[0]
    const inner = match[2]
    if (isImageUrl(inner)) continue

    const cleaned = cleanCandidatePath(inner)
    if (isImageExtension(cleaned)) {
      const startIndex = match.index
      const endIndex = match.index + raw.length - 1
      if (startIndex < blockCoords.length && endIndex < blockCoords.length) {
        const start = {
          x: blockCoords[startIndex].startX,
          y: blockCoords[startIndex].lineNumber
        }
        const end = {
          x: blockCoords[endIndex].endX,
          y: blockCoords[endIndex].lineNumber
        }
        candidates.push({
          raw,
          cleanedPath: cleaned,
          range: { start, end }
        })
      }
    }
  }

  // 2. Unquoted paths
  const unquotedRegex =
    /(?:^|[\s=:([<])(~?\/?[a-zA-Z0-9_\-./~@\u0E00-\u0E7F]+\.(?:png|jpe?g|webp))(?=$|[\s,;:)\]}>'"])/gi

  while ((match = unquotedRegex.exec(blockText)) !== null) {
    const fullMatch = match[0]
    const pathGroup = match[1]
    if (
      isImageUrl(pathGroup) ||
      pathGroup.startsWith('//') ||
      pathGroup.includes('://')
    ) {
      continue
    }

    const offsetInMatch = fullMatch.indexOf(pathGroup)
    const precedingText = blockText.slice(0, match.index + offsetInMatch)
    if (/(?:https?|file|ftp):(?:\/\/)?$/i.test(precedingText.trimEnd())) {
      continue
    }

    const cleaned = cleanCandidatePath(pathGroup)
    if (isImageExtension(cleaned)) {
      const startIndex = match.index + offsetInMatch
      const endIndex = startIndex + pathGroup.length - 1

      if (startIndex < blockCoords.length && endIndex < blockCoords.length) {
        const start = {
          x: blockCoords[startIndex].startX,
          y: blockCoords[startIndex].lineNumber
        }
        const end = {
          x: blockCoords[endIndex].endX,
          y: blockCoords[endIndex].lineNumber
        }

        // Avoid duplicate hit area with quoted match
        const alreadyCovered = candidates.some(
          (r) =>
            r.range.start.y === start.y &&
            r.range.end.y === end.y &&
            start.x >= r.range.start.x &&
            end.x <= r.range.end.x
        )

        if (!alreadyCovered) {
          candidates.push({
            raw: pathGroup,
            cleanedPath: cleaned,
            range: { start, end }
          })
        }
      }
    }
  }

  // Filter candidates that intersect activeLineNumber
  return candidates.filter(
    (c) =>
      c.range.start.y <= activeLineNumber && activeLineNumber <= c.range.end.y
  )
}

export interface ITerminalImageLinkProviderOptions {
  onActivate: (path: string, event: MouseEvent) => void
  isControlMode: () => boolean
  getBufferLine: (lineIndex: number) => IBufferLineLike | undefined
  maxLines?: number
}

/**
 * Creates an xterm-compatible ILinkProvider for terminal image previews.
 */
export const createTerminalImageLinkProvider = (
  options: ITerminalImageLinkProviderOptions
): ILinkProvider => {
  return {
    provideLinks(
      bufferLineNumber: number,
      callback: (links: ILink[] | undefined) => void
    ): void {
      if (options.isControlMode()) {
        callback(undefined)
        return
      }

      const lineIndex = bufferLineNumber - 1
      const processed = new Map<number, IProcessedLine>()
      const getRawLine = (index: number) => {
        if (processed.has(index)) return processed.get(index)
        const bufferLine = options.getBufferLine(index)
        if (!bufferLine) return undefined
        const line = processBufferLine(bufferLine, index + 1)
        processed.set(index, line)
        return line
      }
      const getLine = (index: number) => {
        annotateToolImageRows(index, getRawLine)
        return getRawLine(index)
      }
      const activeProcessed = getLine(lineIndex)
      if (!activeProcessed) {
        callback(undefined)
        return
      }

      // Collect connected rows within the same bounded window, including tool indentation.
      const backwardLines: IProcessedLine[] = []
      let curr = activeProcessed
      let currIdx = lineIndex
      let cumulativeChars = activeProcessed.text.length

      while (
        backwardLines.length < MAX_WINDOW_ROWS - 1 &&
        currIdx > 0 &&
        cumulativeChars < MAX_WINDOW_CHARS
      ) {
        const prevProcessed = getLine(currIdx - 1)
        if (!prevProcessed) break
        if (!canLinesConnect(prevProcessed, curr)) break

        backwardLines.unshift(prevProcessed)
        cumulativeChars += prevProcessed.text.length
        curr = prevProcessed
        currIdx--
      }

      // Collect connected block forwards (up to 6 lines, <= 12 total, <= 4096 chars)
      const forwardLines: IProcessedLine[] = []
      curr = activeProcessed
      currIdx = lineIndex

      while (
        backwardLines.length + 1 + forwardLines.length < MAX_WINDOW_ROWS &&
        cumulativeChars < MAX_WINDOW_CHARS
      ) {
        const nextProcessed = getLine(currIdx + 1)
        if (!nextProcessed) break
        if (!canLinesConnect(curr, nextProcessed)) break

        forwardLines.push(nextProcessed)
        cumulativeChars += nextProcessed.text.length
        curr = nextProcessed
        currIdx++
      }

      const connectedBlock: IProcessedLine[] = [
        ...backwardLines,
        activeProcessed,
        ...forwardLines
      ]

      const candidates = findImageCandidatesInWindow(
        connectedBlock,
        bufferLineNumber
      )

      if (candidates.length === 0) {
        callback(undefined)
        return
      }

      const links: ILink[] = candidates.map((cand) => ({
        range: cand.range,
        text: cand.cleanedPath,
        activate(event: MouseEvent, text: string) {
          // Guard: ignore non-primary clicks
          if (event.button !== 0) return
          // Guard: normal drag or selection copy does not trigger preview
          if (typeof window !== 'undefined') {
            const sel = window.getSelection()?.toString()
            if (sel && sel.trim().length > 0) return
          }
          options.onActivate(text, event)
        }
      }))

      callback(links)
    }
  }
}
