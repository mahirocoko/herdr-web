import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  closeCursorReplayHelpers,
  CursorFrames,
  cursorIdentity,
  readCursorReplay,
  rememberCursorFailure
} from '../cursor-acp.ts'
import type { ISnapshotResult } from '../../types.ts'

const fixture = () => {
  const session = {
    value: 'native-session',
    agent: 'cursor',
    kind: 'id',
    source: 'herdr:cursor'
  }
  const pane = {
    pane_id: 'p1',
    terminal_id: 't1',
    workspace_id: 'w1',
    tab_id: 'tab1',
    agent: 'cursor',
    agent_session: session,
    cwd: process.cwd()
  }
  const agent = { ...pane, interactive_ready: true, agent_status: 'idle' }
  const info = {
    pane_id: 'p1',
    shell_pid: 1,
    foreground_process_group_id: 20,
    foreground_processes: [
      { pid: 20, argv: ['/fixture/cursor-agent'], cwd: process.cwd() }
    ]
  }
  const snapshot = {
    panes: [pane],
    agents: [{ ...pane, target: 'p1' }]
  } as unknown as ISnapshotResult
  const deps = {
    nativeRpc: async (method: string) =>
      method === 'agent.get' ? { agent } : { process_info: info },
    processRoots: async (pid: number) => ({
      pid,
      start: '123:456',
      source: 'kern-procargs2' as const,
      keys: {
        HOME: process.env.HOME!,
        CODEX_HOME: null,
        CLAUDE_CONFIG_DIR: null
      }
    })
  }
  return { snapshot, deps, pane, agent, info }
}
describe('Cursor native authority (fixtures, not live proof)', () => {
  test('stable opaque identity, process generation changes identity', async () => {
    const f = fixture()
    const first = await cursorIdentity(f.snapshot, 'p1', f.deps)
    expect(first.key).toMatch(/^[a-f0-9]{64}$/)
    expect(first.key).not.toContain('native-session')
    f.deps.processRoots = async (pid) => ({
      pid,
      start: '123:457',
      source: 'kern-procargs2',
      keys: {
        HOME: process.env.HOME!,
        CODEX_HOME: null,
        CLAUDE_CONFIG_DIR: null
      }
    })
    expect((await cursorIdentity(f.snapshot, 'p1', f.deps)).key).not.toBe(
      first.key
    )
  })
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => {
      f.agent.terminal_id = 'other'
    },
    (f: ReturnType<typeof fixture>) => {
      f.agent.agent_session = { ...f.agent.agent_session, source: 'injected' }
    },
    (f: ReturnType<typeof fixture>) => {
      ;(f.pane.agent_session as any).id = 'contradiction'
    },
    (f: ReturnType<typeof fixture>) => {
      ;(f.agent.agent_session as any).kind = 'path'
    },
    (f: ReturnType<typeof fixture>) => {
      f.info.foreground_process_group_id = 1
    },
    (f: ReturnType<typeof fixture>) => {
      f.info.foreground_processes.push(f.info.foreground_processes[0])
    },
    (f: ReturnType<typeof fixture>) => {
      f.info.foreground_processes[0].argv = ['cursor-agent']
    },
    (f: ReturnType<typeof fixture>) => {
      f.agent.cwd = '/'
    },
    (f: ReturnType<typeof fixture>) => {
      f.info.foreground_processes[0].cwd = '/'
    },
    (f: ReturnType<typeof fixture>) => {
      delete (f.info.foreground_processes[0] as any).cwd
    },
    (f: ReturnType<typeof fixture>) => {
      f.snapshot.agents = []
      ;(f.pane as any).agent_session = undefined
    },
    (f: ReturnType<typeof fixture>) => {
      ;(f.snapshot.agents![0] as any).target = 'other'
    }
  ])
    test('rejects contradictory or missing ownership', async () => {
      const f = fixture()
      mutate(f)
      await expect(cursorIdentity(f.snapshot, 'p1', f.deps)).rejects.toThrow()
    })
})
describe('Cursor NDJSON framing', () => {
  test('fragmented UTF-8 and multiple frames', () => {
    const parser = new CursorFrames(),
      rows: any[] = []
    const bytes = Buffer.from(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ไทย' }) + '\n'
    )
    for (const byte of bytes)
      parser.accept(Buffer.from([byte]), (row) => rows.push(row))
    expect(rows).toEqual([{ jsonrpc: '2.0', id: 1, result: 'ไทย' }])
  })
  for (const bytes of [
    Buffer.from('{bad}\n'),
    Buffer.from('{"jsonrpc":"1.0"}\n'),
    Buffer.from([0xff, 10]),
    Buffer.alloc(1024 * 1024 + 1, 65),
    Buffer.from('[]\n')
  ]) {
    test('rejects malformed, invalid UTF-8 or oversized input', () => {
      expect(() => new CursorFrames().accept(bytes, () => {})).toThrow()
    })
  }
})

