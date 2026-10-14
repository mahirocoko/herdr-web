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
  IOmoTaskResult,
  ConversationPart
} from '../../types/conversation.ts'
import { TurnChangedFiles, ChatPatchContext } from '../turn-changed-files.tsx'
import { readFileSync } from 'node:fs'
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
      'is-completed',
      'done',
      'failed',
      'native-model',
      'researcher',
      '3 tool calls',
      '400 tokens',
      'chat-task-results-head',
      'chat-task-result-main',
      'chat-task-result-meta',
      'chat-task-result-status',
      'chat-skill-caret',
      '<summary>'
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
    expect(html).not.toContain('Recorded result') // Source defers Markdown until opened.
    expect(html).toContain('Background task ended')
  })
  test('all skill evidence/status combinations retain icon, status and caret without promoting requested to invoked', () => {
    for (const evidence of ['instructions', 'invocation'] as const)
      for (const status of ['requested', 'loaded', 'failed'] as const) {
        const skill = {
          name: 'ทักษะภาษาไทยยาวมาก'.repeat(12) + '<script>',
          evidence,
          status,
          path: 'skills/<unsafe>/SKILL.md'
        }
        const parts: ConversationPart[] = [
          { kind: 'skill', skill },
          {
            kind: 'tool',
            id: 's',
            name: 'Skill',
            input: '',
            output: '',
            summary: '',
            pending: status === 'requested',
            skill
          }
        ]
        const html = renderToStaticMarkup(
          createElement(Turn, {
            live: false,
            waiting: false,
            turn: { id: 's', role: 'user', ts: null, parts }
          })
        )
        expect(html.match(/class="chat-skill-name"/g)?.length).toBe(1)
        expect(html).toContain('chat-skill-caret')
        expect(html).toContain('chat-skill-status')
        expect(html).toContain('lucide-book-open')
        expect(html).toContain('&lt;script&gt;')
        expect(html).not.toContain('<script>')
        if (status === 'requested')
          expect(html).toContain(
            evidence === 'invocation'
              ? 'Skill requested'
              : 'Reading skill requested'
          )
        if (status === 'loaded')
          expect(html).toContain(
            evidence === 'invocation'
              ? 'Skill invoked'
              : 'Skill instructions loaded'
          )
        if (status === 'failed')
          expect(html).toContain(
            evidence === 'invocation'
              ? 'Skill invocation failed'
              : 'Skill read failed'
          )
      }
  })
  test('notice labels follow available provenance; unknown fields never create peer or completion claims', () => {
    const parts: ConversationPart[] = [
      {
        kind: 'notice',
        source: 'local-command',
        text: '<img src=x onerror=alert(1)>'
      },
      {
        kind: 'notice',
        text: '\nคำแจ้งเตือนยาวมาก'.repeat(30),
        ...{ providerStatus: 'completed', peer: 'secret' }
      },
      { kind: 'notice', text: 'Unpaired tool output:\nplain' },
      { kind: 'compact', text: 'Summary' },
      {
        kind: 'notice',
        source: 'letta-runtime',
        severity: 'error',
        text: 'runtime detail'
      }
    ]
    const html = renderToStaticMarkup(
      createElement(Turn, {
        live: false,
        waiting: false,
        turn: { id: 'n', role: 'assistant', ts: null, parts }
      })
    )
    for (const label of [
      'Local command',
      'คำแจ้งเตือนยาวมาก',
      'Unpaired tool output:',
      'Conversation compacted',
      'Letta runtime error'
    ])
      expect(html).toContain(label)
    expect(html).toContain('chat-notice-label')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('Background result delivered')
    expect(html).not.toContain('secret')
  })
  test('cancelled tasks and absent metadata stay honest while rows stay visible', () => {
    const html = renderToStaticMarkup(
      createElement(ChatTaskResults, {
        tasks: [
          {
            ...task,
            status: 'cancelled',
            agent: null,
            model: null,
            duration_ms: null,
            turns: null,
            tool_calls: null,
            tokens: null,
            ...{ workflowComplete: true }
          }
        ]
      })
    )
    expect(html).toContain('cancelled')
    expect(html).toContain('lucide-circle-slash')
    expect(html).not.toContain('chat-task-result-meta')
    expect(html).not.toContain('workflowComplete')
    expect(html).not.toContain('>done<')
    expect(html).not.toContain('Recorded result')
  })
  test('edited-file production rows use dense source recipe and do not call patch owner on render', () => {
    let calls = 0
    const path = 'src/' + 'ไฟล์ยาว'.repeat(30) + '/<unsafe>.tsx'
    const parts: ConversationPart[] = [
      {
        kind: 'tool',
        id: 'e',
        name: 'Edit',
        input: JSON.stringify({ file_path: path }),
        output: '',
        summary: '',
        pending: false,
        error: false
      }
    ]
    const html = renderToStaticMarkup(
      createElement(
        ChatPatchContext.Provider,
        {
          value: () => {
            calls++
          }
        },
        createElement(TurnChangedFiles, { parts })
      )
    )
    expect(calls).toBe(0)
    expect(html).toContain('turn-changed-files-title')
    expect(html).toContain('turn-changed-file-link')
    expect(html).toContain('Current working tree, not historical')
    expect(html).toContain('&lt;unsafe&gt;')
    const css = readFileSync(
      new URL('../chat-view.css', import.meta.url),
      'utf8'
    )
    expect(css).toContain(
      '.turn-changed-files .turn-changed-file-link.ui-button'
    )
    expect(css).toContain('min-height: calc(var(--control-h) - var(--space-2))')
    expect(css).toMatch(
      /\.turn-changed-files li\s*\{\s*overflow-wrap: anywhere;\s*font-family: var\(--font-mono\);/
    )
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
