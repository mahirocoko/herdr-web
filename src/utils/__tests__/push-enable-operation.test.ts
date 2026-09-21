import { describe, expect, test } from 'bun:test'
import { createPushEnableOperation, type IPushRuntimeSnapshot } from '../push-enable-operation.ts'
import { createPushOperationRuntime } from '../push-operation-runtime.ts'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const setup = (options: { deadlineMs?: number; throwSynchronously?: boolean; failBackend?: boolean } = {}) => {
  const pending = deferred<PushSubscription>()
  const calls = { subscribe: 0, register: 0, remove: 0, unsubscribe: 0 }
  const order: string[] = []
  const subscription = {
    endpoint: 'https://push.example/current-device',
    unsubscribe: async () => { calls.unsubscribe++; return true }
  } as unknown as PushSubscription
  const registration = {
    pushManager: {
      subscribe: () => {
        calls.subscribe++
        order.push(runtime.currentTicket()?.kind === 'enable' ? 'subscribe-with-ticket' : 'missing-ticket')
        if (options.throwSynchronously) throw { name: 'NotAllowedError' }
        return pending.promise
      },
      getSubscription: async () => subscription
    }
  } as unknown as ServiceWorkerRegistration
  const runtime = createPushOperationRuntime<IPushRuntimeSnapshot>({
    registration, subscription: null, publicKey: 'AQAB', permission: 'granted',
    isSupported: true, isReady: true, isBusy: false, isOperationPending: false, error: null
  }, options.deadlineMs)
  const enable = createPushEnableOperation({
    runtime,
    registerSubscription: async (actual) => {
      expect(actual).toBe(subscription)
      calls.register++
      if (options.failBackend) throw new Error('private backend failure')
    },
    deletePushSubscription: async (endpoint) => {
      expect(endpoint).toBe(subscription.endpoint)
      calls.remove++
    },
    getPermission: () => 'granted'
  })
  const attached: number[] = []
  return {
    runtime, pending, calls, subscription, order, attached,
    enable: () => enable((ticket) => { attached.push(ticket.id); order.push('attach') })
  }
}

describe('production Push enable operation', () => {
  test('accepted admission invokes browser subscribe once synchronously; concurrent admission adds no call', async () => {
    const harness = setup()
    try {
      const first = harness.enable()
      // Assert before any await: the user-gesture invocation has already happened.
      expect(harness.calls.subscribe).toBe(1)
      expect(harness.order).toEqual(['attach', 'subscribe-with-ticket'])
      const second = harness.enable()
      expect(harness.calls.subscribe).toBe(1)
      expect(harness.attached).toEqual([1, 1])
      expect(harness.calls.register).toBe(0)
      harness.pending.resolve(harness.subscription)
      await Promise.all([first, second])
      expect(harness.calls).toEqual({ subscribe: 1, register: 1, remove: 0, unsubscribe: 0 })
      expect(harness.runtime.currentTicket()).toBeNull()
      expect(harness.runtime.snapshot().subscription).toBe(harness.subscription)
    } finally { harness.runtime.resetForTests() }
  })

  test('rejected browser settlement registers nothing and never automatically retries', async () => {
    const harness = setup()
    try {
      const operation = harness.enable()
      expect(harness.calls.subscribe).toBe(1)
      harness.pending.reject({ name: 'AbortError' })
      await operation
      await new Promise((resolve) => setTimeout(resolve, 15))
      expect(harness.calls).toEqual({ subscribe: 1, register: 0, remove: 0, unsubscribe: 0 })
      expect(harness.runtime.currentTicket()).toBeNull()
      expect(harness.runtime.snapshot().subscription).toBeNull()
      expect(harness.runtime.snapshot().error).toContain('AbortError')
    } finally { harness.runtime.resetForTests() }
  })

  test('synchronous browser exception completes the one admitted operation without backend registration', async () => {
    const harness = setup({ throwSynchronously: true })
    try {
      await harness.enable()
      expect(harness.calls.subscribe).toBe(1)
      expect(harness.calls.register).toBe(0)
      expect(harness.runtime.currentTicket()).toBeNull()
      expect(harness.runtime.snapshot().error).toBe('Push permission was not granted')
    } finally { harness.runtime.resetForTests() }
  })

  for (const outcome of ['success', 'reject'] as const) {
    test(`deadline retains exclusivity until late ${outcome} of the original browser call`, async () => {
      const harness = setup({ deadlineMs: 5 })
      try {
        const operation = harness.enable()
        const ticket = harness.runtime.currentTicket()
        await new Promise((resolve) => setTimeout(resolve, 15))
        expect(harness.runtime.snapshot().isOperationPending).toBe(true)
        await harness.enable()
        expect(harness.runtime.currentTicket()).toBe(ticket)
        expect(harness.calls.subscribe).toBe(1)
        if (outcome === 'success') harness.pending.resolve(harness.subscription)
        else harness.pending.reject({ name: 'AbortError' })
        await operation
        expect(harness.calls.subscribe).toBe(1)
        expect(harness.calls.register).toBe(outcome === 'success' ? 1 : 0)
        expect(harness.runtime.currentTicket()).toBeNull()
        expect(harness.runtime.snapshot().isOperationPending).toBe(false)
      } finally { harness.runtime.resetForTests() }
    })
  }

  test('backend rejection preserves rollback of only the created subscription', async () => {
    const harness = setup({ failBackend: true })
    try {
      const operation = harness.enable()
      harness.pending.resolve(harness.subscription)
      await operation
      expect(harness.calls).toEqual({ subscribe: 1, register: 1, remove: 1, unsubscribe: 1 })
      expect(harness.runtime.snapshot().subscription).toBeNull()
      expect(harness.runtime.snapshot().error).toBe('Backend registration failed; the browser subscription was rolled back')
    } finally { harness.runtime.resetForTests() }
  })

  test('not-ready state performs no browser or backend mutation', async () => {
    const harness = setup()
    try {
      const { ticket } = harness.runtime.admitInspection()
      harness.runtime.complete(ticket, { isReady: false })
      await harness.enable()
      expect(harness.calls).toEqual({ subscribe: 0, register: 0, remove: 0, unsubscribe: 0 })
    } finally { harness.runtime.resetForTests() }
  })
})
