import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatAssetContext, WholeToolContent } from '../chat-native-assets.tsx'
import { Turn } from '../chat-view.tsx'

describe('real native asset consumer anatomy', () => {
  test('large recorded output exposes the real fetch action without losing preview', () => {
    const html = renderToStaticMarkup(
      <ChatAssetContext.Provider value={{ paneId: 'w:p', history: 'h' }}>
        <WholeToolContent
          part={{
            kind: 'tool',
            id: 'call',
            name: 'Read',
            summary: 'file.ts',
            input: '{}',
            output: 'previewไทย',
            pending: false,
            truncated: true,
            outputRef: 'opaque',
            outputRevision: 'a'.repeat(64),
            outputLength: 30000
          }}
        />
      </ChatAssetContext.Provider>
    )
    expect(html).toContain('Load full output')
    expect(html).toContain('UTF-16 units')
    expect(html).toContain('previewไทย')
  })
  test('native user attachment is not silently dropped or replaced by text-only bubble', () => {
    const html = renderToStaticMarkup(
      <ChatAssetContext.Provider value={{ paneId: 'w:p', history: 'h' }}>
        <Turn
          live={false}
          waiting={false}
          turn={{
            id: 'u',
            role: 'user',
            ts: null,
            parts: [
              {
                kind: 'image',
                ref: 'opaque',
                imageRevision: 'v',
                media_type: 'image/png'
              },
              { kind: 'text', text: 'ดูรูปนี้' }
            ]
          }}
        />
      </ChatAssetContext.Provider>
    )
    expect(html).toContain('Loading attachment')
    expect(html).toContain('ดูรูปนี้')
  })
  test('compaction and skill evidence remain visible without creating empty Worked block', () => {
    const html = renderToStaticMarkup(
      <Turn
        live={false}
        waiting={false}
        turn={{
          id: 'a',
          role: 'assistant',
          ts: null,
          parts: [
            { kind: 'compact', text: 'Native summary' },
            {
              kind: 'skill',
              skill: {
                name: 'example',
                evidence: 'instructions',
                status: 'loaded'
              }
            }
          ]
        }}
      />
    )
    expect(html).toContain('Conversation compacted')
    expect(html).toContain('Native summary')
    expect(html).toContain('chat-compact-text chat-notice-text')
    expect(html).toContain('data-status="loaded"')
    expect(html).toContain('class="chat-skill-name">example</span>')
    expect(html).toContain('Skill instructions loaded')
    expect(html).toContain(
      'The transcript records loading this skill’s instructions.'
    )
    expect(html).toContain('This does not confirm every step was followed.')
    expect(html).toContain('aria-label="Recorded skill activity"')
    expect(html).not.toContain('work-block-head')
  })
})
