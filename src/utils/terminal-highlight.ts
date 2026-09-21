export type TerminalLineType =
  | 'divider'
  | 'statusline'
  | 'prompt'
  | 'error'
  | 'warning'
  | 'success'
  | 'thinking'
  | 'tool'
  | 'plain'

export type TerminalTokenType =
  | 'glyph'
  | 'tool-verb'
  | 'tree'
  | 'url'
  | 'path'
  | 'id'

export interface ITerminalSegment {
  text: string
  tokenType?: TerminalTokenType
}

export interface ITerminalLine {
  text: string
  lineType: TerminalLineType
  segments: ITerminalSegment[]
  newline: string
}

// Divider regex: 8 or more identical divider characters
const DIVIDER_REGEX = /^[\t ]*([─━═=_\-*~―—])\1{7,}[\t ]*$/

// Statusline detection
const isStatusline = (line: string): boolean => {
  if (
    line.includes('📁') &&
    (line.includes('🌿') || line.includes(' · ') || line.includes('💬'))
  ) {
    return true
  }
  if (line.includes('· ctx ') || line.includes('· ctx:')) {
    return true
  }
  if (/\[(?:GPT|Claude|Gemini|O\d|Codestral|DeepSeek)[^\]]*\]/i.test(line)) {
    return true
  }
  return false
}

// Prompt regex: anchored markers
const PROMPT_REGEX = /^(?:[\t ]*)(?:[›❯➜]\s|\$\s+|>[ \t]+|echo DIRECT_CLI_)/

const ERROR_GLYPH_REGEX = /^[\t ]*[❌✖✗]\s*/
const ERROR_BRACKET_REGEX = /^[\t ]*\[(?:FAIL|FAILED|ERROR|FATAL|ERR)\]/i
const ERROR_PREFIX_REGEX = /^[\t ]*(?:error|fatal|err!)(?::|\s[-—]\s|\s*$)/i
const ERROR_TEST_FAIL_REGEX = /^[\t ]*FAIL(?:ED)?(?::|\s)/i
const ERROR_JEST_BULLET_REGEX = /^[\t ]*●\s+.*\b(?:fail(?:ed|ure)?|error)\b/i
const ERROR_CLASS_REGEX = /^[\t ]*(?:[A-Z][a-zA-Z]*(?:Error|Exception)|ParseError|SyntaxError|TypeError|ReferenceError):/
const ERROR_EXIT_CODE_REGEX = /\b(?:exit code [1-9]\d*|exited with code [1-9]\d*|command failed with exit code)\b/i
const ERROR_TREE_FAIL_REGEX = /^[\t ]*[└├│┌⎿]\s*(?:Fail(?:ed|ure)?|Error)\b/i

const isErrorLine = (line: string): boolean => {
  return (
    ERROR_GLYPH_REGEX.test(line) ||
    ERROR_BRACKET_REGEX.test(line) ||
    ERROR_PREFIX_REGEX.test(line) ||
    ERROR_TEST_FAIL_REGEX.test(line) ||
    ERROR_JEST_BULLET_REGEX.test(line) ||
    ERROR_CLASS_REGEX.test(line) ||
    ERROR_EXIT_CODE_REGEX.test(line) ||
    ERROR_TREE_FAIL_REGEX.test(line)
  )
}

// Warning signals
const WARNING_GLYPH_REGEX = /^[\t ]*⚠️\s*/
const WARNING_BRACKET_REGEX = /^[\t ]*\[(?:WARN|WARNING)\]/i
const WARNING_PREFIX_REGEX = /^[\t ]*(?:warn(?:ing)?|deprecated|attention|tip):/i
const WARNING_BULLET_REGEX = /^[\t ]*[•*●▸-]\s*(?:Blocked|Warning|Warn|Attention|Deprecated):/i
const WARNING_BLOCKED_REGEX = /^[\t ]*Blocked:\s+/i
const WARNING_TREE_INTERRUPTED_REGEX = /^[\t ]*[└├│┌⎿]\s*Interrupted\b/i

const isWarningLine = (line: string): boolean => {
  return (
    WARNING_GLYPH_REGEX.test(line) ||
    WARNING_BRACKET_REGEX.test(line) ||
    WARNING_PREFIX_REGEX.test(line) ||
    WARNING_BULLET_REGEX.test(line) ||
    WARNING_BLOCKED_REGEX.test(line) ||
    WARNING_TREE_INTERRUPTED_REGEX.test(line)
  )
}

