import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Dialog } from '@base-ui/react/dialog'
import { FileTextPreview, FileViewerHeading } from '../chat-file-viewer.tsx'
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

describe('source-led file viewer ownership', () => {
  it('keeps the extension separate and publishes the full Thai path plus truthful preview size', () => {
    const name = `${'รายงานยาว'.repeat(30)}.markdown`
    const path = `/repo/${'โฟลเดอร์/'.repeat(30)}${name}`
    const html = renderToStaticMarkup(
      createElement(
        Dialog.Root,
        { open: true },
        createElement(FileViewerHeading, {
          name,
          path,
          size: 131072,
          truncated: true
        })
      )
    )
    expect(html).toContain('file-viewer-stem')
    expect(html).toContain('</span>.markdown')
    expect(html).toContain(`title="${path}"`)
    expect(html).toContain('64 KiB of 128.0 KiB')
    expect(html).toContain('dir="ltr"')
  })
  it('isolates the bounded frame and narrow-screen source header from Terminal image recipes', async () => {
    const css = await Bun.file(
      new URL('../chat-file-viewer.css', import.meta.url)
    ).text()
    const source = await Bun.file(
      new URL('../chat-file-viewer.tsx', import.meta.url)
    ).text()
    expect(css).toContain('width: min(96vw, 1100px)')
    expect(css).toContain('max-height: min(92vh, 100%)')
    expect(css).toContain(
      "grid-template-areas: 'title close' 'actions actions'"
    )
    expect(css).toContain('text-overflow: ellipsis')
    expect(css).toContain('@media (pointer: coarse)')
    expect(css).toMatch(
      /\.file-viewer-action\.ui-button\s*\{\s*width: 44px;\s*height: 44px;\s*min-width: 44px;\s*min-height: 44px;/
    )
    expect(css).toContain('.file-viewer-body--media')
    expect(css).toContain('margin-block: auto')
    expect(source).toContain("['image', 'video', 'audio'].includes(info.kind)")
    expect(css).not.toContain('ui-image-lightbox')
    expect(source).not.toContain('ui-image-lightbox__')
    // Wiring guard only, not interactive Escape/focus or download proof.
    expect(source).toContain('<Dialog.Root')
    expect(source).toContain('<Dialog.Close')
    expect(source).toContain('<TerminalImagePreview')
    expect(source).toContain('open={zoom}')
    expect(source).toContain('onClose={() => setZoom(false)}')
    expect(source).toContain("fileContentUrl(file.ref, 'download')")
    expect(source).toContain('open(file.parent!)')
    expect(source).toContain('onClick={() => setPage(source.current + 1)}')
    expect(source).toContain('createPortal(controls, actionsHost)')
  })
})

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
