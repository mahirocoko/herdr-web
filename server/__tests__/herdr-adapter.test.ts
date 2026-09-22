import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  executeKeys,
  executePrompt,
  executeTabClose,
  executeTerminalInput,
  executeWorkspaceClose,
  executeWorkspaceCreate,
  getAgentExplain,
  getHerdrHealth,
  getHerdrSnapshot,
  parseTransportMode,
  projectAgentExplain,
  readPaneContent,
  toRawPaneReadSource,
  validatePaneExists
} from '../herdr-adapter.ts'
import { HerdrSocketError } from '../herdr-socket.ts'

const createMockSocketServer = (
  handler: (socket: net.Socket, req: { id: string; method: string; params: any }) => void,
  options: { autoPing?: boolean } = {}
): { socketPath: string; close: () => Promise<void> } => {
  const tmpDir = os.tmpdir()
  const socketPath = path.join(tmpDir, `herdr-adapter-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sock`)

  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath)
  }

  const server = net.createServer((socket) => {
    let buffer = ''
    socket.on('data', (data) => {
      buffer += data.toString('utf8')
      while (buffer.includes('\n')) {
        const idx = buffer.indexOf('\n')
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (line.length > 0) {
          const req = JSON.parse(line)
          if (req.method === 'ping' && options.autoPing !== false) {
            socket.write(JSON.stringify({
              id: req.id,
              result: { type: 'pong', version: '0.9.1', protocol: 22 }
            }) + '\n')
            continue
          }
          handler(socket, req)
        }
      }
    })
  })

  server.listen(socketPath)

  const close = async () => {
    return new Promise<void>((resolve) => {
      server.close(() => {
        if (fs.existsSync(socketPath)) {
          try {
            fs.unlinkSync(socketPath)
          } catch {}
        }
        resolve()
      })
    })
  }

  return { socketPath, close }
}

describe('herdr-adapter: strict transport parsing', () => {
  it('defaults only missing and empty values to socket', () => {
    expect(parseTransportMode(undefined)).toBe('socket')
    expect(parseTransportMode('')).toBe('socket')
  })

  it('accepts exact socket and cli values', () => {
    expect(parseTransportMode('socket')).toBe('socket')
    expect(parseTransportMode('cli')).toBe('cli')
  })

  it('fails closed for every other nonempty value', () => {
    for (const value of ['CLI', ' socket', 'cli ', 'auto', '1']) {
      expect(() => parseTransportMode(value)).toThrow('Unsupported HERDR_TRANSPORT')
    }
  })
})

describe('herdr-adapter: browser-to-wire read source mapping', () => {
  it('maps the browser-facing history source to the raw schema enum', () => {
    expect(toRawPaneReadSource('visible')).toBe('visible')
    expect(toRawPaneReadSource('detection')).toBe('detection')
    expect(toRawPaneReadSource('recent-unwrapped')).toBe('recent_unwrapped')
  })
})