// Success signals
const SUCCESS_GLYPH_REGEX = /^[\t ]*[✓✔]\s*/
const SUCCESS_BRACKET_REGEX = /^[\t ]*\[(?:PASS|PASSED|SUCCESS|OK)\]/i
const SUCCESS_TEST_PASS_REGEX = /^[\t ]*PASS(?::|\s)/
const SUCCESS_BULLET_REGEX = /^[\t ]*[•*●▸-]\s*(?:Success|Done|Completed):/i
const SUCCESS_PHRASE_REGEX = /^[\t ]*(?:Build succeeded|Tests? passed|All tests passed|stream ended)[\s.!]*$/i
const SUCCESS_PASSED_COUNT_REGEX = /\b\d+\s+passed\b/i

const isSuccessLine = (line: string): boolean => {
  return (
    SUCCESS_GLYPH_REGEX.test(line) ||
    SUCCESS_BRACKET_REGEX.test(line) ||
    SUCCESS_TEST_PASS_REGEX.test(line) ||
    SUCCESS_BULLET_REGEX.test(line) ||
    SUCCESS_PHRASE_REGEX.test(line) ||
    SUCCESS_PASSED_COUNT_REGEX.test(line)
  )
}

// Thinking signals
const THINKING_GLYPH_REGEX = /^[\t ]*[✻✦]\s*/
const THINKING_SPINNER_REGEX = /^[\t ]*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣷⣯⣟⡿⢿⣻⣽⣾](?:\s+|$)/
const THINKING_BULLET_KEYWORD_REGEX =
  /^[\t ]*[•*●▸]\s+(?:Thought|Thinking|Learned|Assessed|Strategized|Orchestrated|Computed|Reflecting|Reasoning)\b/i
const THINKING_INDENTED_REGEX =
  /^[ ]{2,4}(?:Planning|Identifying|Listing|Evaluating|Analyzing|Considering|Assessing)\b/

const isThinkingLine = (line: string): boolean => {
  return (
    THINKING_GLYPH_REGEX.test(line) ||
    THINKING_SPINNER_REGEX.test(line) ||
    THINKING_BULLET_KEYWORD_REGEX.test(line) ||
    THINKING_INDENTED_REGEX.test(line)
  )
}

// Tool signals
const TOOL_BULLET_VERB_REGEX =
  /^[\t ]*[•*●▸]\s+(?:Run|View Image|View|Read|Write|Edit|Search|List|Monitor|Planning|Skill|Execute|Call|Send|Fetch|Delegate|Propose)\b/i
const TOOL_GENERIC_REGEX = /^[\t ]*●\s+\S+/
const TOOL_TREE_REGEX = /^[\t ]*[└├│┌⎿]/
const TOOL_TREE_INDENT_REGEX = /^[ ]{2,}(?:L\s+|\|\s+)/

const isToolLine = (line: string): boolean => {
  return (
    TOOL_BULLET_VERB_REGEX.test(line) ||
    TOOL_GENERIC_REGEX.test(line) ||
    TOOL_TREE_REGEX.test(line) ||
    TOOL_TREE_INDENT_REGEX.test(line)
  )
}

// Classify line according to strict first-match precedence
export const classifyTerminalLine = (line: string): TerminalLineType => {
  if (DIVIDER_REGEX.test(line)) return 'divider'
  if (isStatusline(line)) return 'statusline'
  if (PROMPT_REGEX.test(line)) return 'prompt'
  if (isErrorLine(line)) return 'error'
  if (isWarningLine(line)) return 'warning'
  if (isSuccessLine(line)) return 'success'
  if (isThinkingLine(line)) return 'thinking'
  if (isToolLine(line)) return 'tool'
  return 'plain'
}

interface IMatchedToken {
  start: number
  end: number
  tokenType: TerminalTokenType
}

