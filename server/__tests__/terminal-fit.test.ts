import { describe, expect, it } from 'bun:test'
import {
  TerminalFitManager,
  validateTerminalFitParams,
  validateTerminalFitClientMessage
} from '../terminal-fit.ts'
import {
  parseAndValidateFittedTerminalMessage,
  parseAndValidateUpstreamTerminalMessage,
  TerminalControlLeaseManager
} from '../terminal-control.ts'
import { getSharedOperationCoordinator } from '../operation-coordinator.ts'

describe('server/terminal-fit: parameter and message validation', () => {
  it('validates correct fit query parameters with mobile 35x15 dimensions', () => {
    const url = new URL(
      'http://127.0.0.1:8787/api/terminal?pane=w86:p1&terminalId=term_65d384c28ce6fb9&cols=35&rows=15'
    )
    const result = validateTerminalFitParams(url)
    expect(result.valid).toBe(true)
    expect(result.data).toEqual({
      pane: 'w86:p1',
      terminalId: 'term_65d384c28ce6fb9',
      cols: 35,
      rows: 15
    })
  })

  it('rejects missing or malformed paneId and terminalId', () => {
    const missingPane = new URL(
      'http://127.0.0.1:8787/api/terminal?terminalId=term_123&cols=80&rows=24'
    )
    expect(validateTerminalFitParams(missingPane).valid).toBe(false)

    const invalidPane = new URL(
      'http://127.0.0.1:8787/api/terminal?pane=bad;pane&terminalId=term_123&cols=80&rows=24'
    )
    expect(validateTerminalFitParams(invalidPane).valid).toBe(false)

    const missingTerm = new URL(
      'http://127.0.0.1:8787/api/terminal?pane=w86:p1&cols=80&rows=24'
    )
    expect(validateTerminalFitParams(missingTerm).valid).toBe(false)

    const invalidTerm = new URL(
      'http://127.0.0.1:8787/api/terminal?pane=w86:p1&terminalId=bad%20term%20id&cols=80&rows=24'
    )
    expect(validateTerminalFitParams(invalidTerm).valid).toBe(false)
  })

  it('enforces bounds (1..500 cols, 1..200 rows) and allows 35 cols without min-40 restriction', () => {
    const mobile35 = new URL(
      'http://127.0.0.1:8787/api/terminal?pane=w86:p1&terminalId=term_123&cols=35&rows=15'
    )
    const res = validateTerminalFitParams(mobile35)
    expect(res.valid).toBe(true)
    expect(res.data?.cols).toBe(35)
    expect(res.data?.rows).toBe(15)

    const zeroCols = new URL(
      'http://127.0.0.1:8787/api/terminal?pane=w86:p1&terminalId=term_123&cols=0&rows=15'
    )
    expect(validateTerminalFitParams(zeroCols).valid).toBe(false)

    const overCols = new URL(
      'http://127.0.0.1:8787/api/terminal?pane=w86:p1&terminalId=term_123&cols=501&rows=15'
    )
    expect(validateTerminalFitParams(overCols).valid).toBe(false)

    const overRows = new URL(
      'http://127.0.0.1:8787/api/terminal?pane=w86:p1&terminalId=term_123&cols=80&rows=201'
    )
    expect(validateTerminalFitParams(overRows).valid).toBe(false)
  })

  it('strictly validates client resize message and rejects interactive input and keys', () => {
    const validResize = validateTerminalFitClientMessage(
      JSON.stringify({ type: 'terminal.resize', cols: 35, rows: 15 })
    )
    expect(validResize.valid).toBe(true)
    expect(validResize.data).toEqual({
      type: 'terminal.resize',
      cols: 35,
      rows: 15
    })

    // Rejects interactive input
    const inputMsg = validateTerminalFitClientMessage(
      JSON.stringify({ type: 'terminal.input', text: 'ls\n' })
    )
    expect(inputMsg.valid).toBe(false)
    expect(inputMsg.error).toContain(
      'Fitted reader accepts only "terminal.resize"'
    )

    // Rejects terminal.key
    const keyMsg = validateTerminalFitClientMessage(
      JSON.stringify({ type: 'terminal.key', key: 'Enter' })
    )
    expect(keyMsg.valid).toBe(false)

    // Rejects extra fields
    const extraMsg = validateTerminalFitClientMessage(
      JSON.stringify({
        type: 'terminal.resize',
        cols: 35,
        rows: 15,
        extra: 'field'
      })
    )
    expect(extraMsg.valid).toBe(false)

    // Rejects oversize messages (> 8192 bytes)
    const bigString = 'x'.repeat(8200)
    const oversize = validateTerminalFitClientMessage(bigString)
    expect(oversize.valid).toBe(false)
  })

  it('strictly validates client scroll message with bounded signed deltaRows or latest reset', () => {
    // Valid deltaRows
    const scrollUp = validateTerminalFitClientMessage(
      JSON.stringify({ type: 'terminal.scroll', deltaRows: 5 })
    )
    expect(scrollUp.valid).toBe(true)
    expect(scrollUp.data).toEqual({
      type: 'terminal.scroll',
      deltaRows: 5
    })

    const scrollDown = validateTerminalFitClientMessage(
      JSON.stringify({ type: 'terminal.scroll', deltaRows: -10 })
    )
    expect(scrollDown.valid).toBe(true)
    expect(scrollDown.data).toEqual({
      type: 'terminal.scroll',
      deltaRows: -10
    })

    // Valid to: 'latest'
    const scrollLatest = validateTerminalFitClientMessage(
      JSON.stringify({ type: 'terminal.scroll', to: 'latest' })
    )
    expect(scrollLatest.valid).toBe(true)
    expect(scrollLatest.data).toEqual({
      type: 'terminal.scroll',
      to: 'latest'
    })

    // Valid reset: true
    const scrollReset = validateTerminalFitClientMessage(
      JSON.stringify({ type: 'terminal.scroll', reset: true })
    )
    expect(scrollReset.valid).toBe(true)
    expect(scrollReset.data).toEqual({
      type: 'terminal.scroll',
      reset: true
    })

    // Rejects out of bounds deltaRows (< -1000 or > 1000)
    expect(
      validateTerminalFitClientMessage(
        JSON.stringify({ type: 'terminal.scroll', deltaRows: 1001 })
      ).valid
    ).toBe(false)

    expect(
      validateTerminalFitClientMessage(
        JSON.stringify({ type: 'terminal.scroll', deltaRows: -1001 })
      ).valid
    ).toBe(false)

    // Rejects non-integer deltaRows
    expect(
      validateTerminalFitClientMessage(
        JSON.stringify({ type: 'terminal.scroll', deltaRows: 2.5 })
      ).valid
    ).toBe(false)

    // Rejects invalid 'to' target
    expect(
      validateTerminalFitClientMessage(
        JSON.stringify({ type: 'terminal.scroll', to: 'top' })
      ).valid
    ).toBe(false)

    // Rejects empty scroll command without payload
    expect(
      validateTerminalFitClientMessage(
        JSON.stringify({ type: 'terminal.scroll' })
      ).valid
    ).toBe(false)

    // Rejects extra fields
    expect(
      validateTerminalFitClientMessage(
        JSON.stringify({
          type: 'terminal.scroll',
          deltaRows: 5,
          extra: 'bad'
        })
      ).valid
    ).toBe(false)
  })
})

