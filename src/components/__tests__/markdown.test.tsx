import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '../markdown.tsx'
import { OpenChatToolFileContext } from '../chat-tool-content.tsx'
import { codeIsFilePath, splitFilePaths } from '@/utils/chat-file-paths.ts'

describe('Markdown component', () => {
  it('Thai file references and $$ display math reach actual owned consumers', () => {
    expect(codeIsFilePath('ไทย.txt')).toBe(true)
    expect(splitFilePaths('saved เอกสาร/ไทย.txt')).toEqual([
      'saved ',
      { path: 'เอกสาร/ไทย.txt' }
    ])
    const html = renderToStaticMarkup(
      createElement(
        OpenChatToolFileContext.Provider,
        { value: () => {} },
        createElement(Markdown, { children: '`ไทย.txt`\n\n$$\nx^2\n$$' })
      )
    )
    expect(html).toContain('class="markdown-file"')
    expect(html).toContain('class="markdown-math-display"')
    expect(html).not.toContain('$$')
  })
  it('binds source code/bare/link file paths to one real callback, never nested link buttons', () => {
    const html = renderToStaticMarkup(
      createElement(
        OpenChatToolFileContext.Provider,
        { value: () => {} },
        createElement(Markdown, {
          children:
            'Saved src/app.ts and `README.md`. [File](src/file.ts) [site](https://example.com) `process.env`'
        })
      )
    )
    expect(html.match(/class="markdown-file"/g)?.length).toBe(3)
    expect(html).toContain('<code>process.env</code>')
    expect(html).not.toContain('File (<code>src/file.ts</code>)')
    expect(html).not.toMatch(/<a[^>]*>.*<button/)
    expect(codeIsFilePath('process.env')).toBe(false)
    expect(codeIsFilePath('Math.random')).toBe(false)
    expect(codeIsFilePath('1.2.3')).toBe(false)
    expect(splitFilePaths('note docs/demo.mp4')).toEqual([
      'note ',
      { path: 'docs/demo.mp4' }
    ])
  })
  it('renders markdown to html', () => {
    const md =
      '# Title\n\nA paragraph with **bold** and `code`.\n\n```ts\nconst a = 1\n```\n\n- item 1\n- item 2'
    const html = renderToStaticMarkup(createElement(Markdown, { children: md }))
    expect(html).toContain('<h1>')
    expect(html).toContain('Title')
    expect(html).toContain('<strong>')
    expect(html).toContain('bold')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('markdown-code')
    expect(html).toContain('const a = 1')
    expect(html).toContain('<ul class="markdown-list">')
  })
})
