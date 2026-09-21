import { describe, expect, test } from 'bun:test'
import {
  buildAgentExplainArgv,
  buildPaneReadArgv,
  buildTerminalInputArgv,
  validatePaneInSnapshot
} from '../herdr-cli.ts'
import type { ISnapshotResult } from '../types.ts'

describe('herdr-cli: unit helpers', () => {
  const mockSnapshot: ISnapshotResult = {
    workspaces: [
      {
        workspace_id: 'w1',
        label: 'test-ws',
        number: 1,
        agent_status: 'idle',
        tab_count: 1,
        pane_count: 2,
        focused: true
      }
    ],
    tabs: [
      {
        tab_id: 'w1:t1',
        workspace_id: 'w1',
        label: '1',
        number: 1,
        pane_count: 2,
        focused: true,
        agent_status: 'idle'
      }
    ],
    panes: [
      {
        pane_id: 'w1:p1',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        cwd: '/tmp',
        focused: true,
        agent_status: 'working'
      },
      {
        pane_id: 'w1:p2',
        workspace_id: 'w1',
        tab_id: 'w1:t1',
        cwd: '/tmp',
        focused: false,
        agent_status: 'blocked'
      }
    ],
    protocol: 22,
    version: '0.9.1'
  }

  test('validatePaneInSnapshot identifies existing panes', () => {
    expect(validatePaneInSnapshot(mockSnapshot, 'w1:p1')).toBe(true)
    expect(validatePaneInSnapshot(mockSnapshot, 'w1:p2')).toBe(true)
    expect(validatePaneInSnapshot(mockSnapshot, 'w1:p99')).toBe(false)
    expect(validatePaneInSnapshot(mockSnapshot, 'nonexistent')).toBe(false)
  })

  test('buildTerminalInputArgv preserves input as one argv value without shell interpolation', () => {
    expect(buildTerminalInputArgv('w1:p1', 'printf "$HOME" && echo done')).toEqual([
      'herdr',
      'pane',
      'run',
      'w1:p1',
      'printf "$HOME" && echo done'
    ])
  })

  test('buildPaneReadArgv creates a bounded public Herdr read command', () => {
    expect(buildPaneReadArgv('w1:p1', { source: 'visible', lines: 80 })).toEqual([
      'herdr',
      'pane',
      'read',
      'w1:p1',
      '--source',
      'visible',
      '--format',
      'text',
      '--lines',
      '80'
    ])
  })

  test('buildPaneReadArgv rejects unsupported sources and line counts', () => {
    expect(() => buildPaneReadArgv('w1:p1', { source: 'arbitrary' as any })).toThrow(
      'Unsupported pane read source'
    )
    expect(() => buildPaneReadArgv('w1:p1', { source: 'detection', lines: 0 })).toThrow(
      'between 1 and 1000'
    )
  })

  test('buildAgentExplainArgv creates bounded json explain command', () => {
    expect(buildAgentExplainArgv('w1:p1')).toEqual([
      'herdr',
      'agent',
      'explain',
      'w1:p1',
      '--json'
    ])
  })
})

const isLive = process.env.HERDR_LIVE_TEST === '1'
const describeLive = isLive ? describe : describe.skip

