import { describe, expect, test } from 'bun:test'
import { createECDH } from 'node:crypto'
import {
  isApprovedLoopback,
  validatePushAuth,
  validatePushEndpointPayload,
  validatePushSubscriptionPayload
} from '../security.ts'

describe('server/push/security: payload and auth validation', () => {
  const curve = createECDH('prime256v1')
  const p256dh = curve.generateKeys().toString('base64url')
  const authKey = 'A'.repeat(22)

  test('validates push subscription payload correctly', () => {
    const valid = {
      endpoint: 'https://push.example.com/sub/abc',
      keys: {
        p256dh,
        auth: authKey
      },
      expirationTime: 1720000000
    }

    const res = validatePushSubscriptionPayload(valid)
    expect(res.valid).toBe(true)
    expect(res.data?.endpoint).toBe(valid.endpoint)
    expect(res.data?.keys.p256dh).toBe(valid.keys.p256dh)
    expect(res.data?.expirationTime).toBe(1720000000)
  })

  test('rejects non-HTTPS push endpoint', () => {
    const httpPayload = {
      endpoint: 'http://insecure-push.example.com/sub/abc',
      keys: {
        p256dh: 'key',
        auth: 'auth'
      }
    }
    const res = validatePushSubscriptionPayload(httpPayload)
    expect(res.valid).toBe(false)
    expect(res.error).toContain('HTTPS')
  })

  test('rejects missing or empty keys in subscription payload', () => {
    const missingKeys = {
      endpoint: 'https://push.example.com/sub/abc'
    }
    expect(validatePushSubscriptionPayload(missingKeys).valid).toBe(false)

    const emptyKeys = {
      endpoint: 'https://push.example.com/sub/abc',
      keys: { p256dh: '', auth: '' }
    }
    expect(validatePushSubscriptionPayload(emptyKeys).valid).toBe(false)
  })

  test('rejects malformed or wrong-length subscription keys', () => {
    expect(validatePushSubscriptionPayload({
      endpoint: 'https://push.example.com/sub/abc',
      keys: { p256dh: 'not+base64url', auth: authKey }
    }).valid).toBe(false)

    expect(validatePushSubscriptionPayload({
      endpoint: 'https://push.example.com/sub/abc',
      keys: { p256dh, auth: 'too-short' }
    }).valid).toBe(false)

    expect(validatePushSubscriptionPayload({
      endpoint: 'https://push.example.com/sub/abc',
      keys: { p256dh: 'A'.repeat(87), auth: authKey }
    }).valid).toBe(false)
  })

  test('validates push endpoint payload correctly', () => {
    const valid = { endpoint: 'https://push.example.com/sub/abc' }
    const res = validatePushEndpointPayload(valid)
    expect(res.valid).toBe(true)
    expect(res.data?.endpoint).toBe(valid.endpoint)

    expect(validatePushEndpointPayload({}).valid).toBe(false)
    expect(validatePushEndpointPayload({ endpoint: 'http://insecure' }).valid).toBe(false)
  })

  test('detects approved loopback combinations', () => {
    expect(isApprovedLoopback('127.0.0.1:8787', 'http://127.0.0.1:8787')).toBe(true)
    expect(isApprovedLoopback('localhost:5173', 'http://localhost:5173')).toBe(true)
    expect(isApprovedLoopback('127.0.0.1:8787', 'http://localhost:5173')).toBe(true)
    expect(isApprovedLoopback('macbook.tail756ed7.ts.net', 'https://macbook.tail756ed7.ts.net')).toBe(false)
  })

  test('allows loopback dev requests when origin and host are approved loopback', () => {
    const req = new Request('http://127.0.0.1:8787/api/push/subscriptions', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:8787',
        origin: 'http://127.0.0.1:8787'
      }
    })

    const auth = validatePushAuth(req, '127.0.0.1:8787', 'http://127.0.0.1:8787', 'owner@example.com')
    expect(auth.allowed).toBe(true)
    expect(auth.status).toBe(200)
  })

  test('requires matching Tailscale-User-Login on Tailnet host', () => {
    const host = 'node.tail756ed7.ts.net'
    const origin = 'https://node.tail756ed7.ts.net'

    // Matching owner
    const validReq = new Request('https://node.tail756ed7.ts.net/api/push/subscriptions', {
      method: 'POST',
      headers: {
        host,
        origin,
        'tailscale-user-login': 'owner@example.com'
      }
    })
    const authValid = validatePushAuth(validReq, host, origin, 'owner@example.com')
    expect(authValid.allowed).toBe(true)
    expect(authValid.status).toBe(200)

    // Missing Tailscale-User-Login
    const noUserReq = new Request('https://node.tail756ed7.ts.net/api/push/subscriptions', {
      method: 'POST',
      headers: {
        host,
        origin
      }
    })
    const authNoUser = validatePushAuth(noUserReq, host, origin, 'owner@example.com')
    expect(authNoUser.allowed).toBe(false)
    expect(authNoUser.status).toBe(403)

    // Mismatched Tailscale-User-Login (tailnet membership without matching login is forbidden)
    const badUserReq = new Request('https://node.tail756ed7.ts.net/api/push/subscriptions', {
      method: 'POST',
      headers: {
        host,
        origin,
        'tailscale-user-login': 'stranger@example.com'
      }
    })
    const authBadUser = validatePushAuth(badUserReq, host, origin, 'owner@example.com')
    expect(authBadUser.allowed).toBe(false)
    expect(authBadUser.status).toBe(403)
  })

  test('rejects unauthorized origin', () => {
    const req = new Request('http://127.0.0.1:8787/api/push/subscriptions', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:8787',
        origin: 'http://malicious-site.com'
      }
    })
    const auth = validatePushAuth(req, '127.0.0.1:8787', 'http://malicious-site.com', 'owner@example.com')
    expect(auth.allowed).toBe(false)
    expect(auth.status).toBe(403)
  })
})
