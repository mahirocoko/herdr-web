import { describe, expect, it } from 'bun:test'
import {
  foldCode,
  isTableSeparator,
  mathNestsTooDeep,
  parseInline,
  parseMarkdown,
  safeMarkdownHref,
  trimUrl
} from '../markdown-parser.ts'

describe('parseMarkdown', () => {
  it('parses level one through three headings', () => {
    expect(
      parseMarkdown('# One\n## Two\n### Three').map((block) =>
        block.type === 'heading' ? block.level : null
      )
    ).toEqual([1, 2, 3])
  })

  it('parses unordered, ordered, and nested lists', () => {
    const blocks = parseMarkdown(
      '- first\n  - nested\n- second\n\n1. one\n2. two'
    )
    expect(blocks[0]).toMatchObject({
      type: 'list',
      ordered: false,
      items: [
        {
          blocks: [
            {
              type: 'list',
              ordered: false,
              items: [{ content: [{ type: 'text', value: 'nested' }] }]
            }
          ]
        },
        {}
      ]
    })
    expect(blocks[1]).toMatchObject({
      type: 'list',
      ordered: true,
      items: [{}, {}]
    })
  })

  it('keeps fenced code and its language', () => {
    expect(parseMarkdown('```ts\nconst x = 1;\n```')).toEqual([
      { type: 'code', language: 'ts', value: 'const x = 1;' }
    ])
  })

  it('recognizes display math without parsing its contents as markdown', () => {
    const formula = '\\[\n\\mathrm{E}=mc^2\n\\]'
    expect(parseMarkdown(formula)).toEqual([
      { type: 'math', value: formula.slice(3, -3) }
    ])
    expect(
      parseMarkdown('before\n\\[x^2\\]\nafter').map((block) => block.type)
    ).toEqual(['paragraph', 'math', 'paragraph'])
    expect(parseMarkdown('```tex\n\\[x\\]\n```')).toEqual([
      { type: 'code', language: 'tex', value: '\\[x\\]' }
    ])
    expect(parseMarkdown('\\[unfinished')).toEqual([
      { type: 'paragraph', lines: [[{ type: 'text', value: '\\[unfinished' }]] }
    ])
  })

  it('parses a GFM table', () => {
    const [table] = parseMarkdown('| Name | Value |\n| --- | --- |\n| a | b |')
    expect(table).toMatchObject({
      type: 'table',
      header: [[{ value: 'Name' }], [{ value: 'Value' }]],
      rows: [[[{ value: 'a' }], [{ value: 'b' }]]]
    })
  })
})

describe('inline markdown', () => {
  it('parses links and rejects unsafe protocols', () => {
    expect(safeMarkdownHref('https://example.com')).toBe('https://example.com')
    expect(safeMarkdownHref('mailto:a@example.com')).toBe(
      'mailto:a@example.com'
    )
    expect(safeMarkdownHref('javascript:alert(1)')).toBeNull()
    expect(
      parseInline('[safe](https://example.com) [unsafe](javascript:bad)')
    ).toMatchObject([
      { type: 'link', href: 'https://example.com' },
      { type: 'text', value: ' ' },
      { type: 'text', value: 'unsafe' }
    ])
  })

  it('keeps a link to a local file as that file, not only its label', () => {
    expect(
      parseInline('Reference: [report](/home/u/repo/output/REPORT.md)')
    ).toEqual([
      { type: 'text', value: 'Reference: ' },
      {
        type: 'file',
        path: '/home/u/repo/output/REPORT.md',
        children: [{ type: 'text', value: 'report' }]
      }
    ])
    expect(parseInline('[x](src/x.ts#L12) [y](~/y.md:3:1)')).toMatchObject([
      { type: 'file', path: 'src/x.ts' },
      { type: 'text', value: ' ' },
      { type: 'file', path: '~/y.md' }
    ])
  })

  it('trims urls correctly', () => {
    expect(trimUrl('https://example.com).')).toBe('https://example.com')
    expect(trimUrl('https://example.com/path(1)')).toBe(
      'https://example.com/path(1)'
    )
  })

  it('checks math nesting and folds code', () => {
    expect(mathNestsTooDeep('{{{{{}}}}}')).toBe(false)
    expect(foldCode('line\n'.repeat(35))).not.toBeNull()
    expect(foldCode('line\n'.repeat(5))).toBeNull()
  })

  it('validates table separator', () => {
    expect(isTableSeparator('| --- | :---: |')).toBe(true)
    expect(isTableSeparator('| not | separator |')).toBe(false)
  })
})
