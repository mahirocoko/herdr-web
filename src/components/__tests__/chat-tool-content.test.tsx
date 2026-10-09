import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ChatToolContent,
  OpenChatToolFileContext
} from '../chat-tool-content.tsx'
import {
  lineDiff,
  parseTodoAnswer,
  patchText,
  phaseRows,
  planRows,
  taskRows,
  todoRows
} from '@/utils/chat-tool-details.ts'

const part = (input: string, name = 'Edit', output = '') => ({
  kind: 'tool' as const,
  id: 'native-call',
  name,
  summary: name,
  pending: false,
  input,
  output
})
const render = (input: unknown, name = 'Edit', output = '') =>
  renderToStaticMarkup(
    createElement(ChatToolContent, {
      part: part(
        typeof input === 'string' ? input : JSON.stringify(input),
        name,
        output
      )
    })
  )

describe('source rich tool content', () => {
  it('preserves line geometry, whitespace, Thai, insertions and removals', () => {
    expect(lineDiff('  เดิม\nkeep\n', '  ใหม่\nkeep\n')).toEqual([
      { kind: 'del', text: '  เดิม' },
      { kind: 'add', text: '  ใหม่' },
      { kind: 'same', text: 'keep' },
      { kind: 'same', text: '' }
    ])
    expect(lineDiff('', 'a\n')).toEqual([
      { kind: 'add', text: 'a' },
      { kind: 'add', text: '' }
    ])
    expect(lineDiff('x', '')).toEqual([{ kind: 'del', text: 'x' }])
    const html = render({
      file_path: '/very/long/'.repeat(50) + 'ไทย.ts',
      old_string: '  เดิม',
      new_string: '  ใหม่',
      extra: 'never lost'
    })
    expect(html).toContain('chat-diff-del')
    expect(html).toContain('chat-diff-add')
    expect(html).toContain('Raw input')
    expect(html).toContain('never lost')
    expect(html).not.toContain('<button')
  })
  it('renders MultiEdit in order and rejects invalid edits without losing raw data', () => {
    const html = render(
      {
        file_path: 'a.ts',
        edits: [
          { old_string: 'one', new_string: 'two' },
          { old_string: 'three', new_string: 'four' }
        ]
      },
      'MultiEdit'
    )
    expect(html.match(/class="chat-diff"/g)?.length).toBe(2)
    expect(html.indexOf('- one')).toBeLessThan(html.indexOf('- three'))
    expect(render({ edits: [null, { broken: 'kept' }] })).toContain('broken')
  })
  it('paints raw and exec-wrapped patches including update/add/delete/move paths', () => {
    const patch =
      '*** Begin Patch\n*** Update File: a.ts\n*** Move to: b.ts\n@@\n-old\n+ใหม่\n*** Add File: c.ts\n+new\n*** Delete File: d.ts\n*** End Patch\n'
    expect(patchText(`tools.apply_patch(${JSON.stringify(patch)})`)).toBe(patch)
    expect(patchText('not a patch')).toBeNull()
    const html = render(patch, 'apply_patch')
    for (const text of [
      'a.ts',
      'b.ts',
      'c.ts',
      '(add)',
      'd.ts',
      '(delete)',
      'chat-diff-head',
      'chat-diff-del',
      'chat-diff-add'
    ])
      expect(html).toContain(text)
  })
  it('uses source checklist shapes without assuming task completion', () => {
    expect(phaseRows([{ phase: 'Phase ไทย', items: ['item', 2] }])).toEqual([
      { label: 'Phase ไทย', done: false, heading: true },
      { label: 'item', done: false }
    ])
    expect(
      todoRows([{ content: 'done', status: 'completed' }, null])[0]?.done
    ).toBe(true)
    expect(
      planRows([{ step: 'active', status: 'in_progress' }])[0]?.active
    ).toBe(true)
    expect(taskRows(['named', {}])).toEqual([
      { label: 'named', done: false },
      { label: 'task 2', done: false }
    ])
    for (const input of [
      { list: [{ phase: 'phase', items: ['item'] }] },
      { todos: [{ content: 'item', status: 'pending' }] },
      { plan: [{ step: 'item', status: 'in_progress' }] },
      { tasks: ['item'] }
    ])
      expect(render(input)).toContain('chat-checklist')
  })
  it('shows task prompt and recorded agent metadata, without success or elapsed inventions', () => {
    const html = render(
      {
        agent: 'builder',
        tasks: [
          { description: 'first', assignment: '  ไทย\n  code' },
          { name: 'second', prompt: 'next', category: 'review' }
        ]
      },
      'task'
    )
    for (const text of [
      'chat-task-calls',
      'first',
      'builder',
      'ไทย',
      'second',
      'review',
      'next'
    ])
      expect(html).toContain(text)
    expect(html).not.toContain('completed')
  })
  it('parses both source todo answer formats and rejects cut lists', () => {
    const output =
      '  Phase:\n    - [X] done\n    - [ ] ไทย (blocked: reason)\n    → doing\nOverall: 1/3 done'
    expect(parseTodoAnswer(output)?.map((item) => item.status)).toEqual([
      'completed',
      'blocked',
      'in_progress'
    ])
    expect(parseTodoAnswer(output + '\n… trimmed')).toBeNull()
    expect(parseTodoAnswer(output.replace('1/3', '1/4'))).toBeNull()
    expect(render('{}', 'todo', output)).toContain('todo-list')
    const clipped = renderToStaticMarkup(
      createElement(ChatToolContent, {
        part: { ...part('{}', 'todo', output), truncated: true }
      })
    )
    expect(clipped).not.toContain('todo-list')
    expect(clipped).toContain('Overall: 1/3 done')
  })
  it('keeps actual cmd/cwd, output, unknown JSON and malformed content safely', () => {
    const html = render(
      { cmd: 'printf "ไทย"', cwd: '/work', description: 'recorded' },
      'exec_command',
      '<script>bad()</script>'
    )
    for (const text of ['cwd: /work', 'recorded', 'ไทย', '&lt;script&gt;'])
      expect(html).toContain(text)
    expect(html).not.toContain('<script>')
    for (const input of ['{broken', '[]', 'null', '{"unknown":"kept"}'])
      expect(render(input)).toContain('chat-tool-io')
    expect(render({ input: 'CUT old\n+new\nPUT next' }, 'edit')).toContain(
      'chat-diff-head'
    )
  })
  it('exposes file viewer callback only when a provider exists', () => {
    const html = renderToStaticMarkup(
      createElement(OpenChatToolFileContext.Provider, {
        value: () => {},
        children: createElement(ChatToolContent, {
          part: part('{"path":"a.ts"}', 'Read')
        })
      })
    )
    expect(html).toContain('Open a.ts')
    expect(html).toContain('<button')
  })
  it('large diffs fall back losslessly without allocating an unbounded LCS table', () => {
    const before = Array.from({ length: 501 }, (_, i) => `old ${i}`).join('\n')
    const after = Array.from({ length: 501 }, (_, i) => `new ${i}`).join('\n')
    const lines = lineDiff(before, after)
    expect(lines).toHaveLength(1002)
    expect(lines[1001]?.text).toBe('new 500')
  })
})
