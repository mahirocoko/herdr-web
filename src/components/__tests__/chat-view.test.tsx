import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ChatView, { Turn, ToolRow, SubmissionReceipts } from '../chat-view.tsx'
import type { IChatSubmission } from '../../utils/chat-submissions.ts'

const receiptTarget = {
  paneId: 'pane',
  terminalId: 'terminal',
  expectedMode: 'agent' as const,
  agentSessionId: 'session'
}
const receipt: IChatSubmission = {
  operationId: 'op',
  text: 'immutable original',
  target: receiptTarget,
  generation: 'document',
  submittedAt: '2026-10-12T08:30:00Z',
  baseline: { sessionKey: 'history', frontier: 1, ids: ['old'] },
  phase: 'submitted-awaiting-transcript'
}
const receiptsHtml = (
  record: IChatSubmission,
  nativeId: string | null = null
) =>
  renderToStaticMarkup(
    createElement(SubmissionReceipts, {
      records: [record],
      actionTarget: receiptTarget,
      sessionKey: 'history',
      corroborations: new Map([[record.operationId, nativeId]]),
      onClear: () => {}
    })
  )

describe('ordinary Send receipt presentation', () => {
  it('collapses stale, restored, acknowledged and corroborated receipts in one closed history, without queue controls', () => {
    for (const [record, nativeId] of [
      [receipt, null],
      [
        {
          ...receipt,
          baseline: { ...receipt.baseline!, sessionKey: 'old-history' }
        },
        null
      ],
      [{ ...receipt, restored: true, phase: 'uncertain' }, null],
      [receipt, 'native-user']
    ] as [IChatSubmission, string | null][]) {
      const html = receiptsHtml(record, nativeId)
      expect(
        html.startsWith('<details class="chat-compact submission-history">')
      ).toBe(true)
      expect(html).toContain(
        '<summary>Submission history (not queued)</summary>'
      )
      expect(html.match(/<details/g)?.length).toBe(1)
      expect(html).not.toContain(' open=')
      expect(html).not.toContain('chat-bubble')
      expect(html).not.toContain('role="status"')
      expect(html).toContain('immutable original')
      expect(html).toContain('Clear saved receipts (all panes)')
      expect(html).toContain('does not cancel native input')
      for (const control of [
        'Send now',
        'Discard unsent',
        'Refresh held evidence',
        'Held in Web'
      ])
        expect(html).not.toContain(control)
    }
    expect(
      receiptsHtml({ ...receipt, restored: true, phase: 'uncertain' })
    ).toContain('inspect Terminal before sending again')
    expect(receiptsHtml(receipt, 'native-user')).toContain(
      'Corroborated in native transcript — execution not confirmed'
    )
    expect(receiptsHtml(receipt)).toContain('Submitted (not queued)')
  })
  it('does not duplicate live held cards and keeps restored copies authority-free', () => {
    for (const restored of [false, true]) {
      for (const actionTarget of [
        receiptTarget,
        { ...receiptTarget, agentSessionId: 'replacement' }
      ]) {
        const html = renderToStaticMarkup(
          createElement(ChatView, {
            paneId: 'pane',
            actionTarget,
            onSwitchToStream: () => {},
            held: {
              records: [
                {
                  operationId: 'held-op',
                  heldId: 'a'.repeat(64),
                  text: 'Held original',
                  target: receiptTarget,
                  state: 'held',
                  restored
                }
              ],
              storageError: null,
              enqueue: async () => {},
              refresh: async () => {},
              dismiss: () => {},
              send: async () => {},
              discard: async () => {}
            }
          })
        )
        expect(html.includes('Held original')).toBe(restored)
        expect(html.includes('Saved Web-held evidence (not live queue)')).toBe(
          restored
        )
        expect(html).not.toContain('Send now')
        expect(html).not.toContain('Discard unsent Web-held text')
        expect(html).not.toContain('Submission history (not queued)')
      }
    }
  })
  it('keeps current sending, unknown and rejected problems above closed history', () => {
    for (const phase of ['sending', 'uncertain', 'rejected'] as const) {
      const html = receiptsHtml({ ...receipt, phase })
      const [visible, history] = html.split('<details')
      expect(visible).toContain('chat-bubble')
      expect(visible).toContain('role="status"')
      expect(visible).not.toContain('Clear saved receipts')
      expect(history).toContain('Clear saved receipts (all panes)')
      expect(history).not.toContain('immutable original')
      if (phase === 'uncertain') expect(visible).toContain('No automatic retry')
      if (phase === 'rejected') expect(visible).toContain('not submitted')
    }
  })
})

describe('ChatView component', () => {
  it('retains full long Markdown and reveals the selected hidden Thai source occurrence outside the cap', () => {
    const prefix = 'first line\n'.repeat(20)
    const text = `${prefix}ข้อความไทย [real link](https://example.test)`
    const html = renderToStaticMarkup(
      createElement(Turn, {
        live: false,
        waiting: false,
        turn: {
          id: 'long-user',
          role: 'user',
          ts: null,
          parts: [{ kind: 'text', text }]
        },
        match: {
          rowKey: 'long-user',
          start: prefix.length,
          end: prefix.length + 'ข้อความไทย'.length
        }
      })
    )
    expect(html).toContain('chat-bubble is-capped')
    expect(html).toContain('href="https://example.test"')
    expect(html).toContain('<mark>ข้อความไทย</mark>')
    expect(html.indexOf('chat-match-source')).toBeGreaterThan(
      html.indexOf('chat-turn-meta')
    )
    expect(html).toContain('Copy message')
  })
  it('exposes real Skill tool identity without claiming workflow completion', () => {
    const html = renderToStaticMarkup(
      createElement(ToolRow, {
        part: {
          kind: 'tool',
          id: 'skill',
          name: 'Skill',
          summary: 'better-colors',
          input: '{"skill":"better-colors"}',
          output: '',
          pending: false
        }
      })
    )
    expect(html).toContain('data-tool-name="Skill"')
    expect(html).toContain('work-row-name">Skill')
    expect(html).not.toContain('workflow completed')
  })
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
    expect(html).toContain('No native agent conversation is available')
    expect(html).toContain('Open an agent in Herdr')
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
