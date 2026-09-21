import { describe, expect, it, beforeEach } from 'bun:test'
import {
  buildTerminalControlArgv,
  canAcceptTerminalControlMessage,
  validateTerminalControlParams,
  validateTerminalControlMessage,
  parseAndValidateUpstreamTerminalMessage,
  getPublicPreflightErrorMessage,
  sanitizeStderrToCategory,
  preflightShellPane,
  sanitizeStderrOutput,
  TerminalControlLeaseManager,
  MAX_INPUT_TEXT_UTF8_BYTES,
  type IControlClientMessage
} from '../terminal-control.ts'
import type { ISnapshotResult, IPane } from '../types.ts'

describe('terminal-control: child argv builder', () => {
  it('builds exact argv without --takeover or shell interpolation', () => {
    const argv = buildTerminalControlArgv('ws1:p1', 80, 24)
    expect(argv).toEqual([
      'herdr',
      'terminal',
      'session',
      'control',
      'ws1:p1',
      '--cols',
      '80',
      '--rows',
      '24'
    ])
    expect(argv).not.toContain('--takeover')
  })

  it('rejects out-of-bounds or non-integer cols and rows rather than clamping', () => {
    expect(() => buildTerminalControlArgv('ws1:p1', 10, 5)).toThrow(/Invalid cols/)
    expect(() => buildTerminalControlArgv('ws1:p1', 80, 5)).toThrow(/Invalid rows/)
    expect(() => buildTerminalControlArgv('ws1:p1', 500, 24)).toThrow(/Invalid cols/)
    expect(() => buildTerminalControlArgv('ws1:p1', 80, 200)).toThrow(/Invalid rows/)
    expect(() => buildTerminalControlArgv('ws1:p1', 80.5, 24)).toThrow(/Invalid cols/)
    expect(() => buildTerminalControlArgv('ws1:p1', 80, 24.5)).toThrow(/Invalid rows/)
  })

  it('throws on invalid pane ID format', () => {
    expect(() => buildTerminalControlArgv('invalid_pane', 80, 24)).toThrow(/Invalid paneId/)
    expect(() => buildTerminalControlArgv('ws;rm -rf /', 80, 24)).toThrow(/Invalid paneId/)
  })
})