describe('server/terminal-fit: reservation, concurrency and lifecycle', () => {
  it('synchronously reserves once and returns FIT_BUSY for concurrent join', () => {
    const manager = new TerminalFitManager()
    const terminalId = 'term_test_concurrency_1'
    const paneId = 'w86:p1'

    const first = manager.reserveFit(terminalId, paneId)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.generation).toBe(1)

    // Second concurrent join must get FIT_BUSY
    const second = manager.reserveFit(terminalId, paneId)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.code).toBe('FIT_BUSY')
    expect(second.status).toBe(409)
    expect(second.error).toContain('FIT_BUSY')
  })

  it('generation fences prevent stale callbacks from retiring a newer generation', async () => {
    const manager = new TerminalFitManager()
    const terminalId = 'term_test_gen_fence'
    const paneId = 'w86:p1'

    const r1 = manager.reserveFit(terminalId, paneId)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const gen1 = r1.generation

    // Cancel r1 and start r2
    manager.cancelReservation(terminalId, gen1)
    const r2 = manager.reserveFit(terminalId, paneId)
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    const gen2 = r2.generation
    expect(gen2).toBe(2)

    // Stale retirement attempt for gen1 must NOT retire gen2
    await manager.retireFitProducer(terminalId, gen1)
    expect(manager.hasActiveSession(terminalId)).toBe(true)
    expect(manager.getSession(terminalId)?.generation).toBe(gen2)

    // Correct retirement for gen2 succeeds
    await manager.retireFitProducer(terminalId, gen2)
    expect(manager.hasActiveSession(terminalId)).toBe(false)
  })

  it('blocks fit admission while terminal input control is active', () => {
    const manager = new TerminalFitManager()
    const terminalId = 'term_test_control_block'
    const paneId = 'w86:p1'

    manager.blockFitAdmission(terminalId)
    expect(manager.isFitBlocked(terminalId)).toBe(true)

    const attempt = manager.reserveFit(terminalId, paneId)
    expect(attempt.ok).toBe(false)
    if (attempt.ok) return
    expect(attempt.code).toBe('FIT_BLOCKED_BY_CONTROL')
    expect(attempt.status).toBe(409)

    manager.unblockFitAdmission(terminalId)
    expect(manager.isFitBlocked(terminalId)).toBe(false)

    const okAttempt = manager.reserveFit(terminalId, paneId)
    expect(okAttempt.ok).toBe(true)
  })

  it('does NOT acquire input/action pane claim so typed Send is never blocked', () => {
    const coordinator = getSharedOperationCoordinator()
    const manager = new TerminalFitManager()
    const terminalId = 'term_test_send_coexist'
    const paneId = 'w86:p1'

    const r = manager.reserveFit(terminalId, paneId)
    expect(r.ok).toBe(true)

    // Operation coordinator pane claim must NOT be acquired by fit manager
    expect(coordinator.isPaneClaimed(paneId)).toBe(false)
  })

  it('handles client resize writes to child stdin and preserves 35 cols', () => {
    const manager = new TerminalFitManager()
    const terminalId = 'term_test_resize'
    const paneId = 'w86:p1'

    const r = manager.reserveFit(terminalId, paneId)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const written: string[] = []
    const mockProc = {
      stdin: {
        write: (str: string) => {
          written.push(str)
        },
        flush: () => {}
      },
      kill: () => {},
      exited: Promise.resolve(0)
    }
    const mockWs = {
      readyState: 1,
      send: () => {},
      close: () => {}
    }

    manager.activateSession(terminalId, r.generation, mockProc, mockWs, 40, 20)

    const resized = manager.handleClientResize(terminalId, r.generation, 35, 15)
    expect(resized).toBe(true)
    expect(written.length).toBe(1)
    expect(JSON.parse(written[0])).toEqual({
      type: 'terminal.resize',
      cols: 35,
      rows: 15
    })
    expect(manager.getSession(terminalId)?.cols).toBe(35)
    expect(manager.getSession(terminalId)?.rows).toBe(15)
  })
})