describe('herdr-adapter: socket mode raw mappings', () => {
  const originalEnv = { ...process.env }

  it('validates health using raw ping method', async () => {
    delete process.env.HERDR_TRANSPORT
    const { socketPath, close } = createMockSocketServer((socket, req) => {
      expect(req.method).toBe('ping')
      socket.write(
        JSON.stringify({
          id: req.id,
          result: {
            type: 'pong',
            version: '0.9.1',
            protocol: 22
          }
        }) + '\n'
      )
    }, { autoPing: false })
    process.env.HERDR_SOCKET_PATH = socketPath

    try {
      const health = await getHerdrHealth(1000)
      expect(health.ok).toBe(true)
      expect(health.version).toBe('0.9.1')
      expect(health.serverStatus).toBe('running')
    } finally {
      process.env = { ...originalEnv }
      await close()
    }
  })

  it('validates snapshot using raw session.snapshot and protocol 22', async () => {
    delete process.env.HERDR_TRANSPORT
    const { socketPath, close } = createMockSocketServer((socket, req) => {
      expect(req.method).toBe('session.snapshot')
      socket.write(
        JSON.stringify({
          id: req.id,
          result: {
            type: 'session_snapshot',
            snapshot: {
              protocol: 22,
              version: '0.9.1',
              workspaces: [],
              tabs: [],
              panes: [{ pane_id: 'w1:p1', workspace_id: 'w1', tab_id: 'w1:t1', focused: true, agent_status: 'idle', cwd: '/test' }]
            }
          }
        }) + '\n'
      )
    })
    process.env.HERDR_SOCKET_PATH = socketPath

    try {
      const snap = await getHerdrSnapshot(1000)
      expect(snap.protocol).toBe(22)
      expect(snap.version).toBe('0.9.1')
      expect(snap.panes.length).toBe(1)
      expect(snap.panes[0].pane_id).toBe('w1:p1')
    } finally {
      process.env = { ...originalEnv }
      await close()
    }
  })

  it('validates pane existence with fresh pane.get and maps pane_not_found to false', async () => {
    delete process.env.HERDR_TRANSPORT
    const { socketPath, close } = createMockSocketServer((socket, req) => {
      expect(req.method).toBe('pane.get')
      if (req.params.pane_id === 'w1:p1') {
        socket.write(
          JSON.stringify({
            id: req.id,
            result: { type: 'pane_info', pane: { pane_id: 'w1:p1' } }
          }) + '\n'
        )
      } else {
        socket.write(
          JSON.stringify({
            id: req.id,
            error: { code: 'pane_not_found', message: `pane ${req.params.pane_id} not found` }
          }) + '\n'
        )
      }
    })
    process.env.HERDR_SOCKET_PATH = socketPath

    try {
      const existsTrue = await validatePaneExists('w1:p1', 1000)
      expect(existsTrue).toBe(true)

      const existsFalse = await validatePaneExists('w1:p99', 1000)
      expect(existsFalse).toBe(false)
    } finally {
      process.env = { ...originalEnv }
      await close()
    }
  })

  it('executeTerminalInput sends raw pane.send_input with text and Enter atomically', async () => {
    delete process.env.HERDR_TRANSPORT
    const recordedRequests: any[] = []
    const { socketPath, close } = createMockSocketServer((socket, req) => {
      recordedRequests.push(req)
      if (req.method === 'pane.get') {
        socket.write(JSON.stringify({ id: req.id, result: { type: 'pane_info', pane: { pane_id: req.params.pane_id } } }) + '\n')
      } else if (req.method === 'pane.send_input') {
        expect(req.params.pane_id).toBe('w1:p1')
        expect(req.params.text).toBe('ls -la')
        expect(req.params.keys).toEqual(['Enter'])
        socket.write(JSON.stringify({ id: req.id, result: { type: 'pane_input_sent' } }) + '\n')
      }
    })
    process.env.HERDR_SOCKET_PATH = socketPath

    try {
      const res = await executeTerminalInput('w1:p1', 'ls -la', 1000)
      expect(res.ok).toBe(true)
      expect(recordedRequests.length).toBe(2)
      expect(recordedRequests[0].method).toBe('pane.get')
      expect(recordedRequests[1].method).toBe('pane.send_input')
      expect(recordedRequests[1].params).toEqual({
        pane_id: 'w1:p1',
        text: 'ls -la',
        keys: ['Enter']
      })
    } finally {
      process.env = { ...originalEnv }
      await close()
    }
  })

  it('executePrompt sends raw agent.prompt with target and text without wait', async () => {
    delete process.env.HERDR_TRANSPORT
    const recordedRequests: any[] = []
    const { socketPath, close } = createMockSocketServer((socket, req) => {
      recordedRequests.push(req)
      if (req.method === 'pane.get') {
        socket.write(JSON.stringify({ id: req.id, result: { type: 'pane_info', pane: { pane_id: req.params.pane_id } } }) + '\n')
      } else if (req.method === 'agent.prompt') {
        expect(req.params.target).toBe('w1:p1')
        expect(req.params.text).toBe('fix tests')
        expect(req.params.wait).toBeUndefined()
        socket.write(JSON.stringify({ id: req.id, result: { type: 'agent_prompt_started' } }) + '\n')
      }
    })
    process.env.HERDR_SOCKET_PATH = socketPath

    try {
      const res = await executePrompt('w1:p1', 'fix tests', 1000)
      expect(res.ok).toBe(true)
      expect(recordedRequests[1].method).toBe('agent.prompt')
      expect(recordedRequests[1].params).toEqual({
        target: 'w1:p1',
        text: 'fix tests'
      })
    } finally {
      process.env = { ...originalEnv }
      await close()
    }
  })

  it('executeKeys sends raw pane.send_keys with pane_id and keys array', async () => {
    delete process.env.HERDR_TRANSPORT
    const recordedRequests: any[] = []
    const { socketPath, close } = createMockSocketServer((socket, req) => {
      recordedRequests.push(req)
      if (req.method === 'pane.get') {
        socket.write(JSON.stringify({ id: req.id, result: { type: 'pane_info', pane: { pane_id: req.params.pane_id } } }) + '\n')
      } else if (req.method === 'pane.send_keys') {
        expect(req.params.pane_id).toBe('w1:p1')
        expect(req.params.keys).toEqual(['ctrl+c', 'enter'])
        socket.write(JSON.stringify({ id: req.id, result: { type: 'pane_keys_sent' } }) + '\n')
      }
    })
    process.env.HERDR_SOCKET_PATH = socketPath

    try {
      const res = await executeKeys('w1:p1', ['ctrl+c', 'enter'], 1000)
      expect(res.ok).toBe(true)
      expect(recordedRequests[1].method).toBe('pane.send_keys')
      expect(recordedRequests[1].params).toEqual({
        pane_id: 'w1:p1',
        keys: ['ctrl+c', 'enter']
      })
    } finally {
      process.env = { ...originalEnv }
      await close()
    }
  })

  it('readPaneContent sends raw pane.read with source, format: text, and strip_ansi: true', async () => {
    delete process.env.HERDR_TRANSPORT
    const recordedRequests: any[] = []
    const { socketPath, close } = createMockSocketServer((socket, req) => {
      recordedRequests.push(req)
      if (req.method === 'pane.get') {
        socket.write(JSON.stringify({ id: req.id, result: { type: 'pane_info', pane: { pane_id: req.params.pane_id } } }) + '\n')
      } else if (req.method === 'pane.read') {
        expect(req.params.pane_id).toBe('w1:p1')
        expect(req.params.source).toBe('recent_unwrapped')
        expect(req.params.format).toBe('text')
        expect(req.params.strip_ansi).toBe(true)
        expect(req.params.lines).toBe(50)
        socket.write(
          JSON.stringify({
            id: req.id,
            result: {
              type: 'pane_read',
              read: {
                pane_id: 'w1:p1',
                workspace_id: 'w1',
                tab_id: 'w1:t1',
                source: 'recent_unwrapped',
                format: 'text',
                text: 'first line\nsecond line\n'
              }
            }
          }) + '\n'
        )
      }
    })
    process.env.HERDR_SOCKET_PATH = socketPath

    try {
      const res = await readPaneContent('w1:p1', { source: 'recent-unwrapped', lines: 50 }, 1000)
      expect(res.ok).toBe(true)
      expect(res.paneId).toBe('w1:p1')
      expect(res.source).toBe('recent-unwrapped')
      expect(res.content).toBe('first line\nsecond line\n')
    } finally {
      process.env = { ...originalEnv }
      await close()
    }
  })

  it('throws HerdrSocketError pane_not_found when pane does not exist', async () => {
    delete process.env.HERDR_TRANSPORT
    const { socketPath, close } = createMockSocketServer((socket, req) => {
      socket.write(
        JSON.stringify({
          id: req.id,
          error: { code: 'pane_not_found', message: 'pane not found' }
        }) + '\n'
      )
    })
    process.env.HERDR_SOCKET_PATH = socketPath

    try {
      await executeTerminalInput('w1:p99', 'test', 1000)
      expect(true).toBe(false)
    } catch (err) {
      expect(err instanceof HerdrSocketError).toBe(true)
      expect((err as HerdrSocketError).code).toBe('pane_not_found')
    } finally {
      process.env = { ...originalEnv }
      await close()
    }
  })

  it('fails closed before a direct mutation when the daemon protocol does not match', async () => {
    delete process.env.HERDR_TRANSPORT
    const observedMethods: string[] = []
    const { socketPath, close } = createMockSocketServer((socket, req) => {
      observedMethods.push(req.method)
      if (req.method === 'ping') {
        socket.write(JSON.stringify({
          id: req.id,
          result: { type: 'pong', version: '0.8.0', protocol: 21 }
        }) + '\n')
      } else {
        socket.write(JSON.stringify({ id: req.id, result: { type: 'unexpected' } }) + '\n')
      }
    }, { autoPing: false })
    process.env.HERDR_SOCKET_PATH = socketPath

    try {
      await executeTerminalInput('w1:p1', 'must not run', 1000)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain('Protocol mismatch')
      expect(observedMethods).toEqual(['ping'])
    } finally {
      process.env = { ...originalEnv }
      await close()
    }
  })

  it('projectAgentExplain strips evaluated rules, terminal evidence, absolute paths, raw priority, and free-text fields', () => {
    const rawDiagnostic = {
      agent: 'letta',
      state: 'working',
      evaluated_rules: [
        {
          id: 'osc_progress_blocked',
          matched: false,
          priority: 1400,
          region: 'osc_progress',
          evidence: { region_preview: 'secret_terminal_buffer_preview', regex: ['^4;3'] }
        }
      ],
      manifest_source: 'remote:/Users/example/.local/state/herdr/agent-detection/remote/letta.toml',
      manifest_version: '2026.08.24.1',
      matched_rule: {
        id: 'osc_title_working',
        priority: 900,
        region: 'bottom_non_empty_lines(8)',
        state: 'working'
      },
      visible_blocker: false,
      visible_idle: false,
      visible_working: true,
      screen_detection_skipped: false,
      skip_state_update: false,
      warning: 'Some bounded warning\ntext'
    }

    const projected = projectAgentExplain('w1:p1', rawDiagnostic)

    expect(projected.ok).toBe(true)
    expect(projected.paneId).toBe('w1:p1')
    expect(projected.available).toBe(true)
    expect(projected.agent).toBe('letta')
    expect(projected.state).toBe('working')

    // Matched rule retains id, region, state without multiline or raw priority
    expect(projected.matchedRule).toEqual({
      id: 'osc_title_working',
      region: 'bottom_non_empty_lines(8)',
      state: 'working'
    })
    expect((projected.matchedRule as any).priority).toBeUndefined()

    // Manifest strips absolute path to sourceKind and keeps version
    expect(projected.manifest).toEqual({
      sourceKind: 'remote',
      version: '2026.08.24.1'
    })
    expect((projected as any).manifest_source).toBeUndefined()

    // Signals include true-only flags, omitting false ones
    expect(projected.visibleWorking).toBe(true)
    expect(projected.visibleBlocker).toBeUndefined()
    expect(projected.visibleIdle).toBeUndefined()
    expect(projected.screenDetectionSkipped).toBeUndefined()
    expect(projected.stateUpdateSkipped).toBeUndefined()

    // Free-text fields are NEVER returned
    expect((projected as any).warning).toBeUndefined()
    expect((projected as any).fallbackReason).toBeUndefined()

    // Sensitive / raw internal fields are NEVER returned
    expect((projected as any).evaluated_rules).toBeUndefined()
    expect((projected as any).evaluatedRules).toBeUndefined()
    expect((projected as any).evidence).toBeUndefined()
  })

  it('projectAgentExplain handles manifest versions strictly and omits fallbackReason', () => {
    // remote manifest uses cached_remote_version when manifest_version is absent
    const remoteExplain = projectAgentExplain('w1:p1', {
      agent: 'letta',
      state: 'working',
      source_kind: 'remote',
      cached_remote_version: '2026.08.24.1'
    })
    expect(remoteExplain.manifest?.version).toBe('2026.08.24.1')

    // builtin manifest NEVER uses cached_remote_version
    const builtinExplain = projectAgentExplain('w1:p1', {
      agent: 'letta',
      state: 'working',
      source_kind: 'builtin',
      cached_remote_version: '2026.08.24.1'
    })
    expect(builtinExplain.manifest?.version).toBeUndefined()

    // local manifest NEVER uses cached_remote_version
    const localExplain = projectAgentExplain('w1:p1', {
      agent: 'letta',
      state: 'working',
      source_kind: 'local',
      cached_remote_version: '2026.08.24.1'
    })
    expect(localExplain.manifest?.version).toBeUndefined()

    // explicit manifest_version is always used regardless of source_kind
    const localExplicit = projectAgentExplain('w1:p1', {
      agent: 'letta',
      state: 'working',
      source_kind: 'local',
      manifest_version: '1.2.3',
      cached_remote_version: '2026.08.24.1'
    })
    expect(localExplicit.manifest?.version).toBe('1.2.3')

    // skipped_update_reason is NOT conflated and fallback_reason is NOT projected
    const skippedOnly = projectAgentExplain('w1:p1', {
      agent: 'letta',
      state: 'working',
      skipped_update_reason: 'debounce_active',
      skip_state_update: true
    })
    expect((skippedOnly as any).fallbackReason).toBeUndefined()
    expect(skippedOnly.stateUpdateSkipped).toBe(true)

    // actual fallback_reason is omitted from projection
    const fallbackProjected = projectAgentExplain('w1:p1', {
      agent: 'letta',
      state: 'working',
      fallback_reason: 'screen_detection_timeout'
    })
    expect((fallbackProjected as any).fallbackReason).toBeUndefined()
  })

  it('adversarially rejects paths, socks, tildes, and invalid tokens from serialized browser output', () => {
    const maliciousPayload = {
      agent: '/Users/example/evil/agent',
      state: 'running /tmp/herdr.sock',
      evaluated_rules: [
        {
          id: 'evil_rule',
          evidence: { raw_leak: '/Users/example/.bash_history' },
          priority: 9999
        }
      ],
      manifest_source: 'remote:/Users/example/.config/herdr/agent.toml',
      manifest_version: 'v1.0.0;/tmp/evil.sock',
      matched_rule: {
        id: '../traversal/rule',
        region: '~/custom/region',
        state: 'blocked\nmalicious'
      },
      warning: '/Users/example/private/key.pem exposed',
      fallback_reason: 'failed at ~/herdr.sock'
    }

    const projected = projectAgentExplain('w1:p1', maliciousPayload)
    const serialized = JSON.stringify(projected)

    // Verify safe token fallback
    expect(projected.agent).toBe('unknown')
    expect(projected.state).toBe('unknown')
    expect(projected.matchedRule).toBeUndefined()
    expect(projected.manifest?.sourceKind).toBe('remote')
    expect(projected.manifest?.version).toBeUndefined()

    // Verify that NO sensitive strings or paths exist in serialized JSON output
    expect(serialized).not.toContain('/Users')
    expect(serialized).not.toContain('.sock')
    expect(serialized).not.toContain('~/')
    expect(serialized).not.toContain('warning')
    expect(serialized).not.toContain('fallbackReason')
    expect(serialized).not.toContain('fallback_reason')
    expect(serialized).not.toContain('evaluated_rules')
    expect(serialized).not.toContain('evaluatedRules')
    expect(serialized).not.toContain('evidence')
    expect(serialized).not.toContain('priority')
    expect(serialized).not.toContain('bash_history')
  })

  it('getAgentExplain retrieves projected explanation from active socket', async () => {
    delete process.env.HERDR_TRANSPORT
    const { socketPath, close } = createMockSocketServer((socket, req) => {
      if (req.method === 'pane.get') {
        socket.write(
          JSON.stringify({
            id: req.id,
            result: { type: 'pane', pane: { pane_id: 'w1:p1' } }
          }) + '\n'
        )
      } else if (req.method === 'agent.explain') {
        expect(req.params.target).toBe('w1:p1')
        socket.write(
          JSON.stringify({
            id: req.id,
            result: {
              type: 'agent_explain',
              explain: {
                agent: 'agy',
                state: 'blocked',
                matched_rule: { id: 'command_approval', priority: 1200, region: 'bottom', state: 'blocked' },
                manifest_source: 'builtin:default',
                visible_blocker: true
              }
            }
          }) + '\n'
        )
      }
    })
    process.env.HERDR_SOCKET_PATH = socketPath

    try {
      const res = await getAgentExplain('w1:p1', 1000)
      expect(res.ok).toBe(true)
      expect(res.paneId).toBe('w1:p1')
      expect(res.available).toBe(true)
      expect(res.agent).toBe('agy')
      expect(res.state).toBe('blocked')
      expect(res.matchedRule?.id).toBe('command_approval')
      expect(res.manifest?.sourceKind).toBe('builtin')
      expect(res.visibleBlocker).toBe(true)
    } finally {
      process.env = { ...originalEnv }
      await close()
    }
  })

  it('getAgentExplain returns available:false for real shell pane with agent_not_found', async () => {
    delete process.env.HERDR_TRANSPORT
    const { socketPath, close } = createMockSocketServer((socket, req) => {
      if (req.method === 'pane.get') {
        socket.write(
          JSON.stringify({
            id: req.id,
            result: { type: 'pane', pane: { pane_id: 'w1:pShell' } }
          }) + '\n'
        )
      } else if (req.method === 'agent.explain') {
        socket.write(
          JSON.stringify({
            id: req.id,
            error: { code: 'agent_not_found', message: 'agent target w1:pShell not found' }
          }) + '\n'
        )
      }
    })
    process.env.HERDR_SOCKET_PATH = socketPath

    try {
      const res = await getAgentExplain('w1:pShell', 1000)
      expect(res.ok).toBe(true)
      expect(res.paneId).toBe('w1:pShell')
      expect(res.available).toBe(false)
      expect(res.reason).toBe('no-agent')
    } finally {
      process.env = { ...originalEnv }
      await close()
    }
  })

  it('getAgentExplain propagates other *_not_found error codes without swallowing them as no-agent', async () => {
    delete process.env.HERDR_TRANSPORT
    const { socketPath, close } = createMockSocketServer((socket, req) => {
      if (req.method === 'pane.get') {
        socket.write(
          JSON.stringify({
            id: req.id,
            result: { type: 'pane', pane: { pane_id: 'w1:p1' } }
          }) + '\n'
        )
      } else if (req.method === 'agent.explain') {
        socket.write(
          JSON.stringify({
            id: req.id,
            error: { code: 'manifest_not_found', message: 'agent manifest not found on disk' }
          }) + '\n'
        )
      }
    })
    process.env.HERDR_SOCKET_PATH = socketPath

    try {
      await getAgentExplain('w1:p1', 1000)
      expect.unreachable()
    } catch (err) {
      expect(err instanceof HerdrSocketError).toBe(true)
      expect((err as HerdrSocketError).code).toBe('manifest_not_found')
    } finally {
      process.env = { ...originalEnv }
      await close()
    }
  })

  it('getAgentExplain throws pane_not_found when pane does not exist', async () => {
    delete process.env.HERDR_TRANSPORT
    const { socketPath, close } = createMockSocketServer((socket, req) => {
      if (req.method === 'pane.get') {
        socket.write(
          JSON.stringify({
            id: req.id,
            error: { code: 'pane_not_found', message: 'pane not found' }
          }) + '\n'
        )
      }
    })
    process.env.HERDR_SOCKET_PATH = socketPath

    try {
      await getAgentExplain('w1:p999', 1000)
      expect.unreachable()
    } catch (err) {
      expect(err instanceof HerdrSocketError).toBe(true)
      expect((err as HerdrSocketError).code).toBe('pane_not_found')
    } finally {
      process.env = { ...originalEnv }
      await close()
    }
  })

  it('getAgentExplain fails closed if protocol mismatches before explain', async () => {
    delete process.env.HERDR_TRANSPORT
    const observedMethods: string[] = []
    const { socketPath, close } = createMockSocketServer((socket, req) => {
      observedMethods.push(req.method)
      if (req.method === 'ping') {
        socket.write(JSON.stringify({
          id: req.id,
          result: { type: 'pong', version: '0.8.0', protocol: 21 }
        }) + '\n')
      }
    }, { autoPing: false })
    process.env.HERDR_SOCKET_PATH = socketPath

    try {
      await getAgentExplain('w1:p1', 1000)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain('Protocol mismatch')
      expect(observedMethods).toEqual(['ping'])
    } finally {
      process.env = { ...originalEnv }
      await close()
    }
  })

  describe('executeWorkspaceCreate', () => {
    const originalEnv = { ...process.env }

    it('refuses workspace creation in CLI transport mode with 409 rejected', async () => {
      process.env.HERDR_TRANSPORT = 'cli'
      try {
        const res = await executeWorkspaceCreate('New Space')
        expect(res.ok).toBe(false)
        expect(res.status).toBe(409)
        expect(res.outcome).toBe('rejected')
        expect(res.error).toContain('unavailable in CLI transport mode')
      } finally {
        process.env = { ...originalEnv }
      }
    })

    it('rejects numeric alias in preflight snapshot (exact literal snapshot ID required)', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-literal', number: 1, label: 'Main', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't-1', workspace_id: 'ws-literal', number: 1, label: 'T1', pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: [{ pane_id: 'ws-literal:p1', workspace_id: 'ws-literal', tab_id: 't-1', terminal_id: 'term-1', focused: true, agent_status: 'idle', cwd: '/app' }]
      }

      const res = await executeWorkspaceCreate('Space', {
        workspaceId: '1', // numeric alias
        paneId: 'ws-literal:p1',
        terminalId: 'term-1'
      }, { preSnapshot })

      expect(res.ok).toBe(false)
      expect(res.status).toBe(404)
      expect(res.outcome).toBe('rejected')
      expect(res.error).toContain('Workspace "1" not found')
    })

    it('rejects terminal replacement and wrong membership in preflight', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [
          { workspace_id: 'ws-1', number: 1, label: 'W1', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true },
          { workspace_id: 'ws-2', number: 2, label: 'W2', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: false }
        ],
        tabs: [
          { tab_id: 't-1', workspace_id: 'ws-1', number: 1, label: 'T1', pane_count: 1, focused: true, agent_status: 'idle' },
          { tab_id: 't-2', workspace_id: 'ws-2', number: 1, label: 'T2', pane_count: 1, focused: false, agent_status: 'idle' }
        ],
        panes: [
          { pane_id: 'ws-1:p1', workspace_id: 'ws-1', tab_id: 't-1', terminal_id: 'term-actual', focused: true, agent_status: 'idle', cwd: '/app' },
          { pane_id: 'ws-2:p2', workspace_id: 'ws-2', tab_id: 't-2', terminal_id: 'term-2', focused: false, agent_status: 'idle', cwd: '/app2' }
        ]
      }

      // Replaced terminal
      const resReplacement = await executeWorkspaceCreate('Space', {
        workspaceId: 'ws-1',
        paneId: 'ws-1:p1',
        terminalId: 'term-expected-different'
      }, { preSnapshot })
      expect(resReplacement.ok).toBe(false)
      expect(resReplacement.status).toBe(409)
      expect(resReplacement.outcome).toBe('rejected')
      expect(resReplacement.error).toContain('Terminal replacement detected')

      // Wrong membership (pane ws-2:p2 claims to belong to ws-1)
      const resMembership = await executeWorkspaceCreate('Space', {
        workspaceId: 'ws-1',
        paneId: 'ws-2:p2',
        terminalId: 'term-2'
      }, { preSnapshot })
      expect(resMembership.ok).toBe(false)
      expect(resMembership.status).toBe(400)
      expect(resMembership.outcome).toBe('rejected')
      expect(resMembership.error).toContain('does not belong to workspace "ws-1"')
    })

    it('derives fresh foreground_cwd || cwd when source is provided and omits when omitted', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-1', number: 1, label: 'W1', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't-1', workspace_id: 'ws-1', number: 1, label: 'T1', pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: [{ pane_id: 'ws-1:p1', workspace_id: 'ws-1', tab_id: 't-1', terminal_id: 'term-1', focused: true, agent_status: 'idle', cwd: '/base', foreground_cwd: '/base/derived' }]
      }

      const postSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [
          ...preSnapshot.workspaces,
          { workspace_id: 'ws-new', number: 2, label: 'New', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: false }
        ],
        tabs: [
          ...preSnapshot.tabs,
          { tab_id: 't-new', workspace_id: 'ws-new', number: 1, label: 'TNew', pane_count: 1, focused: false, agent_status: 'idle' }
        ],
        panes: [
          ...preSnapshot.panes,
          { pane_id: 'ws-new:p1', workspace_id: 'ws-new', tab_id: 't-new', terminal_id: 'term-new', focused: false, agent_status: 'idle', cwd: '/base/derived' }
        ]
      }

      let capturedParams: any = null
      const sendSocketRequest = async <T>(_method: string, params: Record<string, unknown>): Promise<T> => {
        capturedParams = params
        return {
          type: 'workspace_created',
          workspace: {
            workspace_id: 'ws-new',
            number: 2,
            label: 'New',
            focused: false,
            pane_count: 1,
            tab_count: 1,
            active_tab_id: 't-new',
            agent_status: 'idle'
          },
          tab: {
            tab_id: 't-new',
            workspace_id: 'ws-new',
            number: 1,
            label: 'TNew',
            focused: false,
            pane_count: 1,
            agent_status: 'idle'
          },
          root_pane: {
            pane_id: 'ws-new:p1',
            terminal_id: 'term-new',
            workspace_id: 'ws-new',
            tab_id: 't-new',
            focused: false,
            agent_status: 'idle',
            revision: 0
          }
        } as T
      }

      const resWithSource = await executeWorkspaceCreate('My Space', {
        workspaceId: 'ws-1',
        paneId: 'ws-1:p1',
        terminalId: 'term-1'
      }, {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => postSnapshot,
          sendSocketRequest
        }
      })

      expect(resWithSource.ok).toBe(true)
      expect(resWithSource.outcome).toBe('observed')
      expect(resWithSource.result).toEqual({
        workspaceId: 'ws-new',
        tabId: 't-new',
        paneId: 'ws-new:p1'
      })
      expect(capturedParams.cwd).toBe('/base/derived')
      expect(capturedParams.focus).toBe(false)
      expect(capturedParams.label).toBe('My Space')

      // Without source: omits cwd
      const resWithoutSource = await executeWorkspaceCreate('No Source Space', undefined, {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => postSnapshot,
          sendSocketRequest
        }
      })
      expect(resWithoutSource.ok).toBe(true)
      expect(capturedParams.cwd).toBeUndefined()
      expect(capturedParams.focus).toBe(false)
    })

    it('response X vs snapshot Y / missing root / inconsistent relation returns outcome: unknown', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-1', number: 1, label: 'W1', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't-1', workspace_id: 'ws-1', number: 1, label: 'T1', pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: [{ pane_id: 'ws-1:p1', workspace_id: 'ws-1', tab_id: 't-1', terminal_id: 'term-1', focused: true, agent_status: 'idle', cwd: '/app' }]
      }

      // Inconsistent relation between tab and workspace in daemon response
      const resInconsistent = await executeWorkspaceCreate('Space', undefined, {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => preSnapshot,
          sendSocketRequest: async () => ({
            type: 'workspace_created',
            workspace: {
              workspace_id: 'ws-created-A', number: 2, label: 'A', focused: false,
              pane_count: 1, tab_count: 1, active_tab_id: 't-created-1', agent_status: 'idle'
            },
            tab: {
              tab_id: 't-created-1', workspace_id: 'ws-other-different', number: 1,
              label: 'T', focused: false, pane_count: 1, agent_status: 'idle'
            },
            root_pane: {
              pane_id: 'p-root-1', terminal_id: 'term-root-1', workspace_id: 'ws-created-A',
              tab_id: 't-created-1', focused: false, agent_status: 'idle', revision: 0
            }
          })
        }
      })
      expect(resInconsistent.ok).toBe(false)
      expect(resInconsistent.status).toBe(504)
      expect(resInconsistent.outcome).toBe('unknown')

      // Response X vs snapshot Y (daemon returns ws-X, but post-snapshot only has ws-Y)
      const postSnapshotY: any = {
        ...preSnapshot,
        workspaces: [{ workspace_id: 'ws-Y', number: 1, label: 'Y', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }]
      }
      const resMismatch = await executeWorkspaceCreate('Space', undefined, {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => postSnapshotY,
          sendSocketRequest: async () => ({
            type: 'workspace_created',
            workspace: {
              workspace_id: 'ws-X', number: 2, label: 'X', focused: false,
              pane_count: 1, tab_count: 1, active_tab_id: 't-X', agent_status: 'idle'
            },
            tab: {
              tab_id: 't-X', workspace_id: 'ws-X', number: 1,
              label: 'T', focused: false, pane_count: 1, agent_status: 'idle'
            },
            root_pane: {
              pane_id: 'p-X', terminal_id: 'term-X', workspace_id: 'ws-X', tab_id: 't-X',
              focused: false, agent_status: 'idle', revision: 0
            }
          })
        }
      })
      expect(resMismatch.ok).toBe(false)
      expect(resMismatch.status).toBe(504)
      expect(resMismatch.outcome).toBe('unknown')
      expect(resMismatch.error).toContain('correlated workspace "ws-X" not found')
    })

    it('rejects malformed workspace-created identity shapes as unknown without observing snapshot matches', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [],
        tabs: [],
        panes: []
      }
      const postSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-new', number: 1, label: 'New', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 'tab-new', workspace_id: 'ws-new', number: 1, label: 'New', pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: [{ pane_id: 'ws-new:p1', workspace_id: 'ws-new', tab_id: 'tab-new', terminal_id: 'term-new', focused: true, agent_status: 'idle', cwd: '/' }]
      }
      const malformedResponses = [
        {
          type: 'workspace_created',
          workspace_id: 'ws-new',
          tab_id: 'tab-new',
          root_pane: 'ws-new:p1'
        },
        {
          type: 'workspace_created',
          workspace: { workspace_id: 'ws-new' },
          tab: { tab_id: 'tab-new', workspace_id: 'ws-new' },
          root_pane: 'ws-new:p1'
        },
        {
          type: 'workspace_created',
          workspace: { workspace_id: 'ws-new' },
          tab: { tab_id: 'tab-new', workspace_id: 'ws-new' },
          root_pane: { pane_id: 'ws-new:p1', workspace_id: 'ws-new', tab_id: 'tab-new' }
        },
        {
          type: 'workspace_created',
          workspace: { workspace_id: 'ws-new' },
          tab: { tab_id: 'tab-new' },
          root_pane: { pane_id: 'ws-new:p1', workspace_id: 'ws-new', tab_id: 'tab-new' }
        },
        {
          type: 'workspace_created',
          workspace: { workspace_id: 'ws-new' },
          tab: { tab_id: 'tab-new', workspace_id: 'ws-new' },
          root_pane: { pane_id: 'ws-new:p1', tab_id: 'tab-new' }
        }
      ]

      for (const response of malformedResponses) {
        const result = await executeWorkspaceCreate(undefined, undefined, {
          preSnapshot,
          deps: {
            fetchSnapshot: async () => postSnapshot,
            sendSocketRequest: async () => response
          }
        })
        expect(result.ok).toBe(false)
        expect(result.status).toBe(504)
        expect(result.outcome).toBe('unknown')
      }
    })

    it('rejects a supplied source with nullable or blank cwd before sending RPC', async () => {
      delete process.env.HERDR_TRANSPORT
      let rpcCalls = 0
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-1', number: 1, label: 'W1', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [],
        panes: [{ pane_id: 'ws-1:p1', workspace_id: 'ws-1', tab_id: 'tab-1', terminal_id: 'term-1', focused: true, agent_status: 'idle', cwd: null, foreground_cwd: '   ' }]
      }

      const result = await executeWorkspaceCreate(undefined, {
        workspaceId: 'ws-1',
        paneId: 'ws-1:p1',
        terminalId: 'term-1'
      }, {
        preSnapshot,
        deps: {
          sendSocketRequest: async () => {
            rpcCalls++
            return { type: 'workspace_created' }
          }
        }
      })

      expect(result.ok).toBe(false)
      expect(result.status).toBe(409)
      expect(result.outcome).toBe('rejected')
      expect(result.error).toContain('no usable current working directory')
      expect(rpcCalls).toBe(0)
    })

    it('fails closed on malformed snapshot arrays and duplicate exact IDs', async () => {
      delete process.env.HERDR_TRANSPORT
      const malformed = await executeWorkspaceCreate(undefined, undefined, {
        preSnapshot: { protocol: 22, version: '0.9.1', workspaces: null, tabs: [], panes: [] } as any
      })
      expect(malformed.status).toBe(502)
      expect(malformed.outcome).toBe('rejected')

      const duplicateSource: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [
          { workspace_id: 'ws-1' },
          { workspace_id: 'ws-1' }
        ],
        tabs: [],
        panes: [{ pane_id: 'ws-1:p1', workspace_id: 'ws-1', tab_id: 'tab-1', terminal_id: 'term-1', cwd: '/' }]
      }
      const duplicate = await executeWorkspaceCreate(undefined, {
        workspaceId: 'ws-1',
        paneId: 'ws-1:p1',
        terminalId: 'term-1'
      }, { preSnapshot: duplicateSource })
      expect(duplicate.status).toBe(409)
      expect(duplicate.outcome).toBe('rejected')
      expect(duplicate.error).toContain('duplicate workspace ID')
    })
  })

  describe('executeWorkspaceClose', () => {
    const originalEnv = { ...process.env }
    const closeTarget = (workspaceId: string, snapshot?: any) => ({
      workspaceId,
      expected: {
        tabIds: (snapshot?.tabs || []).filter((tab: any) => tab.workspace_id === workspaceId).map((tab: any) => tab.tab_id).sort(),
        paneIds: (snapshot?.panes || []).filter((pane: any) => pane.workspace_id === workspaceId).map((pane: any) => pane.pane_id).sort()
      }
    })

    it('refuses workspace close in CLI transport mode with 409 rejected', async () => {
      process.env.HERDR_TRANSPORT = 'cli'
      try {
        const res = await executeWorkspaceClose(closeTarget('ws-1'))
        expect(res.ok).toBe(false)
        expect(res.status).toBe(409)
        expect(res.outcome).toBe('rejected')
        expect(res.error).toContain('unavailable in CLI transport mode')
      } finally {
        process.env = { ...originalEnv }
      }
    })

    it('rejects numeric alias in preflight (exact literal snapshot ID required)', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-alpha', number: 1, label: 'Alpha', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [],
        panes: []
      }

      const res = await executeWorkspaceClose(closeTarget('1', preSnapshot), { preSnapshot })
      expect(res.ok).toBe(false)
      expect(res.status).toBe(404)
      expect(res.outcome).toBe('rejected')
      expect(res.error).toContain('Workspace "1" not found')
    })

    it('allows closing last Space without escalation, sends close_group: false', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-only-one', number: 1, label: 'Sole', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't-1', workspace_id: 'ws-only-one', number: 1, label: 'T', pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: [{ pane_id: 'p-1', workspace_id: 'ws-only-one', tab_id: 't-1', terminal_id: 'term-1', focused: true, agent_status: 'idle', cwd: '/' }]
      }

      const postSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [],
        tabs: [],
        panes: []
      }

      let sentParams: any = null
      const res = await executeWorkspaceClose(closeTarget('ws-only-one', preSnapshot), {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => postSnapshot,
          sendSocketRequest: async (_method, params) => {
            sentParams = params
            return { type: 'ok' }
          }
        }
      })

      expect(res.ok).toBe(true)
      expect(res.outcome).toBe('observed')
      expect(res.result).toEqual({ workspaceId: 'ws-only-one' })
      expect(sentParams).toEqual({ workspace_id: 'ws-only-one', close_group: false })
    })

    it('rejects group_required error without escalation or retry', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-group', number: 1, label: 'Grouped', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [],
        panes: []
      }

      let callCount = 0
      const res = await executeWorkspaceClose(closeTarget('ws-group', preSnapshot), {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => preSnapshot,
          sendSocketRequest: async () => {
            callCount++
            throw new HerdrSocketError('group_required', 'Workspace is part of a group')
          }
        }
      })

      expect(callCount).toBe(1)
      expect(res.ok).toBe(false)
      expect(res.status).toBe(409)
      expect(res.outcome).toBe('rejected')
      expect(res.error).toContain('Workspace is part of a group')
    })

    it('close ok but target or descendants remain returns outcome: unknown', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-stubborn', number: 1, label: 'Stubborn', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't-stubborn', workspace_id: 'ws-stubborn', number: 1, label: 'T', pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: [{ pane_id: 'p-stubborn', workspace_id: 'ws-stubborn', tab_id: 't-stubborn', terminal_id: 'term-1', focused: true, agent_status: 'idle', cwd: '/' }]
      }

      // Target workspace remains in post-snapshot
      const postWithWs: any = { ...preSnapshot }
      const resWsRemains = await executeWorkspaceClose(closeTarget('ws-stubborn', preSnapshot), {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => postWithWs,
          sendSocketRequest: async () => ({ type: 'ok' })
        }
      })
      expect(resWsRemains.ok).toBe(false)
      expect(resWsRemains.status).toBe(504)
      expect(resWsRemains.outcome).toBe('unknown')
      expect(resWsRemains.error).toContain('still present in post-close snapshot')

      // Workspace absent, but descendant tab remains in post-snapshot
      const postWithTab: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [],
        tabs: [{ tab_id: 't-stubborn', workspace_id: 'ws-stubborn', number: 1, label: 'T', pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: []
      }
      const resTabRemains = await executeWorkspaceClose(closeTarget('ws-stubborn', preSnapshot), {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => postWithTab,
          sendSocketRequest: async () => ({ type: 'ok' })
        }
      })
      expect(resTabRemains.ok).toBe(false)
      expect(resTabRemains.status).toBe(504)
      expect(resTabRemains.outcome).toBe('unknown')
      expect(resTabRemains.error).toContain('confirmed descendant tabs for workspace "ws-stubborn" still present')

      // Confirmed descendants remain globally after being reparented elsewhere.
      const postWithReparentedDescendants: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-survivor' }],
        tabs: [{ tab_id: 't-stubborn', workspace_id: 'ws-survivor' }],
        panes: [{ pane_id: 'p-stubborn', workspace_id: 'ws-survivor', tab_id: 't-stubborn' }]
      }
      const resReparented = await executeWorkspaceClose(closeTarget('ws-stubborn', preSnapshot), {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => postWithReparentedDescendants,
          sendSocketRequest: async () => ({ type: 'ok' })
        }
      })
      expect(resReparented.ok).toBe(false)
      expect(resReparented.status).toBe(504)
      expect(resReparented.outcome).toBe('unknown')
      expect(resReparented.error).toContain('confirmed descendant tabs')

      const postWithReparentedPaneOnly: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-survivor' }],
        tabs: [],
        panes: [{ pane_id: 'p-stubborn', workspace_id: 'ws-survivor', tab_id: 't-survivor' }]
      }
      const resReparentedPane = await executeWorkspaceClose(closeTarget('ws-stubborn', preSnapshot), {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => postWithReparentedPaneOnly,
          sendSocketRequest: async () => ({ type: 'ok' })
        }
      })
      expect(resReparentedPane.ok).toBe(false)
      expect(resReparentedPane.status).toBe(504)
      expect(resReparentedPane.outcome).toBe('unknown')
      expect(resReparentedPane.error).toContain('confirmed descendant panes')
    })

    it('rejects stale workspace manifests before RPC for added or missing tabs and panes', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-race' }],
        tabs: [
          { tab_id: 'tab-a', workspace_id: 'ws-race' },
          { tab_id: 'tab-b', workspace_id: 'ws-race' }
        ],
        panes: [
          { pane_id: 'pane-a', workspace_id: 'ws-race', tab_id: 'tab-a' },
          { pane_id: 'pane-b', workspace_id: 'ws-race', tab_id: 'tab-b' }
        ]
      }
      const staleExpected = [
        { tabIds: ['tab-a'], paneIds: ['pane-a', 'pane-b'] },
        { tabIds: ['tab-a', 'tab-b', 'tab-extra'], paneIds: ['pane-a', 'pane-b'] },
        { tabIds: ['tab-a', 'tab-b'], paneIds: ['pane-a'] },
        { tabIds: ['tab-a', 'tab-b'], paneIds: ['pane-a', 'pane-b', 'pane-extra'] }
      ]

      for (const expected of staleExpected) {
        let rpcCalls = 0
        const result = await executeWorkspaceClose({ workspaceId: 'ws-race', expected }, {
          preSnapshot,
          deps: {
            sendSocketRequest: async () => {
              rpcCalls++
              return { type: 'ok' }
            }
          }
        })
        expect(result.status).toBe(409)
        expect(result.outcome).toBe('rejected')
        expect(result.error).toContain('membership changed')
        expect(rpcCalls).toBe(0)
      }
    })

    it('timeout remains unknown even if target later absent', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-timeout', number: 1, label: 'T', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [],
        panes: []
      }

      const res = await executeWorkspaceClose(closeTarget('ws-timeout', preSnapshot), {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => ({ protocol: 22, version: '0.9.1', workspaces: [], tabs: [], panes: [] }),
          sendSocketRequest: async () => {
            throw new Error('Herdr socket request timed out after 5000ms')
          }
        }
      })

      expect(res.ok).toBe(false)
      expect(res.status).toBe(504)
      expect(res.outcome).toBe('unknown')
    })
  })

  describe('executeTabClose', () => {
    const originalEnv = { ...process.env }
    const closeTarget = (workspaceId: string, tabId: string, snapshot?: any) => ({
      workspaceId,
      tabId,
      expected: {
        paneIds: (snapshot?.panes || []).filter((pane: any) => pane.workspace_id === workspaceId && pane.tab_id === tabId).map((pane: any) => pane.pane_id).sort()
      }
    })

    it('refuses tab close in CLI transport mode with 409 rejected', async () => {
      process.env.HERDR_TRANSPORT = 'cli'
      try {
        const res = await executeTabClose(closeTarget('ws-1', 't-1'))
        expect(res.ok).toBe(false)
        expect(res.status).toBe(409)
        expect(res.outcome).toBe('rejected')
        expect(res.error).toContain('unavailable in CLI transport mode')
      } finally {
        process.env = { ...originalEnv }
      }
    })

    it('rejects last Tab in a Space with 409 and ZERO RPC sent', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-1', number: 1, label: 'Space 1', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't-only', workspace_id: 'ws-1', number: 1, label: 'Only Tab', pane_count: 1, focused: true, agent_status: 'idle' }],
        panes: [{ pane_id: 'p-1', workspace_id: 'ws-1', tab_id: 't-only', terminal_id: 'term-1', focused: true, agent_status: 'idle', cwd: '/' }]
      }

      let rpcSent = false
      const res = await executeTabClose(closeTarget('ws-1', 't-only', preSnapshot), {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => preSnapshot,
          sendSocketRequest: async () => {
            rpcSent = true
            return { type: 'ok' }
          }
        }
      })

      expect(rpcSent).toBe(false) // ZERO RPC!
      expect(res.ok).toBe(false)
      expect(res.status).toBe(409)
      expect(res.outcome).toBe('rejected')
      expect(res.error).toContain('Cannot close the last tab in a space; use Close Space instead.')
    })

    it('rejects tab belonging to a different workspace (wrong membership)', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [
          { workspace_id: 'ws-1', number: 1, label: 'W1', agent_status: 'idle', tab_count: 2, pane_count: 2, focused: true },
          { workspace_id: 'ws-2', number: 2, label: 'W2', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: false }
        ],
        tabs: [
          { tab_id: 't-1', workspace_id: 'ws-1', number: 1, label: 'T1', pane_count: 1, focused: true, agent_status: 'idle' },
          { tab_id: 't-2', workspace_id: 'ws-1', number: 2, label: 'T2', pane_count: 1, focused: false, agent_status: 'idle' },
          { tab_id: 't-other', workspace_id: 'ws-2', number: 1, label: 'TOther', pane_count: 1, focused: false, agent_status: 'idle' }
        ],
        panes: []
      }

      const res = await executeTabClose(closeTarget('ws-1', 't-other', preSnapshot), { preSnapshot })
      expect(res.ok).toBe(false)
      expect(res.status).toBe(400)
      expect(res.outcome).toBe('rejected')
      expect(res.error).toContain('does not belong to workspace "ws-1"')
    })

    it('rejects stale tab manifests before RPC for added or missing panes', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-1' }],
        tabs: [
          { tab_id: 'tab-keep', workspace_id: 'ws-1' },
          { tab_id: 'tab-race', workspace_id: 'ws-1' }
        ],
        panes: [
          { pane_id: 'pane-a', workspace_id: 'ws-1', tab_id: 'tab-race' },
          { pane_id: 'pane-b', workspace_id: 'ws-1', tab_id: 'tab-race' }
        ]
      }

      for (const paneIds of [['pane-a'], ['pane-a', 'pane-b', 'pane-extra']]) {
        let rpcCalls = 0
        const result = await executeTabClose({
          workspaceId: 'ws-1',
          tabId: 'tab-race',
          expected: { paneIds }
        }, {
          preSnapshot,
          deps: {
            sendSocketRequest: async () => {
              rpcCalls++
              return { type: 'ok' }
            }
          }
        })
        expect(result.status).toBe(409)
        expect(result.outcome).toBe('rejected')
        expect(result.error).toContain('membership changed')
        expect(rpcCalls).toBe(0)
      }
    })

    it('sends tab.close, proves target/descendant absent and workspace remains, returns observed', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-1', number: 1, label: 'W1', agent_status: 'idle', tab_count: 2, pane_count: 2, focused: true }],
        tabs: [
          { tab_id: 't-keep', workspace_id: 'ws-1', number: 1, label: 'Keep', pane_count: 1, focused: true, agent_status: 'idle' },
          { tab_id: 't-close', workspace_id: 'ws-1', number: 2, label: 'Close', pane_count: 1, focused: false, agent_status: 'idle' }
        ],
        panes: [
          { pane_id: 'p-keep', workspace_id: 'ws-1', tab_id: 't-keep', terminal_id: 'term-keep', focused: true, agent_status: 'idle', cwd: '/' },
          { pane_id: 'p-close', workspace_id: 'ws-1', tab_id: 't-close', terminal_id: 'term-close', focused: false, agent_status: 'idle', cwd: '/' }
        ]
      }

      const postSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-1', number: 1, label: 'W1', agent_status: 'idle', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [
          { tab_id: 't-keep', workspace_id: 'ws-1', number: 1, label: 'Keep', pane_count: 1, focused: true, agent_status: 'idle' }
        ],
        panes: [
          { pane_id: 'p-keep', workspace_id: 'ws-1', tab_id: 't-keep', terminal_id: 'term-keep', focused: true, agent_status: 'idle', cwd: '/' }
        ]
      }

      let sentParams: any = null
      const res = await executeTabClose(closeTarget('ws-1', 't-close', preSnapshot), {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => postSnapshot,
          sendSocketRequest: async (_method, params) => {
            sentParams = params
            return { type: 'ok' }
          }
        }
      })

      expect(res.ok).toBe(true)
      expect(res.outcome).toBe('observed')
      expect(res.result).toEqual({ workspaceId: 'ws-1', tabId: 't-close' })
      expect(sentParams).toEqual({ tab_id: 't-close' })
    })

    it('tab close ok but tab or descendant pane remains returns outcome: unknown', async () => {
      delete process.env.HERDR_TRANSPORT
      const preSnapshot: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-1', number: 1, label: 'W1', agent_status: 'idle', tab_count: 2, pane_count: 2, focused: true }],
        tabs: [
          { tab_id: 't-1', workspace_id: 'ws-1', number: 1, label: 'T1', pane_count: 1, focused: true, agent_status: 'idle' },
          { tab_id: 't-2', workspace_id: 'ws-1', number: 2, label: 'T2', pane_count: 1, focused: false, agent_status: 'idle' }
        ],
        panes: [
          { pane_id: 'p-1', workspace_id: 'ws-1', tab_id: 't-1', terminal_id: 'term-1', focused: true, agent_status: 'idle', cwd: '/' },
          { pane_id: 'p-2', workspace_id: 'ws-1', tab_id: 't-2', terminal_id: 'term-2', focused: false, agent_status: 'idle', cwd: '/' }
        ]
      }

      // Post-snapshot still contains t-2
      const resTabRemains = await executeTabClose(closeTarget('ws-1', 't-2', preSnapshot), {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => preSnapshot,
          sendSocketRequest: async () => ({ type: 'ok' })
        }
      })
      expect(resTabRemains.ok).toBe(false)
      expect(resTabRemains.status).toBe(504)
      expect(resTabRemains.outcome).toBe('unknown')
      expect(resTabRemains.error).toContain('still present in post-close snapshot')

      const postWithReparentedPane: any = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws-1' }],
        tabs: [{ tab_id: 't-1', workspace_id: 'ws-1' }],
        panes: [{ pane_id: 'p-2', workspace_id: 'ws-1', tab_id: 't-1' }]
      }
      const resReparentedPane = await executeTabClose(closeTarget('ws-1', 't-2', preSnapshot), {
        preSnapshot,
        deps: {
          fetchSnapshot: async () => postWithReparentedPane,
          sendSocketRequest: async () => ({ type: 'ok' })
        }
      })
      expect(resReparentedPane.ok).toBe(false)
      expect(resReparentedPane.status).toBe(504)
      expect(resReparentedPane.outcome).toBe('unknown')
      expect(resReparentedPane.error).toContain('confirmed descendant panes')
    })
  })
})