describeLive('herdr: live integration against active Herdr instance', () => {
  test('direct socket ping returns protocol 22 and pong without input', async () => {
    const { executePing } = await import('../herdr-socket.ts')
    const pong = await executePing({ timeoutMs: 3000 })
    expect(pong.type).toBe('pong')
    expect(pong.protocol).toBe(22)
    expect(pong.version).toBe('0.9.1')
  })

  test('socket adapter getHerdrHealth returns healthy status for running Herdr', async () => {
    const { getHerdrHealth } = await import('../herdr-adapter.ts')
    const health = await getHerdrHealth(3000)
    expect(health.ok).toBe(true)
    expect(health.herdrOk).toBe(true)
    expect(health.version).toBe('0.9.1')
    expect(health.serverStatus).toBe('running')
  })

  test('socket adapter getHerdrSnapshot retrieves structured snapshot from active Herdr', async () => {
    const { getHerdrSnapshot } = await import('../herdr-adapter.ts')
    const snapshot = await getHerdrSnapshot(5000)
    expect(snapshot).toBeDefined()
    expect(snapshot.version).toBe('0.9.1')
    expect(snapshot.protocol).toBe(22)
    expect(Array.isArray(snapshot.workspaces)).toBe(true)
    expect(Array.isArray(snapshot.tabs)).toBe(true)
    expect(Array.isArray(snapshot.panes)).toBe(true)
    expect(snapshot.workspaces.length).toBeGreaterThan(0)
    expect(snapshot.panes.length).toBeGreaterThan(0)
  })

  test('socket adapter readPaneContent reads visible text lines without submitting input', async () => {
    const { getHerdrSnapshot, readPaneContent } = await import('../herdr-adapter.ts')
    const snapshot = await getHerdrSnapshot(5000)
    const activePane = snapshot.panes[0]
    expect(activePane).toBeDefined()

    const result = await readPaneContent(activePane.pane_id, { source: 'visible', lines: 20 })
    expect(result.ok).toBe(true)
    expect(result.paneId).toBe(activePane.pane_id)
    expect(result.source).toBe('visible')
    expect(typeof result.content).toBe('string')
  })

  test('socket adapter maps browser history source to recent_unwrapped without submitting input', async () => {
    const { getHerdrSnapshot, readPaneContent } = await import('../herdr-adapter.ts')
    const snapshot = await getHerdrSnapshot(5000)
    const activePane = snapshot.panes[0]
    expect(activePane).toBeDefined()

    const result = await readPaneContent(activePane.pane_id, { source: 'recent-unwrapped', lines: 20 })
    expect(result.ok).toBe(true)
    expect(result.paneId).toBe(activePane.pane_id)
    expect(result.source).toBe('recent-unwrapped')
    expect(typeof result.content).toBe('string')
  })

  // Retained intentional CLI transport: raw socket API does not expose terminal session observe.
  test('spawnObserverProcess (CLI child observer) captures live frame without input or takeover', async () => {
    const { getHerdrSnapshot, spawnObserverProcess } = await import('../herdr-adapter.ts')
    const snapshot = await getHerdrSnapshot(5000)
    const activePane = snapshot.panes[0]
    expect(activePane).toBeDefined()

    const proc = spawnObserverProcess(activePane.pane_id, 80, 24)

    const reader = proc.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let receivedFrame: any = null

    const timeoutTimer = setTimeout(() => {
      try {
        proc.kill()
      } catch {}
    }, 3000)

    try {
      while (!receivedFrame) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const parsed = JSON.parse(trimmed)
            if (parsed.type === 'terminal.frame' && typeof parsed.bytes === 'string') {
              receivedFrame = parsed
              break
            }
          } catch {}
        }
      }
    } finally {
      clearTimeout(timeoutTimer)
      try {
        proc.kill()
      } catch {}
    }

    expect(receivedFrame).toBeDefined()
    expect(receivedFrame.type).toBe('terminal.frame')
    expect(typeof receivedFrame.bytes).toBe('string')
    expect(receivedFrame.bytes.length).toBeGreaterThan(0)
    expect(receivedFrame.width).toBe(80)
    expect(receivedFrame.height).toBe(24)
  })

  test('explicit CLI transport fallback: getHerdrHealth and getHerdrSnapshot work', async () => {
    const originalTransport = process.env.HERDR_TRANSPORT
    try {
      process.env.HERDR_TRANSPORT = 'cli'
      const { getHerdrHealth, getHerdrSnapshot } = await import('../herdr-adapter.ts')
      const health = await getHerdrHealth(3000)
      expect(health.ok).toBe(true)
      const snap = await getHerdrSnapshot(5000)
      expect(snap.version).toBe('0.9.1')
    } finally {
      if (originalTransport !== undefined) {
        process.env.HERDR_TRANSPORT = originalTransport
      } else {
        delete process.env.HERDR_TRANSPORT
      }
    }
  })

  test('socket adapter getAgentExplain retrieves bounded explain on active agent pane and truthful no-agent on shell pane without mutation', async () => {
    const { getHerdrSnapshot, getAgentExplain } = await import('../herdr-adapter.ts')
    const snapshot = await getHerdrSnapshot(5000)
    const agentPane = snapshot.panes.find((p) => p.agent || p.display_agent)
    const shellPane = snapshot.panes.find((p) => !p.agent && (!p.display_agent || p.display_agent === 'Shell'))

    if (agentPane) {
      const explain = await getAgentExplain(agentPane.pane_id, 5000)
      expect(explain.ok).toBe(true)
      expect(explain.paneId).toBe(agentPane.pane_id)
      expect(explain.available).toBe(true)
      expect(typeof explain.agent).toBe('string')
      expect(typeof explain.state).toBe('string')
      expect((explain as any).evaluated_rules).toBeUndefined()
      expect((explain as any).manifest_source).toBeUndefined()
    }

    if (shellPane) {
      const shellExplain = await getAgentExplain(shellPane.pane_id, 5000)
      expect(shellExplain.ok).toBe(true)
      expect(shellExplain.paneId).toBe(shellPane.pane_id)
      expect(shellExplain.available).toBe(false)
      expect(shellExplain.reason).toBe('no-agent')
    }
  })
})
