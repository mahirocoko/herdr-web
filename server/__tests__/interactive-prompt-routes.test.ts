import { describe, expect, it } from 'bun:test'
import { createServer } from '../index.ts'
import { OperationCoordinator } from '../operation-coordinator.ts'
import type { ISnapshotResult } from '../types.ts'

const approval = (command = 'echo first', row = 0) =>
  `Would you like to run the following command?\n${command}\n${row === 0 ? '›' : ' '} 1. Yes, proceed\n${row === 1 ? '›' : ' '} 2. No, cancel\nPress enter to confirm or esc to cancel\n`
const snapshot = (): ISnapshotResult => ({
  protocol: 22,
  version: '0.9.3',
  workspaces: [],
  tabs: [],
  panes: [
    {
      pane_id: 'w1:p1',
      terminal_id: 't1',
      workspace_id: 'w1',
      tab_id: 'tab1',
      agent: 'codex',
      agent_status: 'blocked',
      agent_session: {
        value: 's1',
        source: 'native',
        agent: 'codex',
        kind: 'id'
      },
      cwd: '/synthetic',
      focused: false
    }
  ]
})
const fixture = (
  extra: {
    screen?: string
    keys?: (keys: string[]) => Promise<void>
    read?: () => void
    nativeEvidence?: import('../interactive-prompt.ts').IPromptDeps['nativeEvidence']
  } = {}
) => {
  let screen = extra.screen ?? approval()
  const snap = snapshot()
  const sends: string[][] = []
  let reads = 0
  const coordinator = new OperationCoordinator()
  const server = createServer(0, '127.0.0.1', {
    startPushBridge: false,
    deps: {
      coordinator,
      fetchSnapshot: async () => snap,
      promptDeps: {
        nativeEvidence: extra.nativeEvidence,
        readScreen: async () => {
          reads++
          extra.read?.()
          return screen
        },
        keys: async (_pane, keys) => {
          sends.push(keys)
          if (extra.keys) await extra.keys(keys)
          else if (keys[0] === 'down') screen = approval('echo first', 1)
        },
        text: async () => {
          throw new Error('Unexpected text')
        }
      }
    }
  })
  const request = (route: string, body?: unknown, forbidden = false) =>
    fetch(`http://127.0.0.1:${server.port}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        host: forbidden ? 'evil.example' : `127.0.0.1:${server.port}`,
        origin: forbidden
          ? 'https://evil.example'
          : `http://127.0.0.1:${server.port}`,
        'content-type': 'application/json'
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  const read = async () => {
    const response = await request('/api/pane/prompt?pane=w1:p1')
    expect(response.status).toBe(200)
    return response.json()
  }
  return {
    server,
    snap,
    sends,
    request,
    read,
    coordinator,
    reads: () => reads,
    setScreen: (value: string) => {
      screen = value
    }
  }
}
const action = (
  read: any,
  answer = { option_index: 0 },
  operationId = 'operation-1'
) => ({
  type: 'prompt-answer',
  operationId,
  target: read.target,
  promptId: read.prompt.id,
  answer
})
describe('actual interactive prompt HTTP/action pipeline', () => {
  it('auth precedes query/body parsing and all prompt IO', async () => {
    const f = fixture()
    try {
      expect(
        (await f.request('/api/pane/prompt?pane=invalid', undefined, true))
          .status
      ).toBe(403)
      expect(
        (await f.request('/api/action', { type: 'prompt-answer' }, true)).status
      ).toBe(403)
      expect(f.reads()).toBe(0)
    } finally {
      f.server.stop(true)
    }
  })
  it('GET exposes browser prompt, never private responders/steps/native keys', async () => {
    const f = fixture()
    try {
      const read = await f.read()
      expect(read.prompt.kind).toBe('approval')
      expect(read.prompt.id).toMatch(/^[a-f0-9]{64}$/)
      for (const field of [
        'responder',
        'optionSteps',
        'selectedIndex',
        'customSteps',
        'checkedOptionIndices'
      ])
        expect(read.prompt[field]).toBeUndefined()
      expect(read.target.agentSessionId).toBe('s1')
    } finally {
      f.server.stop(true)
    }
  })
  it('typed answer traverses existing coordinator pipeline and duplicate IDs replay without IO', async () => {
    const f = fixture()
    try {
      const read = await f.read()
      const body = action(read)
      const result = await f.request('/api/action', body)
      expect(await result.json()).toMatchObject({
        ok: true,
        outcome: 'acknowledged'
      })
      expect(f.sends).toEqual([['enter']])
      const reads = f.reads()
      expect((await f.request('/api/action', body)).status).toBe(200)
      expect(f.reads()).toBe(reads)
      expect(f.sends).toHaveLength(1)
      expect(
        (
          await f.request('/api/action', {
            ...body,
            answer: { option_index: 1 }
          })
        ).status
      ).toBe(409)
      expect(f.coordinator.getActiveAttemptsCountForTesting()).toBe(0)
    } finally {
      f.server.stop(true)
    }
  })
  it('source hash invalidates changed command beyond display clipping with no native send', async () => {
    const f = fixture({ screen: approval('x'.repeat(12010) + 'A') })
    try {
      const read = await f.read()
      f.setScreen(approval('x'.repeat(12010) + 'B'))
      const result = await f.request('/api/action', action(read))
      expect(result.status).toBe(409)
      expect((await result.json()).outcome).toBe('rejected')
      expect(f.sends).toEqual([])
    } finally {
      f.server.stop(true)
    }
  })
  it('wrong landed row suppresses confirm; partial navigation is cached unknown, not replayed', async () => {
    const f = fixture({
      screen:
        '✨ Update available! 0.146.0 -> 0.146.1\n› 1. Update now\n  2. Skip\n  3. Skip until next version\nPress enter to continue\n',
      keys: async () => {}
    })
    try {
      const read = await f.read()
      const body = action(read, { option_index: 1 })
      const result = await f.request('/api/action', body)
      expect((await result.json()).outcome).toBe('unknown')
      expect(f.sends).toEqual([['down']])
      await f.request('/api/action', body)
      expect(f.sends).toEqual([['down']])
    } finally {
      f.server.stop(true)
    }
  })
  it('lost native acknowledgement stops all later steps and invalidates the occurrence', async () => {
    const f = fixture({
      screen:
        '✨ Update available! 0.146.0 -> 0.146.1\n› 1. Update now\n  2. Skip\n  3. Skip until next version\nPress enter to continue\n',
      keys: async () => {
        throw new Error('ack lost')
      }
    })
    try {
      const read = await f.read()
      const result = await f.request(
        '/api/action',
        action(read, { option_index: 1 })
      )
      expect((await result.json()).outcome).toBe('unknown')
      expect(f.sends).toEqual([['down']])
      const next = await f.read()
      expect(next.prompt.id).not.toBe(read.prompt.id)
    } finally {
      f.server.stop(true)
    }
  })
  it('recognized idle menus are usable; idle unknown screen has no fallback answer', async () => {
    const f = fixture({
      screen:
        '✨ Update available! 0.146.0 -> 0.146.1\n› 1. Update now\n  2. Skip\n  3. Skip until next version\nPress enter to continue\n'
    })
    f.snap.panes[0]!.agent_status = 'idle'
    try {
      const read = await f.read()
      expect(read.prompt.kind).toBe('menu')
      expect((await f.request('/api/action', action(read))).status).toBe(200)
      f.setScreen('Regular idle input >')
      expect((await f.read()).prompt).toBeNull()
    } finally {
      f.server.stop(true)
    }
  })
  it('new intent validator rejects native keys, shell target, extra fields and byte overflow before IO', async () => {
    const f = fixture()
    try {
      const read = await f.read()
      const reads = f.reads()
      for (const body of [
        { ...action(read), answer: { keys: ['enter'] } },
        { ...action(read), keys: ['enter'] },
        {
          ...action(read),
          target: {
            ...read.target,
            expectedMode: 'shell',
            agentSessionId: undefined
          }
        },
        { ...action(read), answer: { custom_text: 'ก'.repeat(1366) } }
      ])
        expect([400, 413]).toContain(
          (await f.request('/api/action', body)).status
        )
      expect(f.reads()).toBe(reads)
      expect(f.sends).toEqual([])
    } finally {
      f.server.stop(true)
    }
  })
  it('blocked unknown agent screens retain a source fallback answer, never a shell bypass', async () => {
    const f = fixture({ screen: 'Unknown confirmation?\nPress Enter or Esc\n' })
    try {
      const read = await f.read()
      expect(read.prompt.fallback).toBe(true)
      expect((await f.request('/api/action', action(read))).status).toBe(200)
      expect(f.sends).toEqual([['enter']])
      f.snap.panes[0]!.agent = 'shell'
      f.snap.panes[0]!.agent_session = null
      expect((await f.request('/api/pane/prompt?pane=w1:p1')).status).toBe(409)
    } finally {
      f.server.stop(true)
    }
  })
  it('session replacement immediately after a screen read cannot dispatch an answer', async () => {
    let replace = false
    const f = fixture({
      read: () => {
        if (replace) f.snap.panes[0]!.agent_session!.value = 's2'
      }
    })
    try {
      const read = await f.read()
      replace = true
      expect((await f.request('/api/action', action(read))).status).toBe(409)
      expect(f.sends).toEqual([])
    } finally {
      f.server.stop(true)
    }
  })
  it('collapsed Codex queue uses injected native IDs and verifies the actual opened question', async () => {
    const collapsed =
      '• Queued follow-up inputs\n  ? 1 question · 8s\n    alt+↑ to answer\n› Ask Codex to do anything\n'
    const opened =
      '• Queued follow-up inputs\nWhich split?\n› 1. train\n  2. test\n  3. Other\nenter submit   ctrl+] skip   alt+↓ main prompt\n'
    const f = fixture({
      screen: collapsed,
      nativeEvidence: async () => ({
        binding: 'exact-native-session',
        source: 'codex-transcript',
        omo: [],
        codex: [
          {
            key: 'older-native-call:0',
            title: 'Different split?',
            options: ['train', 'test']
          },
          {
            key: 'native-call:0',
            title: 'Which split?',
            options: ['train', 'test']
          }
        ]
      }),
      keys: async (keys) => {
        if (keys[0] === 'alt+up') f.setScreen(opened)
        if (keys[0] === 'enter') f.setScreen('› Ask Codex to do anything\n')
      }
    })
    try {
      const read = await f.read()
      expect(read.prompt.queued).toBe('collapsed')
      expect(JSON.stringify(read)).not.toContain('native-call')
      const result = await f.request('/api/action', action(read))
      expect(await result.json()).toMatchObject({
        ok: true,
        outcome: 'acknowledged'
      })
      expect(f.sends).toEqual([['alt+up'], ['enter']])
    } finally {
      f.server.stop(true)
    }
  })
  it('wrong native queued front is closed under the same claim and never answered', async () => {
    const collapsed =
      '• Queued follow-up inputs\n  ? 1 question\n    alt+↑ to answer\n› Ask Codex to do anything\n'
    const opened =
      '• Queued follow-up inputs\nDifferent split?\n› 1. train\n  2. test\n  3. Other\nenter submit   ctrl+] skip   alt+↓ main prompt\n'
    const f = fixture({
      screen: collapsed,
      nativeEvidence: async () => ({
        binding: 'exact-native-session',
        source: 'codex-transcript',
        omo: [],
        codex: [
          {
            key: 'older-native-call:0',
            title: 'Different split?',
            options: ['train', 'test']
          },
          {
            key: 'native-call:0',
            title: 'Which split?',
            options: ['train', 'test']
          }
        ]
      }),
      keys: async (keys) => {
        if (keys[0] === 'alt+up') f.setScreen(opened)
        if (keys[0] === 'alt+down') f.setScreen(collapsed)
      }
    })
    try {
      const read = await f.read()
      const result = await f.request('/api/action', action(read))
      expect((await result.json()).outcome).toBe('unknown')
      expect(f.sends).toEqual([['alt+up'], ['alt+down']])
      expect((await f.read()).prompt.question).toBe('Different split?')
      expect(f.coordinator.getPaneClaimsCountForTesting()).toBe(0)
    } finally {
      f.server.stop(true)
    }
  })

  it('holds the one pane/topology claim through in-flight native IO', async () => {
    let release!: () => void
    let entered!: () => void
    const entering = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const f = fixture({
      keys: async () => {
        entered()
        await gate
      }
    })
    try {
      const read = await f.read()
      const pending = f.request('/api/action', action(read))
      await entering
      expect(f.coordinator.getPaneClaimsCountForTesting()).toBe(1)
      expect(f.coordinator.getSharedTopologyClaimsCountForTesting()).toBe(1)
      const generic = await f.request('/api/action', {
        type: 'keys',
        operationId: 'generic-key',
        target: read.target,
        keys: ['enter']
      })
      expect(generic.status).toBe(409)
      release()
      expect((await pending).status).toBe(200)
      expect(f.coordinator.getPaneClaimsCountForTesting()).toBe(0)
    } finally {
      release()
      f.server.stop(true)
    }
  })
})
