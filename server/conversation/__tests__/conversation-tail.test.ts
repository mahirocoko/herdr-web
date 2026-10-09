import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { readPaneConversation } from '../conversation-reader.ts'
import { nativeContribution } from '../native-contributions.ts'
import {
  emptyConversation,
  reconcileConversation
} from '../../../src/hooks/use-conversation.ts'
import type { ISnapshotResult } from '../../types.ts'
import type { IConversationRead } from '../../../src/types/conversation.ts'

const entry = (id: string, role: string, content: unknown, extra = {}) =>
  JSON.stringify({ type: 'message', message: { id, role, content, ...extra } })
const text = (value: string) => [{ type: 'text', text: value }]
const visible = (page: IConversationRead) => JSON.stringify(page.turns)

describe('descriptor-bound native tail paging', () => {
  let root: string
  let file: string
  let dir: string
  let snapshot: ISnapshotResult
  const id = 'tail-conversation'
  const header = JSON.stringify({ type: 'session', version: 3, id })
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-tail-'))
    dir = path.join(
      root,
      Buffer.from(`conversation:${id}`).toString('base64url')
    )
    fs.mkdirSync(dir)
    fs.writeFileSync(
      path.join(dir, 'conversation.json'),
      JSON.stringify({ id })
    )
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        schema_version: 2,
        message_format: 'pi-session-entry-jsonl',
        provider_stack: 'pi-ai'
      })
    )
    file = path.join(dir, 'messages.jsonl')
    snapshot = {
      protocol: 22,
      version: '0.9.3',
      workspaces: [
        {
          workspace_id: 'w',
          label: '',
          number: 1,
          agent_status: 'working',
          tab_count: 1,
          pane_count: 1,
          focused: true
        }
      ],
      tabs: [
        {
          tab_id: 't',
          workspace_id: 'w',
          label: '',
          number: 1,
          pane_count: 1,
          focused: true,
          agent_status: 'working'
        }
      ],
      panes: [
        {
          pane_id: 'w:p',
          workspace_id: 'w',
          tab_id: 't',
          terminal_id: 'terminal',
          agent: 'letta',
          agent_status: 'working',
          cwd: null,
          focused: true,
          tokens: {
            letta_scope: crypto
              .createHash('sha256')
              .update(id)
              .digest('hex')
              .slice(0, 16)
          }
        }
      ]
    }
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))
  const read = (before?: string | null, fetchSnapshot = async () => snapshot) =>
    readPaneConversation('w:p', {
      before,
      deps: { lettaRoot: root, fetchSnapshot }
    })

  test('latest after 8MiB, three decreasing older windows, Thai boundary and earliest poll frontier', async () => {
    const rows = [header]
    for (let i = 0; i < 60; i++)
      rows.push(
        entry(
          `a-${i}`,
          'assistant',
          text(`native-answer-${i}:` + 'ภาษาไทย'.repeat(9000)),
          { stopReason: 'stop' }
        )
      )
    rows.push(
      entry('latest', 'assistant', text('unique newest beyond eight MiB'), {
        stopReason: 'stop'
      })
    )
    fs.writeFileSync(file, rows.join('\n'))
    expect(fs.statSync(file).size).toBeGreaterThan(8 * 1024 * 1024)
    const latest = await read()
    expect(visible(latest)).toContain('unique newest beyond eight MiB')
    expect(visible(latest)).not.toContain('\uFFFD')
    expect(latest.truncated).toBe(true)
    let state = reconcileConversation(emptyConversation(), latest, false)
    let page = latest
    let frontier = Math.min(
      ...page
        .contributions!.filter((c) => c.role !== 'notice')
        .map((c) => c.position)
    )
    for (let i = 0; i < 3; i++) {
      expect(page.before).not.toBeNull()
      page = await read(page.before)
      const next = Math.min(
        ...page
          .contributions!.filter((c) => c.role !== 'notice')
          .map((c) => c.position)
      )
      expect(next).toBeLessThan(frontier)
      expect(visible(page)).toContain('native-answer-')
      expect(visible(page)).not.toContain('\uFFFD')
      frontier = next
      state = reconcileConversation(state, page, true)
    }
    const earliestCursor = state.before
    fs.appendFileSync(
      file,
      '\n' +
        entry('append', 'assistant', text('append answer'), {
          stopReason: 'stop'
        })
    )
    state = reconcileConversation(state, await read(), false)
    expect(state.before).toBe(earliestCursor)
    expect(JSON.stringify(state.turns)).toContain(
      'unique newest beyond eight MiB'
    )
    expect(JSON.stringify(state.turns)).toContain('append answer')
  })

  test('Agy cross-page output waits for native context and respects activity adjacency', () => {
    const contribution = (
      step_index: number,
      type: string,
      extra = {},
      position = step_index * 100
    ) =>
      nativeContribution(
        JSON.stringify({ step_index, type, source: 'MODEL', ...extra }),
        position,
        'agy-transcript'
      )!
    const call = contribution(1, 'PLANNER_RESPONSE', {
      tool_calls: [{ name: 'Read', args: { TargetFile: 'actual.ts' } }]
    })
    const output = contribution(3, 'GENERIC', {
      content: 'actual output',
      status: 'DONE'
    })
    output.previousId = call.id
    const page: IConversationRead = {
      ok: true,
      paneId: 'w:p',
      source: 'agy-transcript',
      sessionKey: 'same',
      turns: [],
      metadata: { model: null, reasoning_effort: null },
      truncated: false,
      before: 'older',
      contributions: [output]
    }
    let state = reconcileConversation(emptyConversation(), page, false)
    expect(JSON.stringify(state.turns)).toContain('Unpaired tool output')
    state = reconcileConversation(
      state,
      { ...page, before: null, contributions: [call] },
      true
    )
    expect(JSON.stringify(state.turns)).not.toContain('Unpaired tool output')
    const tool = state.turns[0].parts.find((p) => p.kind === 'tool')
    if (tool?.kind !== 'tool') throw new Error('missing tool')
    expect(tool.output).toBe('actual output')
    expect(tool.summary).toBe('actual.ts')
    state = reconcileConversation(
      state,
      { ...page, contributions: [contribution(2, 'UNKNOWN')] },
      false
    )
    expect(JSON.stringify(state.turns)).toContain('Unpaired tool output')
    expect(state.turns[0].parts.find((p) => p.kind === 'tool')).toMatchObject({
      pending: true,
      output: ''
    })
    const replacement = contribution(
      1,
      'PLANNER_RESPONSE',
      {
        tool_calls: [{ name: 'Read', args: { TargetFile: 'replacement.ts' } }]
      },
      900
    )
    state = reconcileConversation(
      state,
      { ...page, contributions: [replacement] },
      false
    )
    expect(
      state.contributions.filter((c) => c.id === 'agy-step-1')
    ).toHaveLength(1)
    const gap = reconcileConversation(
      emptyConversation(),
      { ...page, contributions: [call, { ...output, previousId: undefined }] },
      false
    )
    expect(JSON.stringify(gap.turns)).toContain('Unpaired tool output')
    expect(state.contributions.map((c) => c.id)).toEqual([
      'agy-step-1',
      'agy-step-2',
      'agy-step-3'
    ])
    for (const calls of [[{}], [{ name: 'Read', args: {} }, {}]]) {
      const invalid = contribution(1, 'PLANNER_RESPONSE', {
        thinking: 'real thinking',
        tool_calls: calls
      })
      const unpaired = reconcileConversation(
        emptyConversation(),
        { ...page, contributions: [invalid, output] },
        false
      )
      expect(JSON.stringify(unpaired.turns)).toContain('Unpaired tool output')
      expect(
        unpaired.turns[0].parts.find((p) => p.kind === 'thinking')
      ).toEqual({
        kind: 'thinking',
        text: 'real thinking',
        nativeKey: 'agy-step-1:part:0'
      })
    }
  })

  test('real Agy byte boundaries prove direct/ephemeral adjacency and reject unknown activity', async () => {
    for (const [index, intervening] of [
      'none',
      'EPHEMERAL_MESSAGE',
      'UNKNOWN'
    ].entries()) {
      const uuid = `00000000-0000-4000-8000-00000000000${index}`
      const logs = path.join(root, uuid, '.system_generated', 'logs')
      fs.mkdirSync(logs, { recursive: true })
      const rows = [
        JSON.stringify({
          step_index: 1,
          source: 'MODEL',
          type: 'PLANNER_RESPONSE',
          tool_calls: [
            {
              name: 'Read',
              args: {
                TargetFile: 'actual.ts',
                description: 'c'.repeat(240_000)
              }
            }
          ]
        })
      ]
      if (intervening !== 'none')
        rows.push(
          JSON.stringify({
            step_index: 2,
            source: 'MODEL',
            type: intervening,
            content: 'bookkeeping or activity'
          })
        )
      rows.push(
        JSON.stringify({
          step_index: 3,
          source: 'MODEL',
          type: 'GENERIC',
          status: 'DONE',
          content: 'actual-output-' + 'x'.repeat(30_000)
        })
      )
      fs.writeFileSync(path.join(logs, 'transcript.jsonl'), rows.join('\n'))
      snapshot.panes[0].agent = 'agy'
      snapshot.panes[0].agent_session = {
        source: 'herdr:antigravity_cli',
        agent: 'agy',
        kind: 'id',
        value: uuid
      }
      const agyRead = (before?: string | null) =>
        readPaneConversation('w:p', {
          before,
          deps: { brainRoot: root, fetchSnapshot: async () => snapshot }
        })
      const latest = await agyRead()
      expect(visible(latest)).toContain('Unpaired tool output')
      expect(latest.before).not.toBeNull()
      let state = reconcileConversation(emptyConversation(), latest, false)
      state = reconcileConversation(state, await agyRead(latest.before), true)
      const tool = state.turns[0].parts.find((p) => p.kind === 'tool')
      if (tool?.kind !== 'tool') throw new Error('missing native call')
      expect(tool.pending).toBe(intervening === 'UNKNOWN')
      if (intervening === 'UNKNOWN')
        expect(JSON.stringify(state.turns)).toContain('Unpaired tool output')
      else {
        expect(tool.output).toContain('actual-output-')
        expect(JSON.stringify(state.turns)).not.toContain(
          'Unpaired tool output'
        )
      }
    }
  })

  test('tool context and native snapshots reconcile before assistant grouping', async () => {
    const rows = [
      header,
      entry('u', 'user', text('real human')),
      entry(
        'call-message',
        'assistant',
        [
          {
            type: 'toolCall',
            id: 'call-id',
            name: 'Read',
            arguments: { path: 'native.ts' }
          }
        ],
        { stopReason: 'toolUse' }
      )
    ]
    for (let i = 0; i < 55; i++)
      rows.push(
        entry(`work-${i}`, 'assistant', [
          { type: 'thinking', thinking: `work-${i}` }
        ])
      )
    rows.push(
      entry('result', 'toolResult', text('real tool output'), {
        toolCallId: 'call-id',
        isError: false
      })
    )
    rows.push(
      entry('final', 'assistant', text('real final'), { stopReason: 'stop' })
    )
    fs.writeFileSync(file, rows.join('\n'))
    const newest = await read()
    expect(visible(newest)).toContain('Unpaired tool output')
    let state = reconcileConversation(emptyConversation(), newest, false)
    state = reconcileConversation(state, await read(newest.before), true)
    expect(state.turns.map((t) => t.role)).toEqual(['user', 'assistant'])
    expect(JSON.stringify(state.turns)).not.toContain('Unpaired tool output')
    const tool = state.turns[1].parts.find((p) => p.kind === 'tool')
    expect(tool?.kind).toBe('tool')
    if (tool?.kind !== 'tool') throw new Error('missing native tool')
    expect(tool.output).toBe('real tool output')
    expect(tool.pending).toBe(false)
    expect(
      state.turns[1].parts.filter(
        (p) => p.kind === 'text' && p.text === 'real final'
      )
    ).toHaveLength(1)
    fs.appendFileSync(
      file,
      '\n' +
        entry('final', 'assistant', text('replacement final'), {
          stopReason: 'stop'
        })
    )
    state = reconcileConversation(state, await read(), false)
    expect(JSON.stringify(state.turns)).not.toContain('real final')
    expect(JSON.stringify(state.turns)).toContain('replacement final')
    expect(new Set(state.contributions.map((c) => c.id)).size).toBe(
      state.contributions.length
    )
  })

  test('huge rows and partial append progress back to earlier complete material', async () => {
    fs.writeFileSync(
      file,
      [
        header,
        entry('old', 'user', text('reachable oldest user')),
        entry('huge', 'assistant', text('x'.repeat(1024 * 1024))),
        entry('answer', 'assistant', text('complete latest answer'), {
          stopReason: 'stop'
        }),
        '{"type":"message"'
      ].join('\n')
    )
    let page = await read()
    expect(visible(page)).toContain('complete latest answer')
    expect(page.truncated).toBe(true)
    const cursors = new Set<string>()
    let found = false
    for (let count = 0; count < 12 && page.before; count++) {
      expect(cursors.has(page.before)).toBe(false)
      cursors.add(page.before)
      page = await read(page.before)
      if (visible(page).includes('reachable oldest user')) found = true
    }
    expect(found).toBe(true)
    expect(page.before).toBeNull()
  })

  test('a completed append replaces its partial-row notice without losing native identity', async () => {
    const complete = entry('streamed', 'assistant', text('now complete'), {
      stopReason: 'stop'
    })
    const cut = complete.length - 7
    fs.writeFileSync(file, header + '\n' + complete.slice(0, cut))
    let state = reconcileConversation(emptyConversation(), await read(), false)
    expect(JSON.stringify(state.turns)).toContain('partial')
    fs.appendFileSync(file, complete.slice(cut))
    state = reconcileConversation(state, await read(), false)
    expect(JSON.stringify(state.turns)).toContain('now complete')
    expect(JSON.stringify(state.turns)).not.toContain('partial')
    expect(state.contributions.map((row) => row.id)).toEqual(['streamed'])
  })

  test('suppressed-only windows still advance to earlier visible rows', async () => {
    const rows = [header, entry('old', 'user', text('old visible'))]
    for (let i = 0; i < 12; i++)
      rows.push(entry(`system-${i}`, 'system', text('s'.repeat(70_000))))
    fs.writeFileSync(file, rows.join('\n'))
    let page = await read()
    expect(page.before).not.toBeNull()
    expect(page.truncated).toBe(true)
    let found = false
    for (let count = 0; count < 10 && page.before; count++) {
      page = await read(page.before)
      if (visible(page).includes('old visible')) found = true
    }
    expect(found).toBe(true)
    expect(page.before).toBeNull()
  })

  test('latest without an older cursor detects shrink and starts a fresh identity after rejection', async () => {
    const original = [
      header,
      entry('one', 'user', text('first')),
      entry('two', 'assistant', text('second'))
    ].join('\n')
    fs.writeFileSync(file, original)
    const initial = await read()
    fs.truncateSync(
      file,
      Buffer.byteLength(
        [header, entry('one', 'user', text('first'))].join('\n')
      )
    )
    await expect(read()).rejects.toThrow('Session replaced or invalid cursor')
    const refreshed = await read()
    expect(refreshed.sessionKey).not.toBe(initial.sessionKey)
    expect(visible(refreshed)).not.toContain('second')
  })

  test('rejects same-size rewrite, inode replacement and metadata drift; allows ordinary append', async () => {
    const rows = [header]
    for (let i = 0; i < 120; i++)
      rows.push(entry(`u-${i}`, 'user', text(`row-${i}`)))
    fs.writeFileSync(file, rows.join('\n'))
    const page = await read()
    const original = fs.readFileSync(file, 'utf8')
    fs.writeFileSync(file, original.replace('row-119', 'bad-119'))
    await expect(read(page.before)).rejects.toThrow(
      'Session replaced or invalid cursor'
    )
    fs.writeFileSync(file, original)
    const fresh = await read()
    fs.renameSync(file, file + '.old')
    fs.writeFileSync(file, original)
    await expect(read(fresh.before)).rejects.toThrow(
      'Session replaced or invalid cursor'
    )
    let calls = 0
    await expect(
      read(null, async () => {
        if (++calls === 2)
          fs.writeFileSync(
            path.join(dir, 'conversation.json'),
            JSON.stringify({ id, model: 'drift' })
          )
        return snapshot
      })
    ).rejects.toThrow('Session replaced or invalid cursor')
    calls = 0
    const appended = await read(null, async () => {
      if (++calls === 2)
        fs.appendFileSync(
          file,
          '\n' + entry('new', 'assistant', text('new append'))
        )
      return snapshot
    })
    expect(appended.ok).toBe(true)
  })
})