describe('terminal-control: query parameter validation', () => {
  it('validates correct query parameters', () => {
    const url = new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1&cols=120&rows=40')
    const res = validateTerminalControlParams(url)
    expect(res.valid).toBe(true)
    expect(res.data).toEqual({
      pane: 'ws1:p1',
      cols: 120,
      rows: 40
    })
  })

  it('uses default cols 80 and rows 24 when omitted', () => {
    const url = new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1')
    const res = validateTerminalControlParams(url)
    expect(res.valid).toBe(true)
    expect(res.data).toEqual({
      pane: 'ws1:p1',
      cols: 80,
      rows: 24
    })
  })

  it('rejects missing or malformed pane query parameter', () => {
    const missing = new URL('http://127.0.0.1:8787/api/terminal/control')
    expect(validateTerminalControlParams(missing).valid).toBe(false)

    const malformed = new URL('http://127.0.0.1:8787/api/terminal/control?pane=bad_pane')
    expect(validateTerminalControlParams(malformed).valid).toBe(false)
  })

  it('rejects out-of-bounds cols and rows', () => {
    const lowCols = new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1&cols=20')
    expect(validateTerminalControlParams(lowCols).valid).toBe(false)

    const highCols = new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1&cols=300')
    expect(validateTerminalControlParams(highCols).valid).toBe(false)

    const lowRows = new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1&rows=5')
    expect(validateTerminalControlParams(lowRows).valid).toBe(false)

    const highRows = new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1&rows=100')
    expect(validateTerminalControlParams(highRows).valid).toBe(false)
  })

  it('rejects non-canonical decimal integers, signs, whitespace, and exponents', () => {
    expect(validateTerminalControlParams(new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1&cols=80junk')).valid).toBe(false)
    expect(validateTerminalControlParams(new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1&cols=+80')).valid).toBe(false)
    expect(validateTerminalControlParams(new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1&cols=%2080%20')).valid).toBe(false)
    expect(validateTerminalControlParams(new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1&cols=1e2')).valid).toBe(false)
    expect(validateTerminalControlParams(new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1&rows=24junk')).valid).toBe(false)
    expect(validateTerminalControlParams(new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1&rows=+24')).valid).toBe(false)
  })

  it('rejects duplicate pane, cols, or rows parameters', () => {
    expect(validateTerminalControlParams(new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1&pane=ws1:p2')).valid).toBe(false)
    expect(validateTerminalControlParams(new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1&cols=80&cols=80')).valid).toBe(false)
    expect(validateTerminalControlParams(new URL('http://127.0.0.1:8787/api/terminal/control?pane=ws1:p1&rows=24&rows=24')).valid).toBe(false)
  })
})

describe('terminal-control: client message schema validation', () => {
  it('accepts valid terminal.input message within 4096 UTF-8 bytes limit', () => {
    const msg: IControlClientMessage = { type: 'terminal.input', text: 'ls -la\n' }
    const res = validateTerminalControlMessage(msg)
    expect(res.valid).toBe(true)
    expect(res.data).toEqual(msg)
  })

  it('rejects terminal.input with empty text or extra fields', () => {
    expect(validateTerminalControlMessage({ type: 'terminal.input', text: '' }).valid).toBe(false)
    expect(validateTerminalControlMessage({ type: 'terminal.input', text: 'hi', extra: true }).valid).toBe(false)
    expect(validateTerminalControlMessage({ type: 'terminal.input' }).valid).toBe(false)
  })

  it('rejects terminal.input exceeding 4096 UTF-8 bytes', () => {
    const oversized = 'a'.repeat(MAX_INPUT_TEXT_UTF8_BYTES + 1)
    const res = validateTerminalControlMessage({ type: 'terminal.input', text: oversized })
    expect(res.valid).toBe(false)
    expect(res.error).toContain('exceeds maximum length')
  })

  it('accepts valid terminal.resize within bounds', () => {
    const msg: IControlClientMessage = { type: 'terminal.resize', cols: 100, rows: 30 }
    const res = validateTerminalControlMessage(msg)
    expect(res.valid).toBe(true)
    expect(res.data).toEqual(msg)
  })

  it('rejects terminal.resize with out-of-bound dimensions or extra fields', () => {
    expect(validateTerminalControlMessage({ type: 'terminal.resize', cols: 10, rows: 30 }).valid).toBe(false)
    expect(validateTerminalControlMessage({ type: 'terminal.resize', cols: 100, rows: 100 }).valid).toBe(false)
    expect(validateTerminalControlMessage({ type: 'terminal.resize', cols: 100, rows: 30, note: 'extra' }).valid).toBe(false)
  })

  it('accepts terminal.release with exactly one field', () => {
    const res = validateTerminalControlMessage({ type: 'terminal.release' })
    expect(res.valid).toBe(true)
    expect(res.data).toEqual({ type: 'terminal.release' })

    const withExtra = validateTerminalControlMessage({ type: 'terminal.release', reason: 'done' })
    expect(withExtra.valid).toBe(false)
  })

  it('rejects unknown message types, arrays, or non-object payloads', () => {
    expect(validateTerminalControlMessage({ type: 'unknown' }).valid).toBe(false)
    expect(validateTerminalControlMessage(['terminal.input']).valid).toBe(false)
    expect(validateTerminalControlMessage('not-json').valid).toBe(false)
    expect(validateTerminalControlMessage(null).valid).toBe(false)
  })
})

describe('terminal-control: preflight checks', () => {
  const mockIdleShellSnapshot = (paneId: string): ISnapshotResult => ({
    protocol: 22,
    version: '0.9.1',
    workspaces: [
      {
        workspace_id: 'ws1',
        label: 'Workspace 1',
        number: 1,
        agent_status: 'idle',
        tab_count: 1,
        pane_count: 1,
        focused: true
      }
    ],
    panes: [
      {
        pane_id: paneId,
        workspace_id: 'ws1',
        tab_id: 't1',
        cwd: '/tmp',
        agent: null,
        display_agent: null
      } as unknown as IPane
    ],
    tabs: [],
    agents: []
  })

  const mockIdleProcessInfo = (paneId: string, pid = 12345) => ({
    pane_id: paneId,
    shell_pid: pid,
    foreground_process_group_id: pid,
    foreground_processes: [
      {
        pid,
        cmdline: '/bin/zsh'
      }
    ],
    tty: '/dev/ttys001'
  })

  it('passes preflight for an idle shell pane with matching PID/PGID', async () => {
    const paneId = 'ws1:p1'
    const res = await preflightShellPane(paneId, {
      fetchSnapshot: async () => mockIdleShellSnapshot(paneId),
      fetchProcessInfo: async () => mockIdleProcessInfo(paneId, 5555)
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.paneId).toBe(paneId)
      expect(res.shellPid).toBe(5555)
      expect(res.pgid).toBe(5555)
    }
  })

  it('refuses preflight if target pane has agent or display_agent', async () => {
    const paneId = 'ws1:p1'
    const snap = mockIdleShellSnapshot(paneId)
    snap.panes[0].agent = 'claude'

    const res = await preflightShellPane(paneId, {
      fetchSnapshot: async () => snap,
      fetchProcessInfo: async () => mockIdleProcessInfo(paneId)
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('agent_pane_refusal')
      expect(res.status).toBe(422)
    }
  })

  it('refuses preflight if snapshot agents list contains an agent owning the pane', async () => {
    const paneId = 'ws1:p1'
    const snap = mockIdleShellSnapshot(paneId)
    snap.agents = [{ agent_id: 'a1', target: paneId, agent: 'codex' } as any]

    const res = await preflightShellPane(paneId, {
      fetchSnapshot: async () => snap,
      fetchProcessInfo: async () => mockIdleProcessInfo(paneId)
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('agent_pane_refusal')
      expect(res.status).toBe(422)
    }
  })

  it('refuses preflight if shell is busy executing a foreground command (PGID != shell_pid)', async () => {
    const paneId = 'ws1:p1'
    const busyInfo = {
      pane_id: paneId,
      shell_pid: 1000,
      foreground_process_group_id: 2000, // Different PGID (e.g. running vim or compiler)
      foreground_processes: [{ pid: 2000, cmdline: 'vim file.txt' }]
    }

    const res = await preflightShellPane(paneId, {
      fetchSnapshot: async () => mockIdleShellSnapshot(paneId),
      fetchProcessInfo: async () => busyInfo
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('busy_shell_refusal')
      expect(res.status).toBe(409)
    }
  })

  it('refuses preflight if multiple foreground processes are detected', async () => {
    const paneId = 'ws1:p1'
    const multiInfo = {
      pane_id: paneId,
      shell_pid: 1000,
      foreground_process_group_id: 1000,
      foreground_processes: [
        { pid: 1000, cmdline: 'sh' },
        { pid: 1001, cmdline: 'sleep 10' }
      ]
    }

    const res = await preflightShellPane(paneId, {
      fetchSnapshot: async () => mockIdleShellSnapshot(paneId),
      fetchProcessInfo: async () => multiInfo
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('busy_shell_refusal')
      expect(res.status).toBe(409)
    }
  })

  it('refuses preflight if pane is not in snapshot', async () => {
    const snap = mockIdleShellSnapshot('ws1:p1')
    const res = await preflightShellPane('ws1:p2', {
      fetchSnapshot: async () => snap,
      fetchProcessInfo: async () => mockIdleProcessInfo('ws1:p2')
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('pane_not_found')
      expect(res.status).toBe(404)
    }
  })

  it('fails closed when process info call fails', async () => {
    const paneId = 'ws1:p1'
    const res = await preflightShellPane(paneId, {
      fetchSnapshot: async () => mockIdleShellSnapshot(paneId),
      fetchProcessInfo: async () => {
        throw new Error('Connection refused')
      }
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe('process_info_unavailable')
      expect(res.status).toBe(502)
    }
  })
})

describe('terminal-control: lease manager lifecycle', () => {
  let manager: TerminalControlLeaseManager

  beforeEach(() => {
    manager = new TerminalControlLeaseManager()
  })

  it('permits exactly one global active lease at a time', () => {
    const res1 = manager.reserveLease('ws1:p1')
    expect(res1.ok).toBe(true)

    // Second reservation must be rejected with 409
    const res2 = manager.reserveLease('ws1:p2')
    expect(res2.ok).toBe(false)
    if (!res2.ok) {
      expect(res2.status).toBe(409)
    }
  })

  it('allows reservation after previous lease is released', async () => {
    const res1 = manager.reserveLease('ws1:p1')
    expect(res1.ok).toBe(true)
    if (res1.ok) {
      await manager.releaseLease(res1.lease.id, 'test_release')
    }

    const res2 = manager.reserveLease('ws1:p2')
    expect(res2.ok).toBe(true)
  })

  it('generates unguessable server tokens and tracks expiration', () => {
    const res = manager.reserveLease('ws1:p1')
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.lease.id).toBeDefined()
      expect(typeof res.lease.id).toBe('string')
      expect(res.lease.id.length).toBeGreaterThan(16)
      expect(res.lease.expiresAt).toBeGreaterThan(Date.now())
    }
  })
})

describe('terminal-control: stderr output sanitization', () => {
  it('strips absolute file paths from stderr output', () => {
    const text = 'Error in /Users/example/.config/herdr/sessions/main/herdr.sock: connection refused'
    const sanitized = sanitizeStderrOutput(text)
    expect(sanitized).not.toContain('/Users/example')
    expect(sanitized).toContain('[path]')
  })

  it('strips tokens and PIDs from stderr output', () => {
    const text = 'Process failure: pid=12345 token=secret_token_12345 failed'
    const sanitized = sanitizeStderrOutput(text)
    expect(sanitized).not.toContain('12345')
    expect(sanitized).not.toContain('secret_token')
  })
})

describe('terminal-control: upstream stdout envelope validation', () => {
  it('validates a valid terminal.frame message', () => {
    const frame = JSON.stringify({
      type: 'terminal.frame',
      seq: 1,
      encoding: 'ansi',
      width: 80,
      height: 24,
      full: false,
      bytes: Buffer.from('hello').toString('base64')
    })
    const res = parseAndValidateUpstreamTerminalMessage(frame)
    expect(res.valid).toBe(true)
    expect(res.data?.type).toBe('terminal.frame')
  })

  it('rejects terminal.frame with negative or non-integer seq', () => {
    const invalidSeq = JSON.stringify({
      type: 'terminal.frame',
      seq: -1,
      encoding: 'ansi',
      width: 80,
      height: 24,
      full: false,
      bytes: 'aGVsbG8='
    })
    expect(parseAndValidateUpstreamTerminalMessage(invalidSeq).valid).toBe(false)
  })

  it('rejects terminal.frame with invalid encoding or dimensions out of bounds', () => {
    const wrongEncoding = JSON.stringify({
      type: 'terminal.frame',
      seq: 0,
      encoding: 'utf-8',
      width: 80,
      height: 24,
      full: false,
      bytes: 'aGVsbG8='
    })
    expect(parseAndValidateUpstreamTerminalMessage(wrongEncoding).valid).toBe(false)

    const outOfBounds = JSON.stringify({
      type: 'terminal.frame',
      seq: 0,
      encoding: 'ansi',
      width: 10,
      height: 24,
      full: false,
      bytes: 'aGVsbG8='
    })
    expect(parseAndValidateUpstreamTerminalMessage(outOfBounds).valid).toBe(false)
  })

  it('rejects terminal.frame with extra fields or malformed base64', () => {
    const extraFields = JSON.stringify({
      type: 'terminal.frame',
      seq: 0,
      encoding: 'ansi',
      width: 80,
      height: 24,
      full: false,
      bytes: 'aGVsbG8=',
      extra: 'not allowed'
    })
    expect(parseAndValidateUpstreamTerminalMessage(extraFields).valid).toBe(false)

    const badBase64 = JSON.stringify({
      type: 'terminal.frame',
      seq: 0,
      encoding: 'ansi',
      width: 80,
      height: 24,
      full: false,
      bytes: 'not-base64-%%%'
    })
    expect(parseAndValidateUpstreamTerminalMessage(badBase64).valid).toBe(false)
  })

  it('validates a valid terminal.closed message', () => {
    const closedWithReason = JSON.stringify({ type: 'terminal.closed', reason: 'detached' })
    const res = parseAndValidateUpstreamTerminalMessage(closedWithReason)
    expect(res.valid).toBe(true)
    expect(res.data?.type).toBe('terminal.closed')

    const closedWithoutReason = JSON.stringify({ type: 'terminal.closed' })
    expect(parseAndValidateUpstreamTerminalMessage(closedWithoutReason).valid).toBe(true)
  })

  it('rejects terminal.closed with extra fields or oversized reason', () => {
    const extra = JSON.stringify({ type: 'terminal.closed', reason: 'detached', extra: true })
    expect(parseAndValidateUpstreamTerminalMessage(extra).valid).toBe(false)

    const oversized = JSON.stringify({ type: 'terminal.closed', reason: 'a'.repeat(101) })
    expect(parseAndValidateUpstreamTerminalMessage(oversized).valid).toBe(false)
  })

  it('rejects non-JSON or unsupported envelope types', () => {
    expect(parseAndValidateUpstreamTerminalMessage('invalid-json').valid).toBe(false)
    expect(parseAndValidateUpstreamTerminalMessage(JSON.stringify({ type: 'unknown.type' })).valid).toBe(false)
  })
})

describe('terminal-control: public preflight errors & stderr categorization', () => {
  it('maps known preflight codes to bounded public error messages', () => {
    expect(getPublicPreflightErrorMessage('agent_pane_refusal')).toBe('Terminal control is not available for agent panes')
    expect(getPublicPreflightErrorMessage('busy_shell_refusal')).toBe('Pane is executing another foreground process or busy')
    expect(getPublicPreflightErrorMessage('pane_not_found')).toBe('Pane not found in active session')
    expect(getPublicPreflightErrorMessage('unknown_code')).toBe('Terminal control preflight validation failed')
  })

  it('categorizes stderr into fixed browser-safe categories', () => {
    expect(sanitizeStderrToCategory('Permission denied: /dev/ttys001')).toBe('permission_denied')
    expect(sanitizeStderrToCategory('ENOENT: no such file or directory')).toBe('resource_not_found')
    expect(sanitizeStderrToCategory('resource busy or in use')).toBe('resource_busy')
    expect(sanitizeStderrToCategory('invalid argument passed')).toBe('invalid_argument')
    expect(sanitizeStderrToCategory('unexpected crash occurred')).toBe('child_process_error')
    expect(sanitizeStderrToCategory('   ')).toBe('empty')
  })
})

describe('terminal-control: lease manager reentrancy & idempotency', () => {
  it('releaseLease is idempotent and handles concurrent calls safely', async () => {
    const manager = new TerminalControlLeaseManager()
    const res = manager.reserveLease('ws1:p1')
    expect(res.ok).toBe(true)
    if (res.ok) {
      const release1 = manager.releaseLease(res.lease.id, 'concurrent_1')
      const release2 = manager.releaseLease(res.lease.id, 'concurrent_2')
      await Promise.all([release1, release2])
      expect(manager.getActiveLease()).toBeNull()
    }
  })
})

describe('terminal-control: pre-ready message rejection helper', () => {
  it('rejects client messages when controlReady is false', () => {
    expect(canAcceptTerminalControlMessage(false)).toBe(false)
    expect(canAcceptTerminalControlMessage(false, false)).toBe(false)
    expect(canAcceptTerminalControlMessage(false, true)).toBe(false)
  })

  it('rejects client messages when connection is closed', () => {
    expect(canAcceptTerminalControlMessage(true, true)).toBe(false)
  })

  it('accepts client messages only when controlReady is true and not closed', () => {
    expect(canAcceptTerminalControlMessage(true)).toBe(true)
    expect(canAcceptTerminalControlMessage(true, false)).toBe(true)
  })

  it('releases lease with pre_ready_input_rejected if message arrives before ready', async () => {
    const manager = new TerminalControlLeaseManager()
    const reserved = manager.reserveLease('ws1:p1')
    expect(reserved.ok).toBe(true)
    if (!reserved.ok) return

    const leaseId = reserved.lease.id
    // Simulate ws data state before ready
    let controlReady = false
    let leaseReleasedReason: string | null = null

    // Handler logic under test: fails closed on pre-ready message
    if (!controlReady) {
      await manager.releaseLease(leaseId, 'pre_ready_input_rejected')
      leaseReleasedReason = 'pre_ready_input_rejected'
    }

    expect(leaseReleasedReason).toBe('pre_ready_input_rejected')
    expect(manager.getActiveLease()).toBeNull()
  })

  it('enforces lease teardown exclusivity while proc exit is pending', async () => {
    const manager = new TerminalControlLeaseManager()
    const res1 = manager.reserveLease('ws1:p1')
    expect(res1.ok).toBe(true)
    if (!res1.ok) return

    const writes: string[] = []
    let resolveExit!: (code: number) => void
    const exitedPromise = new Promise<number>((resolve) => {
      resolveExit = resolve
    })

    const mockProc = {
      stdin: {
        write: (data: string) => {
          writes.push(data)
          return data.length
        },
        flush: () => {}
      },
      exited: exitedPromise,
      kill: () => {}
    } as any

    const activated = manager.activateLease(res1.lease.id, mockProc, null)
    expect(activated).toBe(true)

    // Start release without awaiting
    const releasePromise1 = manager.releaseLease(res1.lease.id, 'teardown')

    // While release is pending, lease status must be 'releasing'
    expect(res1.lease.status).toBe('releasing')

    // Concurrent release call must return the exact same promise instance
    const releasePromise2 = manager.releaseLease(res1.lease.id, 'concurrent_teardown')
    expect(releasePromise2).toBe(releasePromise1)

    // While pending, second reservation for same or other pane must be rejected
    const secondReserveSame = manager.reserveLease('ws1:p1')
    expect(secondReserveSame.ok).toBe(false)
    if (!secondReserveSame.ok) {
      expect(secondReserveSame.status).toBe(409)
      expect(secondReserveSame.error).toContain('already active or pending')
    }

    const secondReserveOther = manager.reserveLease('ws1:p2')
    expect(secondReserveOther.ok).toBe(false)
    if (!secondReserveOther.ok) {
      expect(secondReserveOther.status).toBe(409)
      expect(secondReserveOther.error).toContain('already active or pending')
    }

    // Resolve exit to allow teardown to complete
    resolveExit(0)
    await releasePromise1

    // Assert lease is now released and currentLease is null
    expect(res1.lease.status).toBe('released')
    expect(manager.getActiveLease()).toBeNull()

    // Assert child release was written to stdin
    expect(writes).toEqual([JSON.stringify({ type: 'terminal.release' }) + '\n'])

    // Only then reservation succeeds without overlap
    const res3 = manager.reserveLease('ws1:p2')
    expect(res3.ok).toBe(true)
    if (res3.ok) {
      expect(res3.lease.paneId).toBe('ws1:p2')
      expect(manager.getActiveLease()?.id).toBe(res3.lease.id)
    }
  })
})