describe('Cursor transport fixtures — never installed providers/live evidence', () => {
  test('all failure paths share the 32-entry bound, including refreshed keys', () => {
    const cache = new Map<string, number>()
    for (let index = 0; index < 40; index++) {
      rememberCursorFailure(cache, `fixture-${index}`, index)
      expect(cache.size).toBeLessThanOrEqual(32)
    }
    expect(cache.size).toBe(32)
    expect(cache.has('fixture-0')).toBe(false)
    rememberCursorFailure(cache, 'fixture-39', 99)
    expect(cache.size).toBe(32)
    expect(cache.get('fixture-39')).toBe(99)
  })

  for (const mode of ['same-buffer-error', 'delayed-error', 'null-error']) {
    test(`protocol failure cannot become successful replay/cache: ${mode}`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'herdr-cursor-error-fixture-'))
      const executable = join(dir, 'cursor-agent')
      const trigger = join(dir, 'emit-error')
      writeFileSync(
        executable,
        `#!/usr/bin/env node
const fs = require('node:fs')
const readline = require('node:readline')
const send = row => JSON.stringify({ jsonrpc: '2.0', ...row }) + '\\n'
readline.createInterface({ input: process.stdin }).on('line', line => {
 const row = JSON.parse(line)
 if (row.method === 'initialize') process.stdout.write(send({ id: row.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } }))
 if (row.method === 'session/load') {
  const text = send({ method: 'session/update', params: { sessionId: row.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'fixture-only text' } } } })
  const response = send(${JSON.stringify(mode)} === 'null-error' ? { id: row.id, error: null } : { id: row.id, result: {} })
  process.stdout.write(text + response + (${JSON.stringify(mode)} === 'same-buffer-error' ? '{broken}\\n' : ''))
  if (${JSON.stringify(mode)} === 'delayed-error') fs.watchFile(${JSON.stringify(trigger)}, { interval: 10 }, () => {
   if (fs.existsSync(${JSON.stringify(trigger)})) { fs.unwatchFile(${JSON.stringify(trigger)}); process.stdout.write('{broken}\\n') }
  })
 }
})
`,
        { mode: 0o700 }
      )
      const f = fixture()
      f.info.foreground_processes[0].argv = [executable]
      const read = () =>
        readCursorReplay(f.snapshot, 'p1', async () => f.snapshot, f.deps)
      try {
        if (mode === 'delayed-error') {
          expect((await read()).turns).toHaveLength(1)
          writeFileSync(trigger, '')
          await Bun.sleep(150)
        }
        await expect(read()).rejects.toThrow('Cursor text replay unavailable')
        await expect(read()).rejects.toThrow('Cursor text replay unavailable')
      } finally {
        closeCursorReplayHelpers(true)
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }

  for (const force of [false, true]) {
    test(`coalesces replay, denies client tools and cleans owned descendants (force=${force})`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'herdr-cursor-fixture-'))
      const executable = join(dir, 'cursor-agent')
      const state = join(dir, 'state.json')
      writeFileSync(
        executable,
        `#!/usr/bin/env node
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const readline = require('node:readline')
const report = { pid: process.pid, methods: [], denied: [], child: null, ownerContext: Object.keys(process.env).some(k => /^(HERDR_|ORCA_|LETTA_|AGENT_HALO_)/.test(k)) }
const save = () => fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify(report))
const send = row => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...row }) + '\\n')
let load
readline.createInterface({ input: process.stdin }).on('line', line => {
 const row = JSON.parse(line)
 if (!row.method) {
  report.denied.push(row); save()
  if (report.denied.length === 2) {
   send({ method: 'session/update', params: { sessionId: load.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'fixture-only text' } } } })
   send({ id: load.id, result: {} })
  }
  return
 }
 report.methods.push(row.method); save()
 if (row.method === 'initialize') send({ id: row.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } })
 else if (row.method === 'session/load') {
  load = row
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); process.send("ready"); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  child.once('message', () => {
   report.child = child.pid; save()
   send({ id: 'fixture-fs', method: 'fs/read_text_file', params: { path: '/fixture/denied' } })
   send({ id: 'fixture-permission', method: 'session/request_permission', params: {} })
  })
 }
})
`,
        { mode: 0o700 }
      )
      const f = fixture()
      f.info.foreground_processes[0].argv = [executable]
      try {
        const read = () =>
          readCursorReplay(f.snapshot, 'p1', async () => f.snapshot, f.deps)
        const [first, second] = await Promise.all([read(), read()])
        expect(first).toEqual(second)
        expect(first.source).toBe('cursor-acp-replay')
        expect(first.turns[0]?.parts).toEqual([
          { kind: 'text', text: 'fixture-only text' }
        ])
        expect(first.turns[0]?.ts).toBeNull()
        expect(first).not.toHaveProperty('range')
        expect(first).not.toHaveProperty('contributions')
        await read()
        const record = JSON.parse(readFileSync(state, 'utf8'))
        expect(record.methods).toEqual(['initialize', 'session/load'])
        expect(record.ownerContext).toBe(false)
        expect(record.denied).toEqual([
          {
            jsonrpc: '2.0',
            id: 'fixture-fs',
            error: { code: -32601, message: 'Read-only client' }
          },
          {
            jsonrpc: '2.0',
            id: 'fixture-permission',
            result: { outcome: { outcome: 'cancelled' } }
          }
        ])
        closeCursorReplayHelpers(force)
        let alive = true
        const deadline = Date.now() + (force ? 700 : 2200)
        while (alive && Date.now() < deadline) {
          await Bun.sleep(25)
          try {
            process.kill(record.child, 0)
          } catch {
            alive = false
          }
        }
        expect(alive).toBe(false)
      } finally {
        closeCursorReplayHelpers(true)
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
