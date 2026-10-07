import { afterEach, describe, expect, it } from 'bun:test'
import { createServer } from '../index.ts'
import { getSharedTerminalFitManager } from '../terminal-fit.ts'

// This test runs Bun's native client, whose headers extension is absent from DOM types.
const BUN_WEB_SOCKET = WebSocket as unknown as {
  new (url: string, options: { headers: Record<string, string> }): WebSocket
}

describe('browser-visible fit admission without allocating another producer', () => {
  const manager = getSharedTerminalFitManager()
  const terminalId = 'term_admission_fixture_only'
  const pane = 'w88:p1'

  afterEach(() => {
    manager.unblockFitAdmission(terminalId, 'lease_admission_fixture_only')
    const session = manager.getSession(terminalId)
    if (session) {
      // Restore only this unspawned fixture's state before public cancellation.
      session.status = 'reserving'
      manager.cancelReservation(terminalId, session.generation)
    }
  })

  it.each(['FIT_BUSY', 'FIT_BLOCKED_BY_CONTROL', 'FIT_RELEASING'])(
    'preserves HTTP rejection but reports %s through an accepted WS close',
    async (code) => {
      const reservation = manager.reserveFit(terminalId, pane)
      expect(reservation.ok).toBe(true)
      const original = manager.getSession(terminalId)
      if (code === 'FIT_RELEASING' && original) original.status = 'retiring'
      if (code === 'FIT_BLOCKED_BY_CONTROL')
        manager.blockFitAdmission(terminalId, 'lease_admission_fixture_only')
      const server = createServer(0, '127.0.0.1', { startPushBridge: false })
      const base = `http://127.0.0.1:${server.port}`
      const suffix = `/api/terminal?pane=${pane}&terminalId=${terminalId}&cols=80&rows=24`
      try {
        const response = await fetch(base + suffix, {
          headers: { origin: base }
        })
        expect(response.status).toBe(409)
        expect((await response.json()).code).toBe(
          code === 'FIT_RELEASING' ? 'FIT_BUSY' : code
        )
        const close = await new Promise<{ code: number; reason: string }>(
          (resolve, reject) => {
            const socket = new BUN_WEB_SOCKET(
              base.replace('http:', 'ws:') + suffix,
              {
                headers: { origin: base }
              }
            )
            const timer = setTimeout(() => {
              socket.close()
              reject(new Error('denial close missing'))
            }, 2000)
            socket.onmessage = () =>
              reject(new Error('denial socket emitted a terminal frame'))
            socket.onerror = () =>
              reject(new Error('busy handshake was not accepted'))
            socket.onclose = (event) => {
              clearTimeout(timer)
              resolve({ code: event.code, reason: event.reason })
            }
          }
        )
        expect(close).toEqual({ code: 4409, reason: code })
        expect(manager.getSession(terminalId)).toBe(original)
        expect(original?.proc).toBeUndefined()
      } finally {
        server.stop(true)
      }
    }
  )
})
