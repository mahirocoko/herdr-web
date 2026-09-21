import { describe, expect, test } from 'bun:test'
import { createECDH, randomBytes } from 'node:crypto'
import webpush from 'web-push'
import {
  createDonePayload,
  createNeedsInputPayload,
  createTestPayload,
  sendPushNotification
} from '../sender.ts'
import type { IPushConfig, IPushSubscription } from '../types.ts'

describe('server/push/sender: push dispatch and error classification', () => {
  const mockConfig: IPushConfig = {
    ownerLogin: 'test-owner',
    publicKey: 'test-public-key',
    privateKey: 'test-private-key',
    subject: 'mailto:owner@example.com'
  }

  const mockSub: IPushSubscription = {
    endpoint: 'https://push.example.com/send/12345',
    keys: {
      p256dh: 'mock-p256dh',
      auth: 'mock-auth'
    }
  }

  test('creates generic payloads without leaking internal details', () => {
    const inputPayload = createNeedsInputPayload()
    expect(inputPayload.type).toBe('needs_input')
    expect(inputPayload.title).toBe('Herdr needs input')
    expect(inputPayload.body).toBe('An agent is waiting for you.')
    expect(inputPayload.url).toBe('/')
    expect((inputPayload as any).tag).toBeUndefined()
    expect(JSON.stringify(inputPayload)).not.toContain('pane')
    expect(JSON.stringify(inputPayload)).not.toContain('tab')
    expect(JSON.stringify(inputPayload)).not.toContain('"tag"')

    const donePayload = createDonePayload()
    expect(donePayload.type).toBe('done')
    expect(donePayload.title).toBe('Herdr task finished')
    expect(donePayload.body).toBe('An agent finished a task.')
    expect(donePayload.url).toBe('/')
    expect((donePayload as any).tag).toBeUndefined()
    expect(JSON.stringify(donePayload)).not.toContain('pane')
    expect(JSON.stringify(donePayload)).not.toContain('tab')
    expect(JSON.stringify(donePayload)).not.toContain('"tag"')

    const testPayload = createTestPayload()
    expect(testPayload.type).toBe('test')
    expect(testPayload.title).toBe('Herdr Test Alert')
    expect(testPayload.body).toContain('Push notifications are active')
    expect(testPayload.url).toBe('/')
    expect((testPayload as any).tag).toBeUndefined()
    expect(JSON.stringify(testPayload)).not.toContain('pane')
    expect(JSON.stringify(testPayload)).not.toContain('tab')
    expect(JSON.stringify(testPayload)).not.toContain('"tag"')
  })

  test('successfully sends push using injected mock client', async () => {
    let capturedVapid: any = null
    let capturedSub: any = null
    let capturedPayload: any = null
    let capturedOptions: any = null

    const mockClient = {
      setVapidDetails: (subject: string, pub: string, priv: string) => {
        capturedVapid = { subject, pub, priv }
      },
      sendNotification: async (sub: any, payload: any, options: any) => {
        capturedSub = sub
        capturedPayload = payload
        capturedOptions = options
        return { statusCode: 201 }
      }
    }

    const payload = createTestPayload()
    const result = await sendPushNotification(mockSub, payload, mockConfig, {
      ttlSeconds: 120,
      timeoutMs: 5000,
      webPushClient: mockClient as any
    })

    expect(result.ok).toBe(true)
    expect(result.statusCode).toBe(201)
    expect(result.shouldRemove).toBeUndefined()
    expect(capturedVapid.subject).toBe(mockConfig.subject)
    expect(capturedSub.endpoint).toBe(mockSub.endpoint)
    expect(JSON.parse(capturedPayload).title).toBe('Herdr Test Alert')
    for (const secret of [mockSub.endpoint, mockSub.keys.auth, mockSub.keys.p256dh, mockConfig.privateKey]) {
      expect(capturedPayload).not.toContain(secret)
      expect(JSON.stringify(result)).not.toContain(secret)
    }
    expect(capturedOptions.TTL).toBe(120)
    expect(capturedOptions.urgency).toBe('high')
    expect(capturedOptions.timeout).toBe(5000)
  })

  test('constructs a real encrypted and VAPID-signed request without network I/O', () => {
    const vapidKeys = webpush.generateVAPIDKeys()
    const recipientCurve = createECDH('prime256v1')
    const recipientPublicKey = recipientCurve.generateKeys().toString('base64url')
    const auth = randomBytes(16).toString('base64url')

    const details = webpush.generateRequestDetails(
      {
        endpoint: 'https://push.example.com/send/offline-proof',
        keys: { p256dh: recipientPublicKey, auth }
      },
      JSON.stringify(createTestPayload()),
      {
        TTL: 60,
        urgency: 'high',
        vapidDetails: {
          subject: 'mailto:test@example.com',
          publicKey: vapidKeys.publicKey,
          privateKey: vapidKeys.privateKey
        }
      }
    )

    expect(details.method).toBe('POST')
    expect(details.endpoint).toBe('https://push.example.com/send/offline-proof')
    expect(details.headers.Authorization).toBeTruthy()
    expect(details.headers['Content-Encoding']).toBe('aes128gcm')
    expect(details.body).toBeTruthy()
    expect(details.body?.byteLength).toBeGreaterThan(0)
  })

  test('identifies 410 Gone / 404 Not Found as shouldRemove: true', async () => {
    const mockClient410 = {
      setVapidDetails: () => {},
      sendNotification: async () => {
        const err: any = new Error('Subscription no longer active')
        err.statusCode = 410
        throw err
      }
    }

    const res410 = await sendPushNotification(mockSub, createTestPayload(), mockConfig, {
      webPushClient: mockClient410 as any
    })

    expect(res410.ok).toBe(false)
    expect(res410.statusCode).toBe(410)
    expect(res410.shouldRemove).toBe(true)

    const mockClient404 = {
      setVapidDetails: () => {},
      sendNotification: async () => {
        const err: any = new Error('Endpoint not found')
        err.statusCode = 404
        throw err
      }
    }

    const res404 = await sendPushNotification(mockSub, createTestPayload(), mockConfig, {
      webPushClient: mockClient404 as any
    })

    expect(res404.ok).toBe(false)
    expect(res404.statusCode).toBe(404)
    expect(res404.shouldRemove).toBe(true)
  })

  test('identifies server error (e.g. 500) as shouldRemove: false and sanitizes secrets', async () => {
    const mockClient500 = {
      setVapidDetails: () => {},
      sendNotification: async () => {
        const err: any = new Error('Gateway timeout while sending to https://push.com?token=secret123')
        err.statusCode = 502
        throw err
      }
    }

    const res = await sendPushNotification(mockSub, createTestPayload(), mockConfig, {
      webPushClient: mockClient500 as any
    })

    expect(res.ok).toBe(false)
    expect(res.statusCode).toBe(502)
    expect(res.shouldRemove).toBe(false)
    expect(res.error).not.toContain('token=secret123')
  })

  test('creates Space-aware payloads when workspace is provided', () => {
    const inputPayload = createNeedsInputPayload('ws-main', 'Main Project')
    expect(inputPayload.type).toBe('needs_input')
    expect(inputPayload.title).toBe('Herdr needs input')
    expect(inputPayload.body).toBe('Space: Main Project')
    expect(inputPayload.url).toBe('/spaces/ws-main')
    expect(inputPayload.workspaceId).toBe('ws-main')
    expect(inputPayload.workspaceLabel).toBe('Main Project')
    expect((inputPayload as any).tag).toBeUndefined()
    expect(JSON.stringify(inputPayload)).not.toContain('pane')
    expect(JSON.stringify(inputPayload)).not.toContain('tab')

    const donePayload = createDonePayload('ws-main', 'Main Project')
    expect(donePayload.type).toBe('done')
    expect(donePayload.title).toBe('Herdr task finished')
    expect(donePayload.body).toBe('Space: Main Project')
    expect(donePayload.url).toBe('/spaces/ws-main')
    expect((donePayload as any).tag).toBeUndefined()
    expect(JSON.stringify(donePayload)).not.toContain('pane')
    expect(JSON.stringify(donePayload)).not.toContain('tab')
  })

  test('falls back to generic copy and root URL when workspace is missing or invalid', () => {
    const inputMissing = createNeedsInputPayload(undefined, undefined)
    expect(inputMissing.body).toBe('An agent is waiting for you.')
    expect(inputMissing.url).toBe('/')
    expect(inputMissing.workspaceId).toBeUndefined()

    const inputInvalid = createNeedsInputPayload('invalid/id with spaces', 'Some Label')
    expect(inputInvalid.body).toBe('An agent is waiting for you.')
    expect(inputInvalid.url).toBe('/')
  })

  test('handles send timeout bounded by timeoutMs option', async () => {
    const hangingClient = {
      setVapidDetails: () => {},
      sendNotification: () => new Promise<any>((resolve) => {
        setTimeout(() => resolve({ statusCode: 201 }), 200)
      })
    }

    const res = await sendPushNotification(mockSub, createTestPayload(), mockConfig, {
      timeoutMs: 50,
      webPushClient: hangingClient as any
    })

    expect(res.ok).toBe(false)
    expect(res.error).toBe('Push provider request timed out')
    expect(res.shouldRemove).toBe(false)
  })

  test('payload privacy: serialized payload contains strictly Space-scoped data and no tab fields', () => {
    // Both needs_input and done payloads
    const inputPayload = createNeedsInputPayload('ws-space-123', 'Project Workspace')
    const serializedInput = JSON.stringify(inputPayload)
    const parsedInput = JSON.parse(serializedInput)

    expect(parsedInput.workspaceId).toBe('ws-space-123')
    expect(parsedInput.workspaceLabel).toBe('Project Workspace')
    expect(parsedInput.tabId).toBeUndefined()
    expect(parsedInput.tab_id).toBeUndefined()
    expect(parsedInput.tabLabel).toBeUndefined()
    expect(parsedInput.tab_label).toBeUndefined()
    expect(parsedInput.tabNumber).toBeUndefined()
    expect(parsedInput.sourceTabId).toBeUndefined()
    expect(serializedInput).not.toContain('tabId')
    expect(serializedInput).not.toContain('tab_id')
    expect(serializedInput).not.toContain('sourceTabId')

    const donePayload = createDonePayload('ws-space-123', 'Project Workspace')
    const serializedDone = JSON.stringify(donePayload)
    const parsedDone = JSON.parse(serializedDone)

    expect(parsedDone.workspaceId).toBe('ws-space-123')
    expect(parsedDone.workspaceLabel).toBe('Project Workspace')
    expect(parsedDone.tabId).toBeUndefined()
    expect(parsedDone.tab_id).toBeUndefined()
    expect(parsedDone.tabLabel).toBeUndefined()
    expect(parsedDone.tab_label).toBeUndefined()
    expect(parsedDone.tabNumber).toBeUndefined()
    expect(parsedDone.sourceTabId).toBeUndefined()
    expect(serializedDone).not.toContain('tabId')
    expect(serializedDone).not.toContain('tab_id')
    expect(serializedDone).not.toContain('sourceTabId')
  })
})
