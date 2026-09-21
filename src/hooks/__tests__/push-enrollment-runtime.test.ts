import { describe, expect, test } from 'bun:test'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createECDH } from 'node:crypto'
import { PushSubscriptionStore } from '../../../server/push/store.ts'
import { createPushOperationRuntime } from '../../utils/push-operation-runtime.ts'
import * as orchestration from '../../utils/push-orchestration.ts'
import * as browserErrors from '../../utils/push-browser-error.ts'
import { resolvePushState } from '../../utils/push-helpers.ts'
import { createPushEnableOperation } from '../../utils/push-enable-operation.ts'

// Inspection-only source/runtime harness. Enable behavior is tested by directly
// importing the shared production operation in push-enable-operation.test.ts.
const source = readFileSync(join(import.meta.dir, '../use-push-subscription.ts'), 'utf8')
const operations = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(
  source.indexOf('const initialSnapshot:'),
  source.indexOf('export interface IUsePushSubscriptionResult')
))
const publicKey = createECDH('prime256v1').generateKeys().toString('base64url')
const keys = { p256dh: publicKey, auth: 'A'.repeat(22) }
const payload = (device: string) => ({ endpoint: `https://push.example/${device}`, keys })

const setup = async (local: boolean, failSync = false) => {
  const directory = mkdtempSync(join(tmpdir(), 'herdr-enrollment-'))
  const store = new PushSubscriptionStore(join(directory, 'subscriptions.json'))
  await store.addSubscription(payload('other-device'))
  const calls = { subscribe: 0, sync: 0, inspect: 0 }
  const subscription = {
    ...payload('current-device'), expirationTime: null,
    options: { applicationServerKey: null },
    toJSON: () => payload('current-device'),
    unsubscribe: async () => true
  }
  const registration = {
    active: { postMessage: (_: unknown, ports: Array<{ postMessage: (data: unknown) => void }>) =>
      ports[0].postMessage({ type: 'herdr:service-worker-version', version: '2026-09-20-spaces-router-v1' }) },
    update: async () => {},
    pushManager: {
      getSubscription: async () => { calls.inspect++; return local ? subscription : null },
      subscribe: () => { calls.subscribe++; return Promise.resolve(subscription) }
    }
  }
  class TestMessageChannel {
    port1 = { onmessage: (_: { data: unknown }) => {} }
    port2 = { postMessage: (data: unknown) => this.port1.onmessage({ data }) }
  }
  const dependencies = {
    createPushOperationRuntime, createPushEnableOperation, ...orchestration, ...browserErrors,
    window: { PushManager: {}, Notification: {} },
    navigator: { serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) } },
    Notification: { permission: 'granted' }, MessageChannel: TestMessageChannel,
    fetchPushConfig: async () => ({ ok: true, enabled: true, publicKey }),
    registerPushSubscription: async (sub: ReturnType<typeof payload>) => {
      calls.sync++
      if (failSync) throw new Error('private-backend-detail')
      await store.addSubscription(sub)
      return { ok: true }
    },
    deletePushSubscription: (endpoint: string) => store.removeSubscription(endpoint)
  }
  const harness = new Function(...Object.keys(dependencies), `${operations}
    return { pushRuntime, runInitialInspection }
  `)(...Object.values(dependencies))
  const inspect = async () => {
    const { ticket } = harness.pushRuntime.admitInspection()
    await harness.runInitialInspection(ticket)
    const snapshot = harness.pushRuntime.snapshot()
    return resolvePushState({
      ...snapshot, isIos: false, isStandalone: false,
      hasSubscription: Boolean(snapshot.subscription), backendError: snapshot.error
    })
  }
  return {
    ...harness, store, calls, inspect,
    cleanup: () => { harness.pushRuntime.resetForTests(); rmSync(directory, { recursive: true, force: true }) }
  }
}

describe('Push inspection source/runtime proof', () => {
  test('another stored device plus granted permission cannot activate a device with no local subscription', async () => {
    const harness = await setup(false)
    try {
      expect((await harness.store.getSubscriptions()).length).toBe(1)
      expect(await harness.inspect()).toBe('inactive')
      expect(harness.pushRuntime.snapshot().subscription).toBeNull()
      expect(harness.calls).toEqual({ inspect: 1, subscribe: 0, sync: 0 })
      expect(await harness.store.getSubscription(payload('other-device').endpoint)).not.toBeNull()
    } finally { harness.cleanup() }
  })

  test('existing local subscription missing from backend is synchronized idempotently without browser subscribe', async () => {
    const harness = await setup(true)
    try {
      expect(await harness.inspect()).toBe('active')
      expect(await harness.inspect()).toBe('active')
      expect(harness.calls).toEqual({ inspect: 2, subscribe: 0, sync: 2 })
      expect((await harness.store.getSubscriptions()).length).toBe(2)
      expect(await harness.store.getSubscription(payload('other-device').endpoint)).not.toBeNull()
    } finally { harness.cleanup() }
  })

  test('local subscription is not Active when backend synchronization fails', async () => {
    const harness = await setup(true, true)
    try {
      expect(await harness.inspect()).toBe('backend-error')
      expect(harness.pushRuntime.snapshot().subscription).not.toBeNull()
      expect(harness.pushRuntime.snapshot().error).not.toContain('private-backend-detail')
      expect(harness.calls.subscribe).toBe(0)
    } finally { harness.cleanup() }
  })


})