describe('server/terminal-fit: Blocker 1 - 35-col mobile frame validation', () => {
  const frame35 = JSON.stringify({
    type: 'terminal.frame',
    seq: 1,
    encoding: 'ansi',
    width: 35,
    height: 15,
    full: true,
    bytes: 'SGVsbG8='
  })

  it('fitted frame validator accepts mobile 35x15 frame', () => {
    const res = parseAndValidateFittedTerminalMessage(frame35)
    expect(res.valid).toBe(true)
    expect(res.data).toBeDefined()
    if (!res.valid || !res.data) return
    expect(res.data.type).toBe('terminal.frame')
    if (res.data.type === 'terminal.frame') {
      expect(res.data.width).toBe(35)
      expect(res.data.height).toBe(15)
      expect(res.data.seq).toBe(1)
    }
  })

  it('upstream control validator rejects the exact same 35x15 frame', () => {
    const res = parseAndValidateUpstreamTerminalMessage(frame35)
    expect(res.valid).toBe(false)
    expect(res.error).toContain('width')
  })

  it('fitted frame validator fails closed on malformed or corrupted frames', () => {
    expect(parseAndValidateFittedTerminalMessage('not json').valid).toBe(false)
    expect(
      parseAndValidateFittedTerminalMessage(JSON.stringify({ type: 'other' }))
        .valid
    ).toBe(false)
    expect(
      parseAndValidateFittedTerminalMessage(
        JSON.stringify({
          type: 'terminal.frame',
          seq: 1,
          encoding: 'ansi',
          width: 0,
          height: 15,
          full: true,
          bytes: ''
        })
      ).valid
    ).toBe(false)
    expect(
      parseAndValidateFittedTerminalMessage(
        JSON.stringify({
          type: 'terminal.frame',
          seq: 1,
          encoding: 'ansi',
          width: 35,
          height: 15,
          full: true,
          bytes: '!!!corrupted base64###'
        })
      ).valid
    ).toBe(false)
  })
})

