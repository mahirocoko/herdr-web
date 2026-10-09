import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ChatView, { Turn, ToolRow } from '../chat-view.tsx'

describe('ChatView component', () => {
  it('renders user text together with every attachment notice', () => {
    const html = renderToStaticMarkup(
      createElement(Turn, {
        live: false,
        waiting: false,
        turn: {
          id: 'u',
          role: 'user',
          ts: null,
          parts: [
            { kind: 'text', text: 'real user text' },
            { kind: 'notice', text: 'image unavailable' },
            { kind: 'notice', text: 'second notice' }
          ]
        }
      })
    )
    for (const text of [
      'real user text',
      'image unavailable',
      'second notice',
      'chat-turn-user'
    ])
      expect(html).toContain(text)
  })

  it('renders work, notices and final answer in the assistant anatomy', () => {
    const html = renderToStaticMarkup(
      createElement(Turn, {
        live: true,
        waiting: false,
        turn: {
          id: 'a',
          role: 'assistant',
          ts: null,
          parts: [
            { kind: 'text', text: 'working prose', phase: 'commentary' },
            { kind: 'notice', text: 'native notice' },
            { kind: 'text', text: 'final answer', phase: 'final_answer' }
          ]
        }
      })
    )
    for (const text of [
      'working prose',
      'native notice',
      'final answer',
      'work-block',
      'chat-turn-agent'
    ])
      expect(html).toContain(text)
  })

  it('renders explicit pending and truncated tool state with native target', () => {
    const html = renderToStaticMarkup(
      createElement(ToolRow, {
        part: {
          kind: 'tool',
          id: 'call',
          name: 'Read',
          summary: 'src/app.tsx',
          input: '{}',
          output: '',
          pending: true,
          truncated: true
        }
      })
    )
    for (const text of ['src/app.tsx', 'awaiting output', 'truncated'])
      expect(html).toContain(text)
  })

  it('renders truthful fallback when pane is not an agent pane', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        paneId: 'p-shell',
        isAgent: false,
        onSwitchToStream: () => {}
      })
    )
    expect(html).toContain('Chat is available for supported agent panes')
    expect(html).toContain('Switch to Terminal')
  })

  it('renders chat-view container for agent pane', () => {
    const html = renderToStaticMarkup(
      createElement(ChatView, {
        paneId: 'p-agent',
        isAgent: true,
        onSwitchToStream: () => {}
      })
    )
    expect(html).toContain('chat-view')
    expect(html).toContain('chat-transcript')
  })
})