// Structural anchor patterns
const URL_REGEX = /https?:\/\/[^\s<>'"()]+/g
const PATH_ABSOLUTE_REGEX =
  /(?:\/(?:Users|tmp|var|etc|opt|home|root|private|app)\/[^\s<>'"():,;]+(?::\d+(?::\d+)?)?)/g
const PATH_RELATIVE_REGEX =
  /(?:(?:\.\.|\.|src|server|docs|scripts|tests?|public|node_modules)\/[^\s<>'"():,;]+(?::\d+(?::\d+)?)?)/g
const PATH_EXT_REGEX =
  /(?:\b[a-zA-Z0-9_.-]+\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:ts|tsx|js|jsx|css|json|md|html|yml|yaml|sh|rs|go|py|toml)\b(?::\d+(?::\d+)?)?)/g

const ID_PANE_REGEX = /\b[a-zA-Z0-9_-]+:p\d+\b/g
const ID_TASK_REGEX = /\b(?:task|job|conv|herdr)-[a-zA-Z0-9_-]+\b/g
const ID_UUID_REGEX = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g

// Trailing punctuation strip for URL and Path
const TRAILING_PUNCT_REGEX = /[,.;:!?)'"\]}>]+$/

const findInlineTokens = (text: string, baseOffset: number): IMatchedToken[] => {
  const matches: IMatchedToken[] = []

  const isOverlapping = (start: number, end: number): boolean => {
    return matches.some(m => Math.max(m.start, start) < Math.min(m.end, end))
  }

  // 1. URL (highest precedence to prevent its slashes from being matched as paths)
  URL_REGEX.lastIndex = 0
  let urlMatch: RegExpExecArray | null
  while ((urlMatch = URL_REGEX.exec(text)) !== null) {
    const matchedStr = urlMatch[0]
    const punctMatch = TRAILING_PUNCT_REGEX.exec(matchedStr)
    const trailingPunctLen = punctMatch ? punctMatch[0].length : 0
    const start = baseOffset + urlMatch.index
    const end = start + matchedStr.length - trailingPunctLen
    if (end > start && !isOverlapping(start, end)) {
      matches.push({ start, end, tokenType: 'url' })
    }
  }

  // 2. Paths
  const scanPaths = (regex: RegExp) => {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const matchedStr = match[0]
      const punctMatch = TRAILING_PUNCT_REGEX.exec(matchedStr)
      const trailingPunctLen = punctMatch ? punctMatch[0].length : 0
      const start = baseOffset + match.index
      const end = start + matchedStr.length - trailingPunctLen
      if (end > start && !isOverlapping(start, end)) {
        matches.push({ start, end, tokenType: 'path' })
      }
    }
  }

  scanPaths(PATH_ABSOLUTE_REGEX)
  scanPaths(PATH_RELATIVE_REGEX)
  scanPaths(PATH_EXT_REGEX)

  // 3. IDs
  const scanIds = (regex: RegExp) => {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const matchedStr = match[0]
      const start = baseOffset + match.index
      const end = start + matchedStr.length
      if (end > start && !isOverlapping(start, end)) {
        matches.push({ start, end, tokenType: 'id' })
      }
    }
  }

  scanIds(ID_PANE_REGEX)
  scanIds(ID_TASK_REGEX)
  scanIds(ID_UUID_REGEX)

  return matches
}

const tokenizeLine = (line: string, lineType: TerminalLineType): ITerminalSegment[] => {
  if (line.length === 0) {
    return [{ text: '' }]
  }

  // Divider and statusline remain untokenized
  if (lineType === 'divider' || lineType === 'statusline') {
    return [{ text: line }]
  }

  const structuralTokens: IMatchedToken[] = []

  // Leading structural anchors
  if (lineType === 'prompt') {
    const promptMatch = /^([\t ]*)([›❯➜]|\$|>)([\t ]+)/.exec(line)
    if (promptMatch) {
      const leadingSpace = promptMatch[1].length
      const glyphStart = leadingSpace
      const glyphEnd = glyphStart + promptMatch[2].length
      structuralTokens.push({ start: glyphStart, end: glyphEnd, tokenType: 'glyph' })
    }
  } else if (lineType === 'thinking') {
    const thinkMatch =
      /^([\t ]*)([✻✦]|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣷⣯⣟⡿⢿⣻⣽⣾]|[•*●▸])([\t ]*)/.exec(line)
    if (thinkMatch) {
      const leadingSpace = thinkMatch[1].length
      const glyphStart = leadingSpace
      const glyphEnd = glyphStart + thinkMatch[2].length
      structuralTokens.push({ start: glyphStart, end: glyphEnd, tokenType: 'glyph' })
    }
  } else if (lineType === 'tool') {
    const toolVerbMatch =
      /^([\t ]*)([•*●▸])([\t ]+)(\S+)([\t ]*)/.exec(line)
    const treeMatch = /^([\t ]*)([└├│┌⎿])([\t ]*)/.exec(line)
    if (toolVerbMatch) {
      const leadingSpace = toolVerbMatch[1].length
      const glyphStart = leadingSpace
      const glyphEnd = glyphStart + toolVerbMatch[2].length
      structuralTokens.push({ start: glyphStart, end: glyphEnd, tokenType: 'glyph' })

      const spaceAfterGlyph = toolVerbMatch[3].length
      const verbStart = glyphEnd + spaceAfterGlyph
      const verbEnd = verbStart + toolVerbMatch[4].length
      structuralTokens.push({ start: verbStart, end: verbEnd, tokenType: 'tool-verb' })
    } else if (treeMatch) {
      const leadingSpace = treeMatch[1].length
      const treeStart = leadingSpace
      const treeEnd = treeStart + treeMatch[2].length
      structuralTokens.push({ start: treeStart, end: treeEnd, tokenType: 'tree' })
    }
  } else if (lineType === 'error') {
    const glyphMatch = /^([\t ]*)([❌✖✗])([\t ]*)/.exec(line)
    const treeMatch = /^([\t ]*)([└├│┌⎿])([\t ]*)/.exec(line)
    if (glyphMatch) {
      const leadingSpace = glyphMatch[1].length
      const glyphStart = leadingSpace
      const glyphEnd = glyphStart + glyphMatch[2].length
      structuralTokens.push({ start: glyphStart, end: glyphEnd, tokenType: 'glyph' })
    } else if (treeMatch) {
      const leadingSpace = treeMatch[1].length
      const treeStart = leadingSpace
      const treeEnd = treeStart + treeMatch[2].length
      structuralTokens.push({ start: treeStart, end: treeEnd, tokenType: 'tree' })
    }
  } else if (lineType === 'warning') {
    const glyphMatch = /^([\t ]*)(⚠️)([\t ]*)/.exec(line)
    const treeMatch = /^([\t ]*)([└├│┌⎿])([\t ]*)/.exec(line)
    if (glyphMatch) {
      const leadingSpace = glyphMatch[1].length
      const glyphStart = leadingSpace
      const glyphEnd = glyphStart + glyphMatch[2].length
      structuralTokens.push({ start: glyphStart, end: glyphEnd, tokenType: 'glyph' })
    } else if (treeMatch) {
      const leadingSpace = treeMatch[1].length
      const treeStart = leadingSpace
      const treeEnd = treeStart + treeMatch[2].length
      structuralTokens.push({ start: treeStart, end: treeEnd, tokenType: 'tree' })
    }
  } else if (lineType === 'success') {
    const glyphMatch = /^([\t ]*)([✓✔])([\t ]*)/.exec(line)
    if (glyphMatch) {
      const leadingSpace = glyphMatch[1].length
      const glyphStart = leadingSpace
      const glyphEnd = glyphStart + glyphMatch[2].length
      structuralTokens.push({ start: glyphStart, end: glyphEnd, tokenType: 'glyph' })
    }
  }

  // Inline anchors (URL, path, ID)
  const inlineTokens = findInlineTokens(line, 0)
  for (const it of inlineTokens) {
    const overlaps = structuralTokens.some(
      st => Math.max(st.start, it.start) < Math.min(st.end, it.end)
    )
    if (!overlaps) {
      structuralTokens.push(it)
    }
  }

  if (structuralTokens.length === 0) {
    return [{ text: line }]
  }

  structuralTokens.sort((a, b) => a.start - b.start)

  const segments: ITerminalSegment[] = []
  let cursor = 0

  for (const token of structuralTokens) {
    if (token.start > cursor) {
      segments.push({ text: line.slice(cursor, token.start) })
    }
    segments.push({
      text: line.slice(token.start, token.end),
      tokenType: token.tokenType
    })
    cursor = token.end
  }

  if (cursor < line.length) {
    segments.push({ text: line.slice(cursor) })
  }

  return segments
}

export const parseTerminalContent = (raw: string): ITerminalLine[] => {
  if (!raw) return []

  const lines: ITerminalLine[] = []
  const length = raw.length
  let lineStart = 0
  let i = 0

  while (i < length) {
    const code = raw.charCodeAt(i)
    if (code === 10) {
      const lineText = raw.slice(lineStart, i)
      const lineType = classifyTerminalLine(lineText)
      const segments = tokenizeLine(lineText, lineType)
      lines.push({
        text: lineText,
        lineType,
        segments,
        newline: '\n'
      })
      i++
      lineStart = i
    } else if (code === 13) {
      const lineText = raw.slice(lineStart, i)
      let newline = '\r'
      if (i + 1 < length && raw.charCodeAt(i + 1) === 10) {
        newline = '\r\n'
        i += 2
      } else {
        i++
      }
      const lineType = classifyTerminalLine(lineText)
      const segments = tokenizeLine(lineText, lineType)
      lines.push({
        text: lineText,
        lineType,
        segments,
        newline
      })
      lineStart = i
    } else {
      i++
    }
  }

  if (lineStart < length) {
    const lineText = raw.slice(lineStart)
    const lineType = classifyTerminalLine(lineText)
    const segments = tokenizeLine(lineText, lineType)
    lines.push({
      text: lineText,
      lineType,
      segments,
      newline: ''
    })
  }

  return lines
}