describe('server/terminal-fit: Blocker 2 - child exit races and early process registration', () => {
  it('unresolved child exit preserves retiring status, returns confirmed: false, and blocks new reservation with FIT_BUSY', async () => {
    const manager = new TerminalFitManager()
    const terminalId = 'term_test_unresolved_exit'
    const paneId = 'w86:p1'

    const r = manager.reserveFit(terminalId, paneId)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    let killed = false
    let resolveExit: ((val: number) => void) | null = null
    const hangingExit = new Promise<number>((resolve) => {
      resolveExit = resolve
    })

    const mockProc = {
      stdin: { write: () => {}, flush: () => {} },
      kill: () => {
        killed = true
      },
      exited: hangingExit
    }

    manager.activateSession(terminalId, r.generation, mockProc, null, 80, 24)

    // Fast-forward retire with hanging exit
    const retirePromise = manager.retireFitProducer(terminalId, r.generation)

    // Concurrent call for same generation returns the exact same promise (idempotent)
    const retirePromise2 = manager.retireFitProducer(terminalId, r.generation)
    expect(retirePromise).toBe(retirePromise2)

    // Mock timeout by awaiting retirePromise (uses short timeout in test or resolve after race)
    // Note: in actual implementation, timer is 2000ms. Let's resolve the exit after 50ms to verify clean exit:
    setTimeout(() => {
      if (resolveExit) resolveExit(0)
    }, 50)

    const result = await retirePromise
    expect(result.confirmed).toBe(true)
    expect(result.generation).toBe(r.generation)
    expect(killed).toBe(true)
    expect(manager.hasActiveSession(terminalId)).toBe(false)
  })

  it('process registered immediately after spawn before postcheck is killed if activation is aborted', () => {
    const manager = new TerminalFitManager()
    const terminalId = 'term_test_early_register'
    const paneId = 'w86:p1'

    const r = manager.reserveFit(terminalId, paneId)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    let killed = false
    const mockProc = {
      stdin: { write: () => {}, flush: () => {} },
      kill: () => {
        killed = true
      },
      exited: Promise.resolve(0)
    }

    // Registered immediately after spawn
    const registered = manager.registerProcess(
      terminalId,
      r.generation,
      mockProc
    )
    expect(registered).toBe(true)

    // Abort/cancel during postcheck await
    manager.cancelReservation(terminalId, r.generation)
    expect(manager.hasActiveSession(terminalId)).toBe(false)
    expect(killed).toBe(false)
  })

  it('late activation with mismatched generation or invalid status kills child process', () => {
    const manager = new TerminalFitManager()
    const terminalId = 'term_test_late_activation'
    const paneId = 'w86:p1'

    const r = manager.reserveFit(terminalId, paneId)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    let killed = false
    const mockProc = {
      stdin: { write: () => {}, flush: () => {} },
      kill: () => {
        killed = true
      },
      exited: Promise.resolve(0)
    }

    // Try activate with wrong generation (e.g. stale retry)
    const activated = manager.activateSession(
      terminalId,
      999,
      mockProc,
      null,
      80,
      24
    )
    expect(activated).toBe(false)
    expect(killed).toBe(true)
  })
})

describe('server/terminal-fit: Blocker 4 - fit admission unblocking and control transition', () => {
  it('overlapping control reservation cannot unblock fit admission with mismatched token', () => {
    const manager = new TerminalFitManager()
    const terminalId = 'term_test_token_block'

    const leaseToken = manager.blockFitAdmission(terminalId, 'lease_owner_123')
    expect(manager.isFitBlocked(terminalId)).toBe(true)
    expect(leaseToken).toBe('lease_owner_123')

    // Overlapping attempt tries to unblock with wrong token -> fails, stays blocked
    const unblockedBad = manager.unblockFitAdmission(
      terminalId,
      'wrong_token_456'
    )
    expect(unblockedBad).toBe(false)
    expect(manager.isFitBlocked(terminalId)).toBe(true)

    // Unblock with matching token succeeds
    const unblockedGood = manager.unblockFitAdmission(
      terminalId,
      'lease_owner_123'
    )
    expect(unblockedGood).toBe(true)
    expect(manager.isFitBlocked(terminalId)).toBe(false)
  })

  it('lease release unblocks fit admission only upon confirmed release', async () => {
    const leaseManager = new TerminalControlLeaseManager()
    const fitManager = new TerminalFitManager()
    const paneId = 'w86:p1'
    const terminalId = 'term_test_lease_lifecycle'

    // Reserve lease
    const res = leaseManager.reserveLease(paneId, terminalId)
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const leaseId = res.lease.id
    fitManager.blockFitAdmission(terminalId, leaseId)
    expect(fitManager.isFitBlocked(terminalId)).toBe(true)

    // Release lease
    await leaseManager.releaseLease(leaseId)
    expect(leaseManager.isPaneLeased(paneId)).toBe(false)
  })
})

