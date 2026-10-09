import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readPaneConversation } from '../conversation-reader.ts'
import type { ISnapshotResult } from '../../types.ts'

describe('server conversation reader', () => {
  let tempDir: string
  let brainRoot: string
  let lettaRoot: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-conv-test-'))
    brainRoot = path.join(tempDir, 'brain')
    lettaRoot = path.join(tempDir, 'letta')
    fs.mkdirSync(brainRoot, { recursive: true })
    fs.mkdirSync(lettaRoot, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const mockSnapshot = (panes: any[]): ISnapshotResult => ({
    protocol: 22,
    version: '0.9.3',
    workspaces: [
      {
        workspace_id: 'w1',
        label: 'test-ws',
        number: 1,
        agent_status: 'working',
        tab_count: 1,
        pane_count: panes.length,
        focused: true,
        active_tab_id: 't1',
        tokens: {}
      }
    ],
    tabs: [
      {
        tab_id: 't1',
        workspace_id: 'w1',
        number: 1,
        label: 'tab-1',
        agent_status: 'working',
        pane_count: panes.length,
        focused: true
      }
    ],
    panes: panes.map((p) => ({
      pane_id: p.id || p.pane_id,
      workspace_id: 'w1',
      tab_id: 't1',
      agent_status: p.agent_status || 'working',
      focused: true,
      cwd: p.cwd || '/tmp',
      ...p
    }))
  })

  test('fails closed with 404 when pane is not in snapshot', async () => {
    const snapshot = mockSnapshot([])
    await expect(
      readPaneConversation('p-missing', {
        deps: {
          fetchSnapshot: async () => snapshot,
          brainRoot,
          lettaRoot
        }
      })
    ).rejects.toThrow("Pane 'p-missing' not found")
  })

  test('fails closed with 400 when pane is a bare shell without agent evidence', async () => {
    const snapshot = mockSnapshot([
      {
        id: 'p-shell',
        tab_id: 't1',
        workspace_id: 'w1',
        terminal_id: 'term-1',
        number: 1,
        label: 'shell',
        is_agent: false,
        agent_status: 'idle',
        command: 'zsh',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
        focused: true
      }
    ])

    await expect(
      readPaneConversation('p-shell', {
        deps: {
          fetchSnapshot: async () => snapshot,
          brainRoot,
          lettaRoot
        }
      })
    ).rejects.toThrow("Pane 'p-shell' is not an agent pane")
  })

  test('reads and paginates Agy transcript from verified brain root', async () => {
    const agyUuid = '0a41b80b-404a-4593-8309-d4803200be95'
    const sessionDir = path.join(
      brainRoot,
      agyUuid,
      '.system_generated',
      'logs'
    )
    fs.mkdirSync(sessionDir, { recursive: true })

    const rows: string[] = []
    for (let i = 0; i < 60; i++) {
      rows.push(
        JSON.stringify({
          step_index: i * 2,
          type: 'USER_INPUT',
          source: 'USER_EXPLICIT',
          content: `User turn ${i}`
        })
      )
      rows.push(
        JSON.stringify({
          step_index: i * 2 + 1,
          type: 'PLANNER_RESPONSE',
          source: 'MODEL',
          content: `Assistant answer ${i}`
        })
      )
    }
    fs.writeFileSync(path.join(sessionDir, 'transcript.jsonl'), rows.join('\n'))

    const snapshot = mockSnapshot([
      {
        id: 'p-agy',
        tab_id: 't1',
        workspace_id: 'w1',
        terminal_id: 'term-2',
        number: 1,
        label: 'agy',
        is_agent: true,
        agent_status: 'working',
        agent_session: {
          source: 'herdr:antigravity_cli',
          agent: 'agy',
          kind: 'id',
          value: agyUuid
        },
        command: 'agy',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
        focused: true
      }
    ])

    // First read: newest page (50 turns)
    const readLatest = await readPaneConversation('p-agy', {
      deps: {
        fetchSnapshot: async () => snapshot,
        brainRoot,
        lettaRoot
      }
    })

    expect(readLatest.ok).toBe(true)
    expect(readLatest.source).toBe('agy-transcript')
    expect(readLatest.sessionKey).toMatch(/^[a-f0-9]{64}$/)
    expect(readLatest.turns.length).toBe(50)
    expect(readLatest.before).not.toBeNull()

    // Second read: older page using before cursor
    const readOlder = await readPaneConversation('p-agy', {
      before: readLatest.before,
      deps: {
        fetchSnapshot: async () => snapshot,
        brainRoot,
        lettaRoot
      }
    })

    expect(readOlder.ok).toBe(true)
    expect(readOlder.turns.length).toBe(50)

    // Older page again
    const readOldest = await readPaneConversation('p-agy', {
      before: readOlder.before,
      deps: {
        fetchSnapshot: async () => snapshot,
        brainRoot,
        lettaRoot
      }
    })
    expect(readOldest.ok).toBe(true)
    expect(readOldest.turns.length).toBe(20) // Remaining 20 turns (total 120 turns)
    expect(readOldest.before).toBeNull() // Reached beginning

    const readCursor = () =>
      readPaneConversation('p-agy', {
        before: readLatest.before,
        deps: { fetchSnapshot: async () => snapshot, brainRoot, lettaRoot }
      })
    snapshot.panes[0].terminal_id = 'replacement-terminal'
    await expect(readCursor()).rejects.toThrow(
      'Session replaced or invalid cursor'
    )
    snapshot.panes[0].terminal_id = 'term-2'
    const transcript = path.join(sessionDir, 'transcript.jsonl')
    const backup = path.join(sessionDir, 'original.jsonl')
    fs.renameSync(transcript, backup)
    fs.writeFileSync(transcript, rows.join('\n'))
    await expect(readCursor()).rejects.toThrow(
      'Session replaced or invalid cursor'
    )
    fs.rmSync(transcript)
    fs.renameSync(backup, transcript)
    fs.truncateSync(transcript, 1)
    await expect(readCursor()).rejects.toThrow(
      'Session replaced or invalid cursor'
    )
    fs.writeFileSync(transcript, rows.join('\n'))
    const realLogs = path.join(path.dirname(sessionDir), 'real-logs')
    fs.renameSync(sessionDir, realLogs)
    fs.symlinkSync(realLogs, sessionDir)
    await expect(readCursor()).rejects.toThrow('Transcript unavailable')
  })

  test('rejects older cursor with 409 history_changed when session changes', async () => {
    const uuid1 = '0a41b80b-404a-4593-8309-d4803200be95'
    const uuid2 = '11111111-2222-3333-4444-555555555555'

    const sessionDir1 = path.join(brainRoot, uuid1, '.system_generated', 'logs')
    fs.mkdirSync(sessionDir1, { recursive: true })
    fs.writeFileSync(
      path.join(sessionDir1, 'transcript.jsonl'),
      JSON.stringify({
        step_index: 0,
        type: 'USER_INPUT',
        source: 'USER_EXPLICIT',
        content: 'hello'
      })
    )

    const snapshot1 = mockSnapshot([
      {
        id: 'p-switch',
        tab_id: 't1',
        workspace_id: 'w1',
        terminal_id: 'term-s',
        number: 1,
        label: 'agy',
        is_agent: true,
        agent_status: 'working',
        agent_session: {
          source: 'herdr:antigravity_cli',
          agent: 'agy',
          kind: 'id',
          value: uuid1
        },
        command: 'agy',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
        focused: true
      }
    ])

    const initial = await readPaneConversation('p-switch', {
      deps: {
        fetchSnapshot: async () => snapshot1,
        brainRoot,
        lettaRoot
      }
    })
    expect(initial.sessionKey).toMatch(/^[a-f0-9]{64}$/)

    // Cursor bound to uuid1
    const cursor = Buffer.from(
      JSON.stringify({ sessionKey: uuid1, turnIndex: 10 })
    ).toString('base64url')

    // Now snapshot has uuid2
    const snapshot2 = mockSnapshot([
      {
        id: 'p-switch',
        tab_id: 't1',
        workspace_id: 'w1',
        terminal_id: 'term-s',
        number: 1,
        label: 'agy',
        is_agent: true,
        agent_status: 'working',
        agent_session: {
          source: 'herdr:antigravity_cli',
          agent: 'agy',
          kind: 'id',
          value: uuid2
        },
        command: 'agy',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
        focused: true
      }
    ])

    await expect(
      readPaneConversation('p-switch', {
        before: cursor,
        deps: {
          fetchSnapshot: async () => snapshot2,
          brainRoot,
          lettaRoot
        }
      })
    ).rejects.toThrow('Session replaced or invalid cursor')
  })

  test('reads Letta conversation via scope fingerprint and verifies manifest', async () => {
    const convId = 'local-conv-649'
    const lettaScope = crypto
      .createHash('sha256')
      .update(convId)
      .digest('hex')
      .slice(0, 16)
    const dirName = Buffer.from(`conversation:${convId}`).toString('base64url')
    const convDir = path.join(lettaRoot, dirName)
    fs.mkdirSync(convDir, { recursive: true })

    fs.writeFileSync(
      path.join(convDir, 'conversation.json'),
      JSON.stringify({ id: convId, model: 'gpt-4o' })
    )
    fs.writeFileSync(
      path.join(convDir, 'manifest.json'),
      JSON.stringify({
        schema_version: 2,
        message_format: 'pi-session-entry-jsonl',
        provider_stack: 'pi-ai'
      })
    )
    fs.writeFileSync(
      path.join(convDir, 'messages.jsonl'),
      [
        JSON.stringify({ type: 'session', version: 3, id: convId }),
        JSON.stringify({
          type: 'message',
          message: {
            id: 'm1',
            role: 'user',
            content: [{ type: 'text', text: 'สวัสดีครับ' }]
          }
        }),
        JSON.stringify({
          type: 'message',
          message: {
            id: 'm2',
            role: 'assistant',
            content: [{ type: 'text', text: 'สวัสดีครับ มีอะไรให้ช่วยไหม' }],
            stopReason: 'stop'
          }
        })
      ].join('\n')
    )

    const snapshot = mockSnapshot([
      {
        id: 'p-letta',
        agent: 'letta',
        tab_id: 't1',
        workspace_id: 'w1',
        terminal_id: 'term-l',
        number: 1,
        label: 'letta',
        is_agent: true,
        agent_status: 'working',
        tokens: {
          letta_scope: lettaScope
        },
        command: 'letta',
        cwd: '/tmp',
        cols: 80,
        rows: 24,
        focused: true
      }
    ])

    const res = await readPaneConversation('p-letta', {
      deps: {
        fetchSnapshot: async () => snapshot,
        brainRoot,
        lettaRoot
      }
    })

    expect(res.ok).toBe(true)
    expect(res.source).toBe('letta-transcript')
    expect(res.sessionKey).toMatch(/^[a-f0-9]{64}$/)
    expect(res.turns.length).toBe(2)
    expect(res.turns[0].parts[0]).toEqual({
      kind: 'text',
      text: 'สวัสดีครับ',
      nativeKey: 'm1:part:0'
    })
    expect(res.turns[1].parts[0]).toEqual({
      kind: 'text',
      text: 'สวัสดีครับ มีอะไรให้ช่วยไหม',
      nativeKey: 'm2:part:0',
      phase: 'final_answer'
    })
    const read = () =>
      readPaneConversation('p-letta', {
        deps: { fetchSnapshot: async () => snapshot, brainRoot, lettaRoot }
      })
    fs.writeFileSync(
      path.join(convDir, 'messages.jsonl'),
      JSON.stringify({ type: 'session', version: 3, id: 'wrong' })
    )
    await expect(read()).rejects.toThrow('Invalid transcript header')
    fs.writeFileSync(
      path.join(convDir, 'messages.jsonl'),
      JSON.stringify({ type: 'session', version: 2, id: convId })
    )
    await expect(read()).rejects.toThrow('Invalid transcript header')
    fs.rmSync(path.join(convDir, 'manifest.json'))
    await expect(read()).rejects.toThrow('Transcript manifest missing')
    snapshot.panes[0].agent = 'codex'
    await expect(read()).rejects.toThrow('No supported agent transcript')
  })
})
