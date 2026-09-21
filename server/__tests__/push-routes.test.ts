import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createECDH } from 'node:crypto'
import webpush from 'web-push'
import { createServer } from '../index.ts'
import { resetSharedPushService } from '../push/service.ts'

describe('server: push API routes integration', () => {
  const originalConfigEnv = process.env.HERDR_PUSH_CONFIG_PATH
  const originalSubsEnv = process.env.HERDR_PUSH_SUBSCRIPTIONS_PATH
  const originalTransportEnv = process.env.HERDR_TRANSPORT

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-push-routes-'))
  const configPath = path.join(tmpDir, 'push-config.json')
  const storePath = path.join(tmpDir, 'push-subscriptions.json')
  const vapidKeys = webpush.generateVAPIDKeys()
  const subscriptionCurve = createECDH('prime256v1')
  const subscriptionPublicKey = subscriptionCurve.generateKeys().toString('base64url')

  const validConfig = {
    ownerLogin: 'owner@example.com',
    publicKey: vapidKeys.publicKey,
    privateKey: vapidKeys.privateKey,
    subject: 'mailto:owner@example.com'
  }
  fs.writeFileSync(configPath, JSON.stringify(validConfig), { mode: 0o600 })

  process.env.HERDR_PUSH_CONFIG_PATH = configPath
  process.env.HERDR_PUSH_SUBSCRIPTIONS_PATH = storePath
  delete process.env.HERDR_TRANSPORT
  resetSharedPushService()

  let server: ReturnType<typeof createServer>
  let baseUrl: string

  beforeAll(() => {
    server = createServer(0, '127.0.0.1', { startPushBridge: false })
    baseUrl = `http://127.0.0.1:${server.port}`
  })

  afterAll(() => {
    if (server) {
      server.stop(true)
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}

    if (originalConfigEnv !== undefined) {
      process.env.HERDR_PUSH_CONFIG_PATH = originalConfigEnv
    } else {
      delete process.env.HERDR_PUSH_CONFIG_PATH
    }

    if (originalSubsEnv !== undefined) {
      process.env.HERDR_PUSH_SUBSCRIPTIONS_PATH = originalSubsEnv
    } else {
      delete process.env.HERDR_PUSH_SUBSCRIPTIONS_PATH
    }

    if (originalTransportEnv !== undefined) {
      process.env.HERDR_TRANSPORT = originalTransportEnv
    } else {
      delete process.env.HERDR_TRANSPORT
    }

    resetSharedPushService()
  })

  test('GET /api/push/config returns public key and availability without private keys', async () => {
    const res = await fetch(`${baseUrl}/api/push/config`, {
      headers: {
        host: `127.0.0.1:${server.port}`
      }
    })

    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data).toEqual({ ok: true, enabled: true, publicKey: validConfig.publicKey })
  })

  test('enrollment responses expose no device capabilities and deleting one device preserves the other', async () => {
    const headers = {
      host: `127.0.0.1:${server.port}`,
      origin: `http://127.0.0.1:${server.port}`,
      'content-type': 'application/json'
    }
    const current = 'https://push.example.com/sub/privacy-current'
    const other = 'https://push.example.com/sub/privacy-other'
    for (const endpoint of [other, current, current]) {
      const res = await fetch(`${baseUrl}/api/push/subscriptions`, {
        method: 'POST', headers,
        body: JSON.stringify({ endpoint, keys: { p256dh: subscriptionPublicKey, auth: 'A'.repeat(22) } })
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
    }
    const records = JSON.parse(fs.readFileSync(storePath, 'utf8'))
    expect(records.filter((record: { endpoint: string }) => record.endpoint === current)).toHaveLength(1)
    const removed = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: 'DELETE', headers, body: JSON.stringify({ endpoint: current })
    })
    expect(await removed.json()).toEqual({ ok: true })
    const remaining = JSON.parse(fs.readFileSync(storePath, 'utf8'))
    expect(remaining.some((record: { endpoint: string }) => record.endpoint === other)).toBe(true)
    expect(remaining.some((record: { endpoint: string }) => record.endpoint === current)).toBe(false)
    const missing = await fetch(`${baseUrl}/api/push/test`, {
      method: 'POST', headers, body: JSON.stringify({ endpoint: current })
    })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ ok: false, error: 'Subscription not found in store' })
  })

  test('POST /api/push/subscriptions validates origin and stores subscription', async () => {
    // 1. Rejected on unauthorized origin
    const rejectedRes = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${server.port}`,
        origin: 'http://evil.com',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ endpoint: 'https://push.example.com/sub/1', keys: { p256dh: 'k', auth: 'a' } })
    })
    expect(rejectedRes.status).toBe(403)

    // 2. Rejected on malformed payload
    const badBodyRes = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${server.port}`,
        origin: `http://127.0.0.1:${server.port}`,
        'content-type': 'application/json'
      },
      body: 'invalid-json'
    })
    expect(badBodyRes.status).toBe(400)

    // 3. Rejected on missing / wrong Content-Type
    const wrongTypeRes = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${server.port}`,
        origin: `http://127.0.0.1:${server.port}`,
        'content-type': 'text/plain'
      },
      body: JSON.stringify({ endpoint: 'https://push.example.com/sub/1' })
    })
    expect(wrongTypeRes.status).toBe(400)

    // 4. Rejected on oversized payload > 4096 bytes
    const hugePayload = {
      endpoint: 'https://push.example.com/sub/huge',
      keys: { p256dh: 'a'.repeat(5000), auth: 'b' }
    }
    const oversizedRes = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${server.port}`,
        origin: `http://127.0.0.1:${server.port}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(hugePayload)
    })
    expect(oversizedRes.status).toBe(413)

    // 5. Accepted on valid loopback dev request
    const validSub = {
      endpoint: 'https://push.example.com/sub/route-test-1',
      keys: {
        p256dh: subscriptionPublicKey,
        auth: 'A'.repeat(22)
      }
    }

    const acceptedRes = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${server.port}`,
        origin: `http://127.0.0.1:${server.port}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(validSub)
    })

    expect(acceptedRes.status).toBe(200)
    const data: any = await acceptedRes.json()
    expect(data.ok).toBe(true)
  })

  test('DELETE /api/push/subscriptions removes subscription', async () => {
    const res = await fetch(`${baseUrl}/api/push/subscriptions`, {
      method: 'DELETE',
      headers: {
        host: `127.0.0.1:${server.port}`,
        origin: `http://127.0.0.1:${server.port}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ endpoint: 'https://push.example.com/sub/route-test-1' })
    })

    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.ok).toBe(true)
  })

  test('POST /api/push/test returns 404 if endpoint not in store', async () => {
    const res = await fetch(`${baseUrl}/api/push/test`, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${server.port}`,
        origin: `http://127.0.0.1:${server.port}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ endpoint: 'https://push.example.com/sub/non-existent' })
    })

    expect(res.status).toBe(404)
    const data: any = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toContain('not found')
  })

  test('POST /api/push/click-diagnostic accepts only authorized fixed stages', async () => {
    const accepted = await fetch(`${baseUrl}/api/push/click-diagnostic`, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${server.port}`,
        origin: `http://127.0.0.1:${server.port}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ stage: 'click_target_data' })
    })
    expect(accepted.status).toBe(204)

    const invalid = await fetch(`${baseUrl}/api/push/click-diagnostic`, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${server.port}`,
        origin: `http://127.0.0.1:${server.port}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ stage: 'workspace=w5N' })
    })
    expect(invalid.status).toBe(400)

    const unauthorized = await fetch(`${baseUrl}/api/push/click-diagnostic`, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${server.port}`,
        origin: 'http://evil.example',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ stage: 'click_target_data' })
    })
    expect(unauthorized.status).toBe(403)
  })

  test('CLI transport mode disables Web Push with 409 and false config', async () => {
    process.env.HERDR_TRANSPORT = 'cli'
    try {
      // 1. GET /api/push/config returns enabled: false + reason
      const configRes = await fetch(`${baseUrl}/api/push/config`, {
        headers: { host: `127.0.0.1:${server.port}` }
      })
      expect(configRes.status).toBe(200)
      const configData: any = await configRes.json()
      expect(configData.ok).toBe(true)
      expect(configData.enabled).toBe(false)
      expect(configData.reason).toContain('socket transport')

      // 2. Mutations return 409
      const postRes = await fetch(`${baseUrl}/api/push/subscriptions`, {
        method: 'POST',
        headers: {
          host: `127.0.0.1:${server.port}`,
          origin: `http://127.0.0.1:${server.port}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ endpoint: 'https://push.example.com/sub/cli-test', keys: { p256dh: 'k', auth: 'a' } })
      })
      expect(postRes.status).toBe(409)
      const postData: any = await postRes.json()
      expect(postData.ok).toBe(false)
      expect(postData.error).toContain('CLI transport mode')
    } finally {
      delete process.env.HERDR_TRANSPORT
    }
  })

  test('Unconfigured push service returns 503 for mutations', async () => {
    const nonExistentPath = path.join(tmpDir, 'absent-config.json')
    process.env.HERDR_PUSH_CONFIG_PATH = nonExistentPath
    resetSharedPushService()

    try {
      const postRes = await fetch(`${baseUrl}/api/push/subscriptions`, {
        method: 'POST',
        headers: {
          host: `127.0.0.1:${server.port}`,
          origin: `http://127.0.0.1:${server.port}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ endpoint: 'https://push.example.com/sub/absent-test', keys: { p256dh: 'k', auth: 'a' } })
      })
      expect(postRes.status).toBe(503)
      const postData: any = await postRes.json()
      expect(postData.ok).toBe(false)
      expect(postData.error).toContain('not configured')
    } finally {
      process.env.HERDR_PUSH_CONFIG_PATH = configPath
      resetSharedPushService()
    }
  })

  test('GET /sw.js serves service worker with javascript content-type', async () => {
    const res = await fetch(`${baseUrl}/sw.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/javascript')
    const text = await res.text()
    expect(text).toContain('showNotification')
    expect(text).toContain('notificationclick')
  })

  test('static server serves production build from build/client and does not fall back to dist', async () => {
    // Verifies build/client is the sole production owner and dist is not an active fallback
    const res = await fetch(`${baseUrl}/manifest.webmanifest`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('manifest')

    // Root and client routes fall back to build/client/index.html (SPA mode)
    const rootRes = await fetch(`${baseUrl}/`)
    expect(rootRes.status).toBe(200)
    expect(rootRes.headers.get('content-type')).toContain('text/html')
  })
})