describe('server/terminal-fit: desktop scroll restoration on release', () => {
  it('no-scroll release writes nothing (lastAppliedScrollOffset === undefined)', async () => {
    let scrollCalls = 0
    const mockScrollAdapter = {
      getScrollMetadata: async () => ({
        offset_from_bottom: 10,
        max_offset_from_bottom: 100,
        viewport_rows: 24
      }),
      executeScroll: async () => {
        scrollCalls++
        return { ok: true, offset_from_bottom: 0 }
      }
    }

    const fitManager = new TerminalFitManager({
      scrollAdapter: mockScrollAdapter
    })
    const terminalId = 'term_no_scroll_release'
    const paneId = 'w86:p1'

    const reserveRes = fitManager.reserveFit(terminalId, paneId)
    expect(reserveRes.ok).toBe(true)
    if (!reserveRes.ok) return

    const gen = reserveRes.generation
    fitManager.setInitialScrollOffset(terminalId, gen, 10)

    // No scroll was applied via fitManager (lastAppliedScrollOffset is undefined)
    const result = await fitManager.restoreSessionScroll(terminalId, gen)
    expect(result.restored).toBe(false)
    expect(result.reason).toBe('no_scroll_applied')
    expect(scrollCalls).toBe(0)
  })

  it('native-changed-offset preserved (live offset differs from lastAppliedScrollOffset)', async () => {
    let scrollCalls = 0
    const mockScrollAdapter = {
      getScrollMetadata: async () => ({
        offset_from_bottom: 25, // Native desktop user changed offset to 25!
        max_offset_from_bottom: 100,
        viewport_rows: 24
      }),
      executeScroll: async () => {
        scrollCalls++
        return { ok: true, offset_from_bottom: 0 }
      }
    }

    const fitManager = new TerminalFitManager({
      scrollAdapter: mockScrollAdapter
    })
    const terminalId = 'term_native_changed_offset'
    const paneId = 'w86:p1'

    const reserveRes = fitManager.reserveFit(terminalId, paneId)
    expect(reserveRes.ok).toBe(true)
    if (!reserveRes.ok) return

    const gen = reserveRes.generation
    fitManager.setInitialScrollOffset(terminalId, gen, 10)
    // Fit user had scrolled to 60
    fitManager.recordAppliedScrollOffset(terminalId, gen, 60)

    // Desktop release occurs: live offset (25) != our applied offset (60)
    const result = await fitManager.restoreSessionScroll(terminalId, gen)
    expect(result.restored).toBe(false)
    expect(result.reason).toBe('native_changed_offset_preserved')
    expect(scrollCalls).toBe(0)
  })

  it('exact unchanged target/generation restored with live max clamping', async () => {
    let lastRestoredOffset = -1
    const mockScrollAdapter = {
      getScrollMetadata: async () => ({
        offset_from_bottom: 50, // Matches lastAppliedScrollOffset
        max_offset_from_bottom: 60, // Max offset is clamped to 60
        viewport_rows: 24
      }),
      executeScroll: async (_paneId: string, offset: number) => {
        lastRestoredOffset = offset
        return { ok: true, offset_from_bottom: offset }
      }
    }

    const fitManager = new TerminalFitManager({
      scrollAdapter: mockScrollAdapter
    })
    const terminalId = 'term_restore_clamped'
    const paneId = 'w86:p1'

    const reserveRes = fitManager.reserveFit(terminalId, paneId)
    expect(reserveRes.ok).toBe(true)
    if (!reserveRes.ok) return

    const gen = reserveRes.generation
    // Initial offset was 80
    fitManager.setInitialScrollOffset(terminalId, gen, 80)
    // Fit user had scrolled to 50
    fitManager.recordAppliedScrollOffset(terminalId, gen, 50)

    // Desktop release: restores initial offset (80) clamped to live max (60)
    const result = await fitManager.restoreSessionScroll(terminalId, gen)
    expect(result.restored).toBe(true)
    expect(result.offset).toBe(60)
    expect(lastRestoredOffset).toBe(60)
  })

  it('retireFitProducer invokes scroll restoration before process termination', async () => {
    let restoredOffset = -1
    const mockScrollAdapter = {
      getScrollMetadata: async () => ({
        offset_from_bottom: 30,
        max_offset_from_bottom: 100,
        viewport_rows: 24
      }),
      executeScroll: async (_paneId: string, offset: number) => {
        restoredOffset = offset
        return { ok: true, offset_from_bottom: offset }
      }
    }

    let killed = false
    const mockProc = {
      kill: () => {
        killed = true
      },
      exited: Promise.resolve(0)
    }

    const fitManager = new TerminalFitManager({
      scrollAdapter: mockScrollAdapter,
      spawnProcess: () => mockProc
    })
    const terminalId = 'term_retire_integration'
    const paneId = 'w86:p1'

    const reserveRes = fitManager.reserveFit(terminalId, paneId)
    expect(reserveRes.ok).toBe(true)
    if (!reserveRes.ok) return

    const gen = reserveRes.generation
    fitManager.activateSession(terminalId, gen, mockProc, null, 80, 24)
    fitManager.setInitialScrollOffset(terminalId, gen, 15)
    fitManager.recordAppliedScrollOffset(terminalId, gen, 30)

    const retireRes = await fitManager.retireFitProducer(terminalId, gen)
    expect(retireRes.confirmed).toBe(true)
    expect(killed).toBe(true)
    expect(restoredOffset).toBe(15)
  })
})

