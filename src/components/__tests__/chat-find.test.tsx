import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatFind, ChatMatchSource } from '../chat-find.tsx'

describe('Find in Chat presentation', () => {
  test('canonical controls, local scope, truthful previews and loading/failure states', () => {
    const html = renderToStaticMarkup(
      createElement(ChatFind, {
        rows: [],
        older: true,
        loading: true,
        limited: false,
        error: 'native file unavailable',
        onOlder: async () => false,
        onMatch: () => {},
        onClose: () => {}
      })
    )
    expect(html).toContain('role="search"')
    expect(html).toContain('aria-label="Find in Chat"')
    expect(html).toContain('chat-find-query')
    expect(html).toContain('lucide-search')
    expect(html.indexOf('chat-find-query')).toBeLessThan(
      html.indexOf('chat-find-count')
    )
    expect(html.indexOf('chat-find-count')).toBeLessThan(
      html.indexOf('Previous match')
    )
    expect(html.indexOf('chat-find-count')).toBeLessThan(
      html.indexOf('chat-find-options')
    )
    expect(html).toContain('ui-input')
    expect(html).toContain('ui-button--ghost')
    expect(html).toContain('ui-checkbox')
    expect(html).toContain('Previous match')
    expect(html).toContain('Next match')
    expect(html).toContain('Close search')
    expect(html).toContain('Tool-output previews only')
    expect(html).toContain('role="alert"')
    expect(html).toContain('native file unavailable')
    expect(html).not.toContain('type="submit"')
  })
  test('reveals actual folded-source offsets as inert semantic mark, not fabricated rendered text', () => {
    const text = 'Read\nfile\n{}\n<script>ไทย sentinel</script>'
    const start = text.indexOf('ไทย sentinel')
    const html = renderToStaticMarkup(
      createElement(ChatMatchSource, {
        text,
        match: { rowKey: 'native', start, end: start + 'ไทย sentinel'.length }
      })
    )
    expect(html).toContain('<mark>ไทย sentinel</mark>')
    expect(html).toContain('aria-label="Matching native source"')
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
})
