export const SOURCE_PAGE_LINES = 300

// Resolve only inert local paths; the existing owner-authenticated API still
// authorizes and freshly opens each selection. Never use the pane CWD here.
export const resolveViewedFileLink = (
  filePath: string,
  target: string
): string | null => {
  let value: string
  try {
    value = decodeURIComponent(target)
  } catch {
    return null
  }
  if (
    !value ||
    /[\x00-\x1f\x7f\\?]/.test(value) ||
    value.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  )
    return null
  if (value.startsWith('/') || value.startsWith('~/')) return value
  const directory = filePath.slice(0, filePath.lastIndexOf('/') + 1)
  return directory ? `${directory}${value}` : null
}

// Byte-bounded transport alone can still produce tens of thousands of DOM
// nodes. Complex previews remain fully readable through paged source instead.
export const canReadMarkdownPreview = (text: string): boolean => {
  if (text.length > 64 * 1024) return false
  const lines = text.split(/\r\n?|\n/)
  return (
    lines.length <= 1500 &&
    lines.every((line) => line.length <= 4096) &&
    (text.match(/[`*_~[|\\./#>\-]/g)?.length ?? 0) <= 4000
  )
}

export const sourcePreviewPage = (text: string, page: number) => {
  const lines = text.split(/\r\n?|\n/)
  const pages = Math.max(1, Math.ceil(lines.length / SOURCE_PAGE_LINES))
  const current = Math.max(0, Math.min(page, pages - 1))
  const start = current * SOURCE_PAGE_LINES
  return {
    lines: lines.slice(start, start + SOURCE_PAGE_LINES),
    start,
    pages,
    current,
    total: lines.length
  }
}
