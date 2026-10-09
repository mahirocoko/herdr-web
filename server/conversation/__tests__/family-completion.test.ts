import { describe, test, expect } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readPaneConversation } from '../conversation-reader.ts'
import { resolveFamily } from '../pi-family-resolver.ts'
import { familyContributions } from '../pi-family-parser.ts'
import { projectFamilyHistory } from '../pi-family-history.ts'
import { groupContributions } from '../../../src/types/conversation.ts'
import {
  selectedFamilySessionFiles,
  selectedProcessRoots
} from '../native-process-root.ts'
import type { ISnapshotResult } from '../../types.ts'
const json = (rows: any[]) =>
  rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
const fixture = (provider: 'omp' | 'omo' | 'gjc' | 'pi') => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-completion-')),
    root = path.join(home, `.${provider}`, 'agent', 'sessions'),
    dir = path.join(root, '--cwd--')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'native.jsonl'),
    session = {
      source: `herdr:${provider}`,
      agent: provider,
      kind: 'path',
      value: file
    }
  const pane = {
    pane_id: 'p',
    workspace_id: 'w',
    tab_id: 't',
    terminal_id: 'terminal',
    agent_status: 'idle',
    focused: false,
    agent: provider,
    agent_session: session,
    cwd: '/cwd'
  }
  const snapshot = {
    workspaces: [{ workspace_id: 'w' }],
    tabs: [{ tab_id: 't', workspace_id: 'w' }],
    panes: [pane]
  } as unknown as ISnapshotResult
  const deps = {
    fetchSnapshot: async () => snapshot,
    processRoots: async (pid: number) => ({
      pid,
      start: '1:0',
      source: 'kern-procargs2' as const,
      keys: { HOME: home, CODEX_HOME: null, CLAUDE_CONFIG_DIR: null }
    }),
    familyFiles: async () => (provider === 'gjc' ? [file] : ([] as string[])),
    nativeRpc: async (method: string, params: any) =>
      method === 'agent.get'
        ? {
            agent: {
              pane_id: params.target,
              agent: provider,
              agent_session: session
            }
          }
        : {
            process_info: {
              pane_id: params.pane_id,
              foreground_processes: [{ pid: 10, argv: [provider] }]
            }
          }
  }
  return {
    home,
    root,
    dir,
    file,
    session,
    pane,
    snapshot,
    deps,
    clean: () => fs.rmSync(home, { recursive: true, force: true })
  }
}
describe('macOS remaining native contracts — fixture evidence', () => {
  for (const provider of ['omp', 'pi', 'omo'] as const)
    test(`${provider} pending identity is empty and resets when its first file arrives`, async () => {
      const f = fixture(provider)
      try {
        if (provider === 'omo') {
          const holder = path.join(
            f.dir,
            'session-holders',
            'native',
            '10.json'
          )
          fs.mkdirSync(path.dirname(holder), { recursive: true })
          fs.writeFileSync(
            holder,
            JSON.stringify({ pid: 10, processStartedAtMs: 1000 })
          )
          f.session.value = path.join(f.dir, 'stale.jsonl')
        }
        const pending = await readPaneConversation('p', { deps: f.deps })
        expect(pending.turns).toEqual([])
        fs.writeFileSync(
          f.file,
          json([
            { type: 'session', id: 'native', cwd: '/cwd' },
            {
              type: 'message',
              id: 'u',
              parentId: null,
              message: { role: 'user', content: 'first prompt' }
            }
          ])
        )
        const page = await readPaneConversation('p', { deps: f.deps })
        expect(page.sessionKey).not.toBe(pending.sessionKey)
        expect(page.turns[0].parts).toContainEqual(
          expect.objectContaining({ text: 'first prompt' })
        )
      } finally {
        f.clean()
      }
    })
  test('GJC descriptor outranks stale breadcrumb and projects subagent file to its parent', async () => {
    const f = fixture('gjc')
    try {
      const sub = path.join(f.dir, 'native', 'task.jsonl')
      fs.mkdirSync(path.dirname(sub))
      fs.writeFileSync(
        f.file,
        json([
          { type: 'session', id: 'native', cwd: '/cwd' },
          {
            type: 'message',
            id: 'u',
            message: { role: 'user', content: 'parent' }
          }
        ])
      )
      f.session.value = path.join(f.dir, 'stale.jsonl')
      f.deps.familyFiles = async () => [sub]
      expect(
        (await readPaneConversation('p', { deps: f.deps })).turns[0].parts
      ).toContainEqual(expect.objectContaining({ text: 'parent' }))
    } finally {
      f.clean()
    }
  })
  test('stale reported GJC path is not authority without a current witness', async () => {
    const f = fixture('gjc')
    try {
      fs.writeFileSync(
        f.file,
        json([{ type: 'session', id: 'old', cwd: '/cwd' }])
      )
      f.deps.familyFiles = async () => []
      await expect(
        resolveFamily(
          'p',
          '/cwd',
          'gjc',
          { ...f.deps, familyScreen: async () => '' },
          (file) => JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0]),
          () => ({}),
          () => {
            throw new Error('No current breadcrumb')
          }
        )
      ).rejects.toThrow()
    } finally {
      f.clean()
    }
  })
  test('OmO same-CWD peer claim of the exact same file is refused', async () => {
    const f = fixture('omo')
    try {
      fs.writeFileSync(
        f.file,
        json([{ type: 'session', id: 'native', cwd: '/cwd' }])
      )
      f.snapshot.panes.push({ ...f.pane, pane_id: 'peer' })
      await expect(
        readPaneConversation('p', { deps: f.deps })
      ).rejects.toThrow()
    } finally {
      f.clean()
    }
  })
  test('relative explicit store roots use selected process HOME, never the web HOME', async () => {
    const f = fixture('pi')
    try {
      fs.writeFileSync(
        f.file,
        json([{ type: 'session', id: 'native', cwd: '/cwd' }])
      )
      const deps = { ...f.deps, familyRoots: { pi: '.pi/agent/sessions' } }
      expect((await readPaneConversation('p', { deps })).source).toBe(
        'pi-transcript'
      )
    } finally {
      f.clean()
    }
  })
  test('GJC source fallback requires one substantial native assistant answer, not title/CWD alone', async () => {
    const f = fixture('gjc'),
      answer =
        'This is a substantial native assistant response used to correlate a unique session with the visible provider screen, not to manufacture conversation roles.'
    try {
      fs.writeFileSync(
        f.file,
        json([
          { type: 'session', id: 'native', cwd: '/cwd', title: 'native' },
          {
            type: 'message',
            id: 'a',
            message: { role: 'assistant', content: answer }
          }
        ])
      )
      f.session.kind = 'id'
      f.session.value = 'native'
      const deps = {
        ...f.deps,
        familyFiles: async () => [],
        familyScreen: async () => answer
      }
      const head = (file: string) =>
        JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0])
      const witness = (file: string) => ({
        title: 'native',
        text: fs.readFileSync(file, 'utf8')
      })
      const result = await resolveFamily(
        'p',
        '/cwd',
        undefined,
        deps,
        head,
        () => ({}),
        () => {
          throw new Error('no marker')
        },
        [],
        witness
      )
      expect(result?.file).toBe(f.file)
      fs.writeFileSync(
        path.join(f.dir, 'duplicate.jsonl'),
        fs.readFileSync(f.file)
      )
      await expect(
        resolveFamily(
          'p',
          '/cwd',
          undefined,
          deps,
          head,
          () => ({}),
          () => {
            throw new Error('no marker')
          },
          [],
          witness
        )
      ).rejects.toThrow('authority')
    } finally {
      f.clean()
    }
  })
  test('OmO completion schema/title enrichment survives title records outside the displayed page', () => {
    const rows = [
      {
        type: 'message',
        id: 'title',
        message: {
          role: 'toolResult',
          toolName: 'task',
          toolCallId: 'call',
          details: { task_id: 'task1', task_summary: 'Recorded task title' },
          content: 'started'
        }
      },
      {
        type: 'custom_message',
        id: 'wake',
        display: false,
        customType: 'omo-senpi:wake',
        details: [
          {
            customType: 'senpi-task.completion',
            details: [
              {
                task_id: 'task1',
                status: 'completed',
                resolved_model: { display: 'native-model' },
                run_stats: { turns: 2, tool_calls: 4, total_tokens: 500 },
                final_response: 'Native result'
              }
            ]
          }
        ]
      }
    ]
    const bytes = Buffer.from(json(rows)),
      history = projectFamilyHistory(
        bytes.length,
        (start, length) => bytes.subarray(start, start + length),
        false
      )
    const completion = familyContributions(
      JSON.stringify(rows[1]),
      100,
      history.taskTitles
    )[0]
    expect(completion.parts).toEqual([
      {
        kind: 'task_result',
        tasks: [
          expect.objectContaining({
            id: 'task1',
            title: 'Recorded task title',
            status: 'completed',
            result: 'Native result',
            model: 'native-model',
            turns: 2,
            tool_calls: 4,
            tokens: 500
          })
        ]
      }
    ])
  })
  test('PI abandoned counts and recorded branch summary exclude active turns', () => {
    const bytes = Buffer.from(
      json([
        { type: 'session', id: 'session' },
        {
          type: 'message',
          id: 'u',
          parentId: null,
          message: { role: 'user', content: 'ask' }
        },
        {
          type: 'message',
          id: 'old',
          parentId: 'u',
          message: { role: 'assistant', content: 'old' }
        },
        {
          type: 'branch_summary',
          id: 'summary',
          parentId: 'u',
          summary: 'Native account of the abandoned branch'
        },
        {
          type: 'message',
          id: 'new',
          parentId: 'summary',
          message: { role: 'assistant', content: 'new' }
        }
      ])
    )
    const history = projectFamilyHistory(
      bytes.length,
      (start, length) => bytes.subarray(start, start + length),
      true
    )
    expect(history.abandoned).toEqual({
      count: 1,
      branches: 1,
      summary: 'Native account of the abandoned branch'
    })
  })
  test('native tool images attach to the matching call, not an unrelated assistant bubble', () => {
    const rows = [
      {
        type: 'message',
        id: 'a',
        message: {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'call', name: 'read', arguments: {} }
          ]
        }
      },
      {
        type: 'message',
        id: 'r',
        message: {
          role: 'toolResult',
          toolCallId: 'call',
          content: [{ type: 'image', mimeType: 'image/png', data: 'native' }]
        }
      }
    ].flatMap((row, index) => familyContributions(JSON.stringify(row), index))
    const parts = groupContributions(rows)[0].parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({
      kind: 'tool',
      images: [{ kind: 'image', media_type: 'image/png' }]
    })
  })
  test('actual macOS descriptor helper returns only in-root session files for an owned child', async () => {
    if (process.platform !== 'darwin') return
    const f = fixture('pi')
    fs.writeFileSync(
      f.file,
      json([{ type: 'session', id: 'native', cwd: '/cwd' }])
    )
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `require('node:fs').openSync(process.argv[1],'r');console.log('ready');setInterval(()=>{},1000)`,
        f.file
      ],
      { env: { HOME: f.home }, stdout: 'pipe', stderr: 'ignore' }
    )
    try {
      await child.stdout.getReader().read()
      const roots = await selectedProcessRoots(child.pid, true)
      expect(
        await selectedFamilySessionFiles(child.pid, f.root, roots.start)
      ).toEqual([f.file])
      await expect(
        selectedFamilySessionFiles(child.pid, f.root, '1:0')
      ).rejects.toThrow()
    } finally {
      child.kill()
      await child.exited
      f.clean()
    }
  })
})
