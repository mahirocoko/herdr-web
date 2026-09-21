import { afterEach, describe, expect, test } from 'bun:test'
import {
  createPushOperationRuntime,
  type IPushOperationSnapshot
} from '../push-operation-runtime.ts'
import { executeRemovalWorkflow } from '../push-orchestration.ts'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const initialSnapshot = (): IPushOperationSnapshot => ({
  isBusy: false,
  isOperationPending: false,
  error: null
})

const runtimes: Array<ReturnType<typeof createPushOperationRuntime>> = []
const makeRuntime = (deadlineMs = 10) => {
  const runtime = createPushOperationRuntime(initialSnapshot(), deadlineMs)
  runtimes.push(runtime)
  return runtime
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.resetForTests()
})

describe('push operation runtime', () => {
  test('deadline exits busy while retaining exclusive ownership until late success', async () => {
    const runtime = makeRuntime()
    const { ticket, admitted } = runtime.admitExclusive('enable')
    expect(admitted).toBe(true)
    runtime.publish(ticket, { isBusy: true })

    await wait(15)
    expect(runtime.currentTicket()?.id).toBe(ticket.id)
    expect(runtime.snapshot()).toMatchObject({
      isBusy: false,
      isOperationPending: true
    })

    runtime.complete(ticket, { error: null })
    expect(runtime.currentTicket()).toBeNull()
    expect(runtime.snapshot().isOperationPending).toBe(false)
  })

  test('rapid duplicate admission and retry after deadline join one browser mutation', async () => {
    const runtime = makeRuntime()
    const first = runtime.admitExclusive('enable')
    let mutationCalls = 0
    if (first.admitted) mutationCalls++
    const second = runtime.admitExclusive('enable')
    if (second.admitted) mutationCalls++

    await wait(15)
    const retry = runtime.admitExclusive('enable')
    if (retry.admitted) mutationCalls++

    expect(second.ticket.id).toBe(first.ticket.id)
    expect(retry.ticket.id).toBe(first.ticket.id)
    expect(mutationCalls).toBe(1)
  })

  test('superseded inspection cannot publish, upgrade, or launch effects', () => {
    const runtime = makeRuntime(100)
    const oldInspection = runtime.admitInspection()
    const newerInspection = runtime.admitInspection()

    expect(runtime.publish(oldInspection.ticket, { error: 'stale' })).toBe(false)
    expect(runtime.upgradeToExclusive(oldInspection.ticket, 'rotation')).toBe(false)
    expect(runtime.snapshot().error).toBeNull()
    expect(runtime.currentTicket()?.id).toBe(newerInspection.ticket.id)
  })

  test('Strict Mode-like detach and reattach avoids stale setter and receives latest snapshot', () => {
    const runtime = makeRuntime(100)
    const { ticket } = runtime.admitExclusive('disable')
    const oldViews: IPushOperationSnapshot[] = []
    const newViews: IPushOperationSnapshot[] = []
    const detach = runtime.observe(ticket, (snapshot) => oldViews.push(snapshot))
    runtime.publish(ticket, { isBusy: true, error: null })
    detach()
    runtime.publish(ticket, { error: 'still reconciling' })
    runtime.observe(ticket, (snapshot) => newViews.push(snapshot))

    expect(oldViews.at(-1)?.error).toBeNull()
    expect(newViews[0]).toMatchObject({ isBusy: true, error: 'still reconciling' })
    expect(runtime.admitExclusive('disable').admitted).toBe(false)
  })

  test('reset helper clears ticket, observers, timers, and monotonic test state', () => {
    const runtime = makeRuntime(100)
    const first = runtime.admitExclusive('test')
    runtime.observe(first.ticket, () => {})
    runtime.resetForTests()
    expect(runtime.currentTicket()).toBeNull()
    expect(runtime.snapshot()).toEqual(initialSnapshot())
    const second = runtime.admitExclusive('test')
    expect(second.ticket.id).toBe(1)
  })

  test('final snapshot is published before compare-and-clear', () => {
    const runtime = makeRuntime(100)
    const { ticket } = runtime.admitExclusive('test')
    let ownedDuringFinalPublication = false
    runtime.observe(ticket, (snapshot) => {
      if (snapshot.error === 'finished') {
        ownedDuringFinalPublication = runtime.currentTicket()?.id === ticket.id
      }
    })

    runtime.complete(ticket, { error: 'finished' })
    expect(ownedDuringFinalPublication).toBe(true)
    expect(runtime.currentTicket()).toBeNull()
  })

  for (const outcome of ['success', 'reject'] as const) {
    test(`subscribe deadline followed by late ${outcome} settles the original ticket`, async () => {
      const runtime = makeRuntime()
      const pending = deferred<void>()
      const { ticket } = runtime.admitExclusive('enable')
      void pending.promise.then(
        () => runtime.complete(ticket, { error: null }),
        () => runtime.complete(ticket, { error: 'Push subscription failed' })
      )

      await wait(15)
      expect(runtime.currentTicket()?.id).toBe(ticket.id)
      if (outcome === 'success') pending.resolve()
      else pending.reject(new Error('provider detail'))
      await Promise.resolve()
      expect(runtime.snapshot()).toMatchObject({
        isBusy: false,
        isOperationPending: false,
        error: outcome === 'success' ? null : 'Push subscription failed'
      })
    })
  }

  for (const kind of ['disable', 'rotation', 'rollback'] as const) {
    for (const outcome of ['true', 'false', 'reject'] as const) {
      test(`${kind} deadline retains ownership through late ${outcome} and reconciles`, async () => {
        const runtime = makeRuntime()
        const removal = deferred<boolean>()
        const captured = {
          endpoint: `https://push.example/${kind}`,
          unsubscribe: () => removal.promise
        }
        const { ticket } = runtime.admitExclusive(kind)
        const settlement = executeRemovalWorkflow({
          capturedSub: captured,
          getSubscription: async () => outcome === 'true' ? captured : null,
          deleteBackendSubscription: async () => undefined
        }).then((result) => runtime.complete(ticket, {
          error: result.status === 'retained' || result.status === 'uncertain' ? result.error : null
        }))

        await wait(15)
        expect(runtime.currentTicket()?.id).toBe(ticket.id)
        if (outcome === 'true') removal.resolve(true)
        else if (outcome === 'false') removal.resolve(false)
        else removal.reject(new Error('browser detail'))
        await settlement
        expect(runtime.currentTicket()).toBeNull()
      })
    }
  }
})
