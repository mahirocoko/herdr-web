import { describe, test, expect } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ChatTaskResults,
  ChatAbandonedBranches
} from '../chat-provider-records.tsx'
import { Turn } from '../chat-view.tsx'
import {
  emptyConversation,
  reconcileConversation
} from '../../hooks/use-conversation.ts'
import type {
  IConversationRead,
  IOmoTaskResult
} from '../../types/conversation.ts'
const task: IOmoTaskResult = {
  id: 'native-task',
  title: 'Recorded title',
  agent: 'researcher',
  model: 'native-model',
  status: 'completed',
  duration_ms: 1234,
  turns: 2,
  tool_calls: 3,
  tokens: 400,
  result: '**Recorded result**',
  result_cut: true
}
describe('native provider record consumer fixtures — SSR only', () => {
  test('structured completion uses native status/model/stats and semantic disclosure, not fabricated workflow completion', () => {
    const html = renderToStaticMarkup(
      createElement(ChatTaskResults, {
        tasks: [task, { ...task, id: 'failed', status: 'failed' }]
      })
    )
    for (const text of [
      'Recorded title',
      'completed',
      'failed',
      'native-model',
      'researcher',
      'Tool calls',
      'Tokens',
      'Recorded result',
      'truncated',
      '<summary>',
      '<dl>'
    ])
      expect(html).toContain(text)
  })
  test('native task_result is wired in actual user-seat Turn renderer', () => {
    const html = renderToStaticMarkup(
      createElement(Turn, {
        live: false,
        waiting: false,
        turn: {
          id: 'wake',
          role: 'user',
          ts: null,
          parts: [{ kind: 'task_result', tasks: [task] }]
        }
      })
    )
    expect(html).toContain('Recorded title')
    expect(html).toContain('Recorded result')
  })
  test('branch count/summary disclosure suppresses zero abandoned branches', () => {
    expect(
      renderToStaticMarkup(
        createElement(ChatAbandonedBranches, {
          abandoned: { count: 0, branches: 0, summary: null }
        })
      )
    ).toBe('')
    const html = renderToStaticMarkup(
      createElement(ChatAbandonedBranches, {
        abandoned: { count: 3, branches: 2, summary: 'Native branch summary' }
      })
    )
    expect(html).toContain('3 turns left on 2 other branches')
    expect(html).toContain('Native branch summary')
  })
  test('native metadata and abandoned summaries pass through state without older-page rollback', () => {
    const page: IConversationRead = {
      ok: true,
      paneId: 'p',
      source: 'pi-transcript',
      sessionKey: 'native',
      turns: [],
      contributions: [],
      before: null,
      truncated: false,
      metadata: {
        model: 'model',
        reasoning_effort: 'medium',
        context: { used: 123, window: null }
      },
      abandoned: { count: 1, branches: 1, summary: 'native summary' }
    }
    const first = reconcileConversation(emptyConversation(), page, false)
    const next = reconcileConversation(
      first,
      { ...page, metadata: { ...page.metadata, reasoning_effort: 'high' } },
      false
    )
    expect(next.metadata.reasoning_effort).toBe('high')
    expect(next.metadata.context?.used).toBe(123)
    expect(
      reconcileConversation(next, { ...page, abandoned: undefined }, true)
        .abandoned
    ).toEqual(page.abandoned)
  })
})
