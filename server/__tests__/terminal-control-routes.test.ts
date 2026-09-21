import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import webpush from 'web-push'
import { createServer } from '../index.ts'
import { OperationCoordinator } from '../operation-coordinator.ts'
import { resetSharedPushService } from '../push/service.ts'
import {
  getSharedTerminalControlLeaseManager,
  TerminalControlLeaseManager
} from '../terminal-control.ts'

describe('/api/terminal/control route and lease guarantees', () => {
  const leaseManager = getSharedTerminalControlLeaseManager()

  beforeEach(() => {
    leaseManager.resetForTesting()
  })

  afterEach(() => {
    leaseManager.resetForTesting()
  })

  it('rejects an unauthorized origin with 403 Forbidden', async () => {
    const server = createServer(0, '127.0.0.1', { startPushBridge: false })

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control?pane=ws1:p1`, {
        headers: {
          origin: 'https://malicious.origin.com'
        }
      })
      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toContain('origin not authorized')
    } finally {
      server.stop(true)
    }
  })

  it('rejects connection in explicit CLI transport mode with 409 Conflict', async () => {
    const originalTransport = process.env.HERDR_TRANSPORT
    process.env.HERDR_TRANSPORT = 'cli'
    const server = createServer(0, '127.0.0.1', { startPushBridge: false })

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control?pane=ws1:p1`, {
        headers: {
          origin: `http://127.0.0.1:${server.port}`
        }
      })
      expect(response.status).toBe(409)
      const data = await response.json()
      expect(data.error).toContain('CLI transport mode')
    } finally {
      server.stop(true)
      if (originalTransport === undefined) delete process.env.HERDR_TRANSPORT
      else process.env.HERDR_TRANSPORT = originalTransport
    }
  })

  it('rejects invalid or missing pane parameter with 400 Bad Request', async () => {
    const server = createServer(0, '127.0.0.1', { startPushBridge: false })

    try {
      const missingPane = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control`, {
        headers: {
          origin: `http://127.0.0.1:${server.port}`
        }
      })
      expect(missingPane.status).toBe(400)

      const invalidPane = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control?pane=invalid_format`, {
        headers: {
          origin: `http://127.0.0.1:${server.port}`
        }
      })
      expect(invalidPane.status).toBe(400)
    } finally {
      server.stop(true)
    }
  })

  it('rejects second lease attempt with 409 Conflict when a lease is already active', async () => {
    // Manually reserve a lease
    const reserved = leaseManager.reserveLease('ws1:p1')
    expect(reserved.ok).toBe(true)

    const server = createServer(0, '127.0.0.1', { startPushBridge: false })

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control?pane=ws1:p2`, {
        headers: {
          origin: `http://127.0.0.1:${server.port}`
        }
      })
      expect(response.status).toBe(409)
      const data = await response.json()
      expect(data.error).toContain('already active')
    } finally {
      server.stop(true)
    }
  })

  it('fails closed when Tailnet request arrives with absent owner config', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-control-auth-none-'))
    const originalConfigEnv = process.env.HERDR_PUSH_CONFIG_PATH
    process.env.HERDR_PUSH_CONFIG_PATH = path.join(tmpDir, 'nonexistent-push-config.json')
    resetSharedPushService()

    const server = createServer(0, '127.0.0.1', { startPushBridge: false })

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control?pane=ws1:p1`, {
        headers: {
          host: 'test-node.ts.net:8787',
          origin: 'https://test-node.ts.net:8787'
        }
      })
      expect(response.status).toBe(500)
      const data = await response.json()
      expect(data.error).toContain('Server misconfigured: owner login not set')
    } finally {
      server.stop(true)
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch {}
      if (originalConfigEnv !== undefined) {
        process.env.HERDR_PUSH_CONFIG_PATH = originalConfigEnv
      } else {
        delete process.env.HERDR_PUSH_CONFIG_PATH
      }
      resetSharedPushService()
    }
  })

  it('verifies Tailnet request authentication behavior with configured ownerLogin', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-control-auth-valid-'))
    const configPath = path.join(tmpDir, 'push-config.json')
    const vapidKeys = webpush.generateVAPIDKeys()
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        ownerLogin: 'owner@example.com',
        publicKey: vapidKeys.publicKey,
        privateKey: vapidKeys.privateKey,
        subject: 'mailto:owner@example.com'
      }),
      { mode: 0o600 }
    )

    const originalConfigEnv = process.env.HERDR_PUSH_CONFIG_PATH
    process.env.HERDR_PUSH_CONFIG_PATH = configPath
    resetSharedPushService()

    const server = createServer(0, '127.0.0.1', { startPushBridge: false })

    try {
      // 1. Missing tailscale-user-login header -> 403 Forbidden
      const missingLogin = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control?pane=ws1:p1`, {
        headers: {
          host: 'test-node.ts.net:8787',
          origin: 'https://test-node.ts.net:8787'
        }
      })
      expect(missingLogin.status).toBe(403)
      const missingData = await missingLogin.json()
      expect(missingData.error).toContain('Tailnet user not authorized')

      // 2. Mismatched tailscale-user-login header -> 403 Forbidden
      const mismatchedLogin = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control?pane=ws1:p1`, {
        headers: {
          host: 'test-node.ts.net:8787',
          origin: 'https://test-node.ts.net:8787',
          'tailscale-user-login': 'attacker@example.com'
        }
      })
      expect(mismatchedLogin.status).toBe(403)
      const mismatchedData = await mismatchedLogin.json()
      expect(mismatchedData.error).toContain('Tailnet user not authorized')

      // 3. Matched tailscale-user-login header -> passes auth (does not fail with 403 or 500 auth errors)
      const matchedLogin = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control?pane=ws1:p1`, {
        headers: {
          host: 'test-node.ts.net:8787',
          origin: 'https://test-node.ts.net:8787',
          'tailscale-user-login': 'owner@example.com'
        }
      })
      expect(matchedLogin.status).not.toBe(403)
      expect(matchedLogin.status).not.toBe(500)
    } finally {
      server.stop(true)
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch {}
      if (originalConfigEnv !== undefined) {
        process.env.HERDR_PUSH_CONFIG_PATH = originalConfigEnv
      } else {
        delete process.env.HERDR_PUSH_CONFIG_PATH
      }
      resetSharedPushService()
    }
  })

  describe('TerminalControlLeaseManager.getLeaseStatus', () => {
    it('reports pending -> active -> releasing/quarantined -> released and wrong pane', async () => {
      const manager = new TerminalControlLeaseManager()

      // 1. Initial / unleased
      expect(manager.getLeaseStatus('ws1:p1')).toEqual({ leased: false, status: null })

      // 2. Pending reservation
      const reserved = manager.reserveLease('ws1:p1')
      expect(reserved.ok).toBe(true)
      const leaseId = (reserved as any).lease.id
      expect(manager.getLeaseStatus('ws1:p1')).toEqual({ leased: true, status: 'pending' })
      // Wrong pane query returns leased: false
      expect(manager.getLeaseStatus('ws1:pOther')).toEqual({ leased: false, status: null })

      // 3. Activate lease with mock process
      let childExitResolve: (val: number) => void = () => {}
      const exitPromise = new Promise<number>((resolve) => {
        childExitResolve = resolve
      })
      const mockProc: any = {
        exited: exitPromise,
        stdin: { write: () => {}, flush: () => {} },
        kill: () => {}
      }
      const mockWs: any = { readyState: 1, send: () => {}, close: () => {} }

      const activated = manager.activateLease(leaseId, mockProc, mockWs)
      expect(activated).toBe(true)
      expect(manager.getLeaseStatus('ws1:p1')).toEqual({ leased: true, status: 'active' })

      // 4. Release initiated while child exit is unconfirmed (quarantined)
      const releasePromise = manager.releaseLease(leaseId, 'test_release')
      // While child has not exited, status remains releasing and leased: true
      expect(manager.getLeaseStatus('ws1:p1')).toEqual({ leased: true, status: 'releasing' })

      // 5. Child process exits -> finalized
      childExitResolve(0)
      await releasePromise

      expect(manager.getLeaseStatus('ws1:p1')).toEqual({ leased: false, status: null })
      expect(manager.getActiveLease()).toBeNull()
    })
  })

  describe('GET /api/terminal/control/status route', () => {
    it('succeeds for loopback GET when Origin header is omitted', async () => {
      const server = createServer(0, '127.0.0.1', { startPushBridge: false })

      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control/status?pane=ws1:p1`)
        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data).toEqual({
          ok: true,
          pane: 'ws1:p1',
          leased: false,
          status: null
        })
      } finally {
        server.stop(true)
      }
    })

    it('rejects cross-origin malicious Origin with 403 Forbidden', async () => {
      const server = createServer(0, '127.0.0.1', { startPushBridge: false })

      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control/status?pane=ws1:p1`, {
          headers: {
            origin: 'https://malicious.origin.com'
          }
        })
        expect(response.status).toBe(403)
        const data = await response.json()
        expect(data.error).toContain('origin not authorized')
      } finally {
        server.stop(true)
      }
    })

    it('enforces Tailnet owner login on status route (rejects missing/mismatched, allows matched)', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-tc-status-tailnet-'))
      const configPath = path.join(tmpDir, 'push-config.json')
      const vapidKeys = webpush.generateVAPIDKeys()
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          ownerLogin: 'owner@example.com',
          publicKey: vapidKeys.publicKey,
          privateKey: vapidKeys.privateKey,
          subject: 'mailto:test@example.com'
        }),
        { mode: 0o600 }
      )

      const originalConfigEnv = process.env.HERDR_PUSH_CONFIG_PATH
      process.env.HERDR_PUSH_CONFIG_PATH = configPath
      resetSharedPushService()

      const server = createServer(0, '127.0.0.1', { startPushBridge: false })

      try {
        // Missing login on Tailnet host -> 403 Forbidden
        const missingLogin = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control/status?pane=ws1:p1`, {
          headers: {
            host: 'test-node.ts.net:8787'
          }
        })
        expect(missingLogin.status).toBe(403)
        const missingData = await missingLogin.json()
        expect(missingData.error).toContain('Tailnet user not authorized')

        // Mismatched login on Tailnet host -> 403 Forbidden
        const mismatchedLogin = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control/status?pane=ws1:p1`, {
          headers: {
            host: 'test-node.ts.net:8787',
            'tailscale-user-login': 'attacker@example.com'
          }
        })
        expect(mismatchedLogin.status).toBe(403)
        const mismatchedData = await mismatchedLogin.json()
        expect(mismatchedData.error).toContain('Tailnet user not authorized')

        // Matched login on Tailnet host without Origin -> 200 OK
        const matchedLogin = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control/status?pane=ws1:p1`, {
          headers: {
            host: 'test-node.ts.net:8787',
            'tailscale-user-login': 'owner@example.com'
          }
        })
        expect(matchedLogin.status).toBe(200)
        const matchedData = await matchedLogin.json()
        expect(matchedData).toEqual({
          ok: true,
          pane: 'ws1:p1',
          leased: false,
          status: null
        })
      } finally {
        server.stop(true)
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true })
        } catch {}
        if (originalConfigEnv !== undefined) {
          process.env.HERDR_PUSH_CONFIG_PATH = originalConfigEnv
        } else {
          delete process.env.HERDR_PUSH_CONFIG_PATH
        }
        resetSharedPushService()
      }
    })

    it('rejects invalid query parameters (missing, duplicate, extra) with 400 Bad Request', async () => {
      const server = createServer(0, '127.0.0.1', { startPushBridge: false })

      try {
        // Missing pane
        const missing = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control/status`, {
          headers: { origin: `http://127.0.0.1:${server.port}` }
        })
        expect(missing.status).toBe(400)

        // Duplicate pane
        const duplicate = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control/status?pane=ws1:p1&pane=ws1:p2`, {
          headers: { origin: `http://127.0.0.1:${server.port}` }
        })
        expect(duplicate.status).toBe(400)

        // Extra unexpected query parameter
        const extra = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control/status?pane=ws1:p1&extra=1`, {
          headers: { origin: `http://127.0.0.1:${server.port}` }
        })
        expect(extra.status).toBe(400)
      } finally {
        server.stop(true)
      }
    })

    it('returns truthful bounded status for unleased and leased panes', async () => {
      const server = createServer(0, '127.0.0.1', { startPushBridge: false })

      try {
        // Unleased
        const unleasedRes = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control/status?pane=ws1:p1`, {
          headers: { origin: `http://127.0.0.1:${server.port}` }
        })
        expect(unleasedRes.status).toBe(200)
        const unleasedData = await unleasedRes.json()
        expect(unleasedData).toEqual({
          ok: true,
          pane: 'ws1:p1',
          leased: false,
          status: null
        })

        // Reserve lease on shared manager
        const reserved = leaseManager.reserveLease('ws1:p1')
        expect(reserved.ok).toBe(true)

        // Now leased
        const leasedRes = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control/status?pane=ws1:p1`, {
          headers: { origin: `http://127.0.0.1:${server.port}` }
        })
        expect(leasedRes.status).toBe(200)
        const leasedData = await leasedRes.json()
        expect(leasedData).toEqual({
          ok: true,
          pane: 'ws1:p1',
          leased: true,
          status: 'pending'
        })
      } finally {
        server.stop(true)
      }
    })

    it('returns unleased status consistently in explicit CLI mode', async () => {
      const originalTransport = process.env.HERDR_TRANSPORT
      process.env.HERDR_TRANSPORT = 'cli'
      const server = createServer(0, '127.0.0.1', { startPushBridge: false })

      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control/status?pane=ws1:p1`, {
          headers: { origin: `http://127.0.0.1:${server.port}` }
        })
        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data).toEqual({
          ok: true,
          pane: 'ws1:p1',
          leased: false,
          status: null
        })
      } finally {
        server.stop(true)
        if (originalTransport === undefined) delete process.env.HERDR_TRANSPORT
        else process.env.HERDR_TRANSPORT = originalTransport
      }
    })

    it('binds an injected leaseManager to the selected coordinator and uses it for status', async () => {
      const customCoordinator = new OperationCoordinator()
      const customManager = new TerminalControlLeaseManager()

      const server = createServer(0, '127.0.0.1', {
        startPushBridge: false,
        deps: {
          coordinator: customCoordinator,
          leaseManager: customManager
        }
      })

      try {
        const reserved = customManager.reserveLease('ws1:pCustom')
        expect(reserved.ok).toBe(true)

        const actionAdmission = customCoordinator.beginAction(
          'op-injected-shared-owner',
          'ws1:pCustom',
          'fp-injected-shared-owner'
        )
        expect(actionAdmission.kind).toBe('contention')

        const response = await fetch(`http://127.0.0.1:${server.port}/api/terminal/control/status?pane=ws1:pCustom`, {
          headers: { origin: `http://127.0.0.1:${server.port}` }
        })
        expect(response.status).toBe(200)
        const data = await response.json()
        expect(data.leased).toBe(true)
        expect(data.status).toBe('pending')

        // Shared lease manager was NOT touched
        expect(leaseManager.getLeaseStatus('ws1:pCustom').leased).toBe(false)
      } finally {
        server.stop(true)
        customManager.resetForTesting()
      }
    })

    it('fails closed when an injected manager already owns a lease before binding', () => {
      const customManager = new TerminalControlLeaseManager()
      expect(customManager.reserveLease('ws1:pExisting').ok).toBe(true)

      expect(() => {
        createServer(0, '127.0.0.1', {
          startPushBridge: false,
          deps: {
            coordinator: new OperationCoordinator(),
            leaseManager: customManager
          }
        })
      }).toThrow('Cannot bind terminal control arbiter while a lease is active or pending')

      customManager.resetForTesting()
    })
  })
})
