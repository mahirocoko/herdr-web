import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileTextPreview } from '../chat-file-viewer.tsx'
import {
  canReadMarkdownPreview,
  resolveViewedFileLink,
  sourcePreviewPage
} from '@/utils/file-viewer-text.ts'
import { parseMarkdown } from '@/utils/markdown-parser.ts'

const render = (
  path: string,
  text: string,
  size = new TextEncoder().encode(text).length
) =>
  renderToStaticMarkup(
    createElement(FileTextPreview, { path, text, size, onOpen: () => {} })
  )

describe('selected local file text preview', () => {
  it('uses the Chat AST renderer for both Markdown extensions; HTML and unsafe URLs stay inert', () => {
    for (const extension of ['md', 'MARKDOWN']) {
      const html = render(
        `/repo/report.${extension}`,
        '# Report\n\n<script>alert(1)</script>\n\n[bad](javascript:alert) ![remote](https://example.com/track.png) [local](notes.md)'
      )
      expect(html).toContain('<h1>')
      expect(html).toContain('Report')
      expect(html).toContain('&lt;script&gt;')
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('href="javascript:')
      expect(html).not.toContain('<img')
      expect(html).toContain('class="markdown-file"')
      expect(html).toContain('Copy file')
    }
  })
  it('keeps non-Markdown source inert and clearly labels truncated copies', () => {
    const html = render('/repo/report.html', '<script>raw</script>', 70000)
    expect(html).toContain('File source')
    expect(html).toContain('file-source-line')
    expect(html).toContain('Copy preview')
    expect(html).toContain('first 64 KiB')
    expect(html).not.toContain('<script>')
    expect(render('/repo/empty.md', '')).toContain('Empty file')
  })
  it('bounds pathological documents before parsing and pages even newline-only source', () => {
    expect(canReadMarkdownPreview('# Readable\n\nไทย')).toBe(true)
    for (const text of [
      'x'.repeat(65537),
      '\n'.repeat(1600),
      '*'.repeat(5000),
      'x'.repeat(4097)
    ]) {
      expect(canReadMarkdownPreview(text)).toBe(false)
      expect(render('/repo/large.md', text)).toContain('too complex')
    }
    const page = sourcePreviewPage('\n'.repeat(65536), 100000)
    expect(page.lines.length).toBeLessThanOrEqual(300)
    expect(page.current).toBe(page.pages - 1)
    expect(sourcePreviewPage('a\nb\nc', -1).start).toBe(0)
    const html = render('/repo/large.txt', 'line\n'.repeat(1000))
    expect(html.match(/class="file-source-line"/g)).toHaveLength(300)
    expect(html).toContain('Lines 1–300 of 1001')
  })
  it('resolves relative and encoded links against the opened file, never pane cwd or a web origin', () => {
    expect(resolveViewedFileLink('/repo/docs/report.md', 'notes.md')).toBe(
      '/repo/docs/notes.md'
    )
    expect(
      resolveViewedFileLink('/repo/docs/report.md', '../ไทย%20file.md')
    ).toBe('/repo/docs/../ไทย file.md')
    expect(
      resolveViewedFileLink('/repo/docs/report.md', '/other/file.md')
    ).toBe('/other/file.md')
    expect(resolveViewedFileLink('/repo/docs/report.md', '~/file.md')).toBe(
      '~/file.md'
    )
    for (const value of [
      '//host/file',
      'https://host/file',
      'javascript:alert',
      '%00x',
      '%2f%2fhost/file',
      '%ZZ',
      'x?query',
      'a\\b'
    ])
      expect(resolveViewedFileLink('/repo/report.md', value)).toBeNull()
  })
  it('bounds recursive list parsing for hostile but byte-bounded local content', () => {
    const nested = Array.from(
      { length: 200 },
      (_, i) => `${' '.repeat(i * 2)}- item`
    ).join('\n')
    expect(() => parseMarkdown(nested)).not.toThrow()
    expect(render('/repo/nested.md', nested)).toContain('item')
  })
})