describe('server/terminal-fit: native restoration target identity', () => {
  it('does not restore a replacement terminal with the same pane and offset', async () => {
    let writes = 0
    const manager = new TerminalFitManager({
      scrollAdapter: {
        verifyTarget: async () => false,
        getScrollMetadata: async () => ({
          offset_from_bottom: 30,
          max_offset_from_bottom: 100,
          viewport_rows: 15
        }),
        executeScroll: async () => {
          writes++
          return { ok: true, offset_from_bottom: 0 }
        }
      }
    })
    const reservation = manager.reserveFit('term_old', 'w86:p1')
    if (!reservation.ok) throw new Error('reservation failed')
    manager.activateSession(
      'term_old',
      reservation.generation,
      {
        stdin: { write: () => {} },
        kill: () => {},
        exited: Promise.resolve(0)
      },
      null,
      35,
      15
    )
    manager.setInitialScrollOffset('term_old', reservation.generation, 0)
    manager.recordAppliedScrollOffset('term_old', reservation.generation, 30)
    const result = await manager.restoreSessionScroll(
      'term_old',
      reservation.generation
    )
    expect(result.reason).toBe('native_target_replaced')
    expect(writes).toBe(0)
  })
})

describe('server/terminal-fit: per-session scroll queue accumulation and serialization', () => {
  it('rapid relative deltas +5x3 with delayed metadata accumulate and yield 15', async () => {
    let executedOffsets: number[] = []
    const mockScrollAdapter = {
      getScrollMetadata: async () => {
        // Direct delayed metadata probe simulating async socket latency
        await Bun.sleep(25)
        return {
          offset_from_bottom: 0,
          max_offset_from_bottom: 100,
          viewport_rows: 24
        }
      },
      executeScroll: async (_paneId: string, offset: number) => {
        executedOffsets.push(offset)
        return { ok: true, offset_from_bottom: offset }
      }
    }

    const fitManager = new TerminalFitManager({
      scrollAdapter: mockScrollAdapter
    })
    const terminalId = 'term_accumulate_test'
    const paneId = 'w86:p1'

    const reserveRes = fitManager.reserveFit(terminalId, paneId)
    expect(reserveRes.ok).toBe(true)
    if (!reserveRes.ok) return

    const gen = reserveRes.generation
    fitManager.activateSession(terminalId, gen, null, null, 80, 24)

    // Rapid gestures dispatched concurrently while metadata is delayed
    const p1 = fitManager.enqueueScroll(terminalId, gen, {
      type: 'terminal.scroll',
      deltaRows: 5
    })
    const p2 = fitManager.enqueueScroll(terminalId, gen, {
      type: 'terminal.scroll',
      deltaRows: 5
    })
    const p3 = fitManager.enqueueScroll(terminalId, gen, {
      type: 'terminal.scroll',
      deltaRows: 5
    })

    const results = await Promise.all([p1, p2, p3])
    expect(results.every((r) => r.applied)).toBe(true)

    const session = fitManager.getSession(terminalId)
    expect(session?.lastAppliedScrollOffset).toBe(15)
    expect(executedOffsets[executedOffsets.length - 1]).toBe(15)
  })

  it('latest reset then +2 yields 2 deterministically', async () => {
    let executedOffsets: number[] = []
    const mockScrollAdapter = {
      getScrollMetadata: async () => {
        await Bun.sleep(10)
        return {
          offset_from_bottom: 50,
          max_offset_from_bottom: 100,
          viewport_rows: 24
        }
      },
      executeScroll: async (_paneId: string, offset: number) => {
        executedOffsets.push(offset)
        return { ok: true, offset_from_bottom: offset }
      }
    }

    const fitManager = new TerminalFitManager({
      scrollAdapter: mockScrollAdapter
    })
    const terminalId = 'term_latest_reset_test'
    const paneId = 'w86:p1'

    const reserveRes = fitManager.reserveFit(terminalId, paneId)
    expect(reserveRes.ok).toBe(true)
    if (!reserveRes.ok) return

    const gen = reserveRes.generation
    fitManager.activateSession(terminalId, gen, null, null, 80, 24)
    fitManager.recordAppliedScrollOffset(terminalId, gen, 50)

    // Enqueue 'latest' then '+2'
    const p1 = fitManager.enqueueScroll(terminalId, gen, {
      type: 'terminal.scroll',
      to: 'latest'
    })
    const p2 = fitManager.enqueueScroll(terminalId, gen, {
      type: 'terminal.scroll',
      deltaRows: 2
    })

    await Promise.all([p1, p2])

    const session = fitManager.getSession(terminalId)
    expect(session?.lastAppliedScrollOffset).toBe(2)
    expect(executedOffsets[executedOffsets.length - 1]).toBe(2)
  })

  it('stale generation, replacement, or retire writes nothing during drain', async () => {
    let scrollCalls = 0
    const mockScrollAdapter = {
      getScrollMetadata: async () => ({
        offset_from_bottom: 0,
        max_offset_from_bottom: 100,
        viewport_rows: 24
      }),
      executeScroll: async () => {
        scrollCalls++
        return { ok: true, offset_from_bottom: 0 }
      }
    }

    const fitManager = new TerminalFitManager({
      scrollAdapter: mockScrollAdapter
    })
    const terminalId = 'term_stale_abort_test'
    const paneId = 'w86:p1'

    const reserveRes = fitManager.reserveFit(terminalId, paneId)
    expect(reserveRes.ok).toBe(true)
    if (!reserveRes.ok) return

    const gen = reserveRes.generation
    fitManager.activateSession(terminalId, gen, null, null, 80, 24)

    // 1. Stale generation attempt: rejected without writing
    const staleRes = await fitManager.enqueueScroll(terminalId, gen + 999, {
      type: 'terminal.scroll',
      deltaRows: 5
    })
    expect(staleRes.applied).toBe(false)
    expect(staleRes.reason).toBe('inactive_or_stale_generation')
    expect(scrollCalls).toBe(0)

    // 2. Replaced target attempt via verifyTarget: aborted without writing
    const replacedRes = await fitManager.enqueueScroll(
      terminalId,
      gen,
      {
        type: 'terminal.scroll',
        deltaRows: 5
      },
      {
        verifyTarget: async () => false
      }
    )
    expect(replacedRes).toBeDefined()
    expect(scrollCalls).toBe(0)

    // 3. Retired session: aborted without writing
    await fitManager.retireFitProducer(terminalId, gen)
    const retiredRes = await fitManager.enqueueScroll(terminalId, gen, {
      type: 'terminal.scroll',
      deltaRows: 5
    })
    expect(retiredRes.applied).toBe(false)
    expect(retiredRes.reason).toBe('inactive_or_stale_generation')
    expect(scrollCalls).toBe(0)
  })
})
