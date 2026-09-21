import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  executeKeys,
  executePrompt,
  executeTerminalInput,
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
})
