import { describe, expect, it } from 'bun:test'
import { createSnapshotReader } from '../snapshot-reader.ts'
import type { ISnapshotResult } from '../../types/herdr.ts'

const snapshot = (version: string) =>
  ({ version, workspaces: [], panes: [] }) as unknown as ISnapshotResult
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const harness = () => {
  let time = 0
  let nextId = 0
  const tasks = new Map<
    number,
    { at: number; repeat: number; run: () => void }
  >()
  const add = (run: () => void, delay: number, repeat = 0) => {
    const id = ++nextId
    tasks.set(id, { at: time + delay, repeat, run })
    return id
  }
  const timers = {
    setTimeout: (run: () => void, delay: number) => add(run, delay),
    setInterval: (run: () => void, delay: number) => add(run, delay, delay),
    clearTimeout: (id: number) => tasks.delete(id),
    clearInterval: (id: number) => tasks.delete(id)
  } as unknown as Pick<
    typeof globalThis,
    'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'
  >
  const advance = (ms: number) => {
    const end = time + ms
    for (;;) {
      const next = [...tasks.entries()]
        .filter(([, task]) => task.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      const [id, task] = next
      time = task.at
      if (task.repeat) task.at += task.repeat
      else tasks.delete(id)
      task.run()
    }
    time = end
  }
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const browser = Object.assign(new EventTarget(), {
    location: { protocol: 'https:', host: 'test' }
  })
  const sockets: Array<WebSocket & { sent: string[]; closes: number }> = []
  const reads: Array<
    ReturnType<typeof deferred<ISnapshotResult>> & { signal?: AbortSignal }
  > = []
  const applied: ISnapshotResult[] = []
  let errors = 0
  let status = 'loading'
  const appliedAt: number[] = []
  const reader = createSnapshotReader({
    page: page as unknown as Document,
    browser: browser as unknown as Window,
    timers,
    read: (signal) => {
      const ticket = { ...deferred<ISnapshotResult>(), signal }
      reads.push(ticket)
      return ticket.promise
    },
    openSocket: () => {
      const ws = {
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        sent: [] as string[],
        closes: 0,
        send(this: { sent: string[] }, data: string) {
          this.sent.push(data)
        },
        close(this: { closes: number }) {
          this.closes++
        }
      } as unknown as WebSocket & { sent: string[]; closes: number }
      sockets.push(ws)
      return ws
    },
    onSnapshot: (data) => {
      applied.push(data)
      appliedAt.push(time)
      status = 'connected'
    },
    onError: () => {
      errors++
      status = 'reconnecting'
    },
    onReconnecting: () => {
      status = 'reconnecting'
    }
  })
  const message = (index: number, value: unknown) =>
    sockets[index].onmessage?.call(sockets[index], {
      data: JSON.stringify(value)
    } as MessageEvent)
  const open = (index: number) =>
    sockets[index].onopen?.call(sockets[index], {} as Event)
  return {
    reader,
    page,
    browser,
    sockets,
    reads,
    applied,
    advance,
    tasks,
    message,
    open,
    errors: () => errors,
    status: () => status,
    appliedAt
  }
}

describe('snapshot browser read recovery', () => {
  for (const order of [
    ['visible', 'pageshow', 'online'],
    ['visible', 'online', 'pageshow'],
    ['pageshow', 'online', 'visible'],
    ['pageshow', 'visible', 'online'],
    ['online', 'visible', 'pageshow'],
    ['online', 'pageshow', 'visible']
  ]) {
    for (const gap of [0, 50, 250]) {
      it(`resumes in 200ms without restarting for ${order.join('+')} at ${gap}ms gaps`, async () => {
        const h = harness()
        h.page.visibilityState = 'hidden'
        h.page.dispatchEvent(new Event('visibilitychange'))
        expect(h.reads[0].signal?.aborted).toBe(true)
        h.page.visibilityState = 'visible'
        let elapsed = 0
        for (const [index, event] of order.entries()) {
          const at = index * gap
          // Complete at exactly 200ms, even when later notifications arrive after success.
          if (at >= 200 && !h.applied.length) {
            h.advance(200 - elapsed)
            elapsed = 200
            h.reads[1].resolve(snapshot('resumed'))
            await flush()
          }
          h.advance(at - elapsed)
          elapsed = at
          if (event === 'visible')
            h.page.dispatchEvent(new Event('visibilitychange'))
          else h.browser.dispatchEvent(new Event(event))
        }
        if (!h.applied.length) {
          h.advance(200 - elapsed)
          h.reads[1].resolve(snapshot('resumed'))
          await flush()
        }
        expect(h.appliedAt).toEqual([200])
        expect(h.status()).toBe('connected')
        expect(h.sockets).toHaveLength(2)
        expect(h.reads).toHaveLength(2)
        expect(h.reads[1].signal?.aborted).toBe(false)
        h.reads[0].resolve(snapshot('obsolete'))
        await flush()
        expect(h.applied.map((s) => s.version)).toEqual(['resumed'])
        h.reader.stop()
      })
    }
  }

  it('successful HTTP truth survives later unhealthy status; bridge health alone cannot suppress recovery after read failure', async () => {
    const h = harness()
    h.reads[0].resolve(snapshot('http'))
    await flush()
    h.message(0, { type: 'status', status: 'reconnecting' })
    expect(h.status()).toBe('connected')
    h.advance(2000)
    h.reads[1].reject(new Error('HTTP failed'))
    await flush()
    expect(h.status()).toBe('reconnecting')
    h.message(0, { type: 'status', status: 'connected' })
    expect(h.reads).toHaveLength(3)
    expect(h.status()).toBe('reconnecting')
    h.reads[2].resolve(snapshot('healed'))
    await flush()
    expect(h.status()).toBe('connected')
    h.advance(6000)
    expect(h.reads).toHaveLength(3)
    h.reader.stop()
  })

  it('connected status before a failed HTTP read still leaves polling enabled', async () => {
    const h = harness()
    h.message(0, { type: 'status', status: 'connected' })
    h.reads[0].reject(new Error('HTTP failed'))
    await flush()
    h.advance(2000)
    expect(h.reads).toHaveLength(2)
    h.reads[1].resolve(snapshot('healed'))
    await flush()
    expect(h.status()).toBe('connected')
    h.reader.stop()
  })

  it('offline invalidates a stalled visible read once; online starts immediately', async () => {
    const h = harness()
    h.browser.dispatchEvent(new Event('offline'))
    h.browser.dispatchEvent(new Event('offline'))
    expect(h.reads[0].signal?.aborted).toBe(true)
    h.browser.dispatchEvent(new Event('online'))
    h.browser.dispatchEvent(new Event('online'))
    expect(h.reads).toHaveLength(2)
    expect(h.sockets).toHaveLength(2)
    h.advance(180)
    h.reads[1].resolve(snapshot('online'))
    await flush()
    expect(h.appliedAt).toEqual([180])
    h.reader.stop()
  })
  it('bounds forever CONNECTING and ignores retired socket callbacks', () => {
    const h = harness()
    const stale = h.sockets[0].onmessage!
    h.advance(10000)
    expect(h.sockets[0].closes).toBe(1)
    h.advance(1000)
    expect(h.sockets).toHaveLength(2)
    stale.call(h.sockets[0], {
      data: JSON.stringify({ type: 'snapshot', data: snapshot('stale') })
    } as MessageEvent)
    expect(h.applied).toHaveLength(0)
    h.reader.stop()
    expect(h.tasks.size).toBe(0)
  })

  it('keeps idle connected bridges healthy through application ping replies, but recovers stale-open sockets', async () => {
    const h = harness()
    h.open(0)
    h.message(0, { type: 'status', status: 'connected' })
    h.reads[0].resolve(snapshot('bootstrap'))
    await flush()
    h.advance(15000)
    expect(h.sockets[0].sent).toEqual(['{"type":"events.ping"}'])
    h.message(0, { type: 'status', status: 'connected' })
    h.advance(15000)
    expect(h.sockets).toHaveLength(1)
    expect(h.reads).toHaveLength(1)
    // No reply to the second ping, despite socket remaining OPEN.
    h.advance(10000)
    expect(h.sockets[0].closes).toBe(1)
    h.advance(1000)
    expect(h.sockets).toHaveLength(2)
    h.reader.stop()
  })

  it('does not confuse socket-open with bridge health or overlap fallback reads', async () => {
    const h = harness()
    h.open(0)
    h.advance(4000)
    expect(h.reads).toHaveLength(1)
    const first = h.reader.refresh()
    expect(h.reader.refresh()).toBe(first)
    h.reads[0].resolve(snapshot('one'))
    expect(await first).toBe(true)
    h.message(0, { type: 'status', status: 'reconnecting' })
    h.advance(2000)
    expect(h.reads).toHaveLength(2)
    h.reader.stop()
    expect(h.reads[1].signal?.aborted).toBe(true)
    h.reads[1].resolve(snapshot('after-stop'))
    await flush()
    expect(h.applied.map((s) => s.version)).toEqual(['one'])
  })

  it('fences older HTTP against pushed snapshots and lifecycle recovery', async () => {
    const h = harness()
    h.message(0, { type: 'snapshot', data: snapshot('push') })
    expect(h.reads[0].signal?.aborted).toBe(true)
    h.reads[0].resolve(snapshot('old-http'))
    await flush()
    expect(h.applied.map((s) => s.version)).toEqual(['push'])
    h.page.visibilityState = 'hidden'
    h.page.dispatchEvent(new Event('visibilitychange'))
    expect(h.sockets[0].closes).toBe(1)
    h.page.visibilityState = 'visible'
    h.page.dispatchEvent(new Event('visibilitychange'))
    expect(h.sockets).toHaveLength(2)
    expect(h.reads).toHaveLength(2)
    h.browser.dispatchEvent(new Event('pageshow'))
    h.browser.dispatchEvent(new Event('online'))
    expect(h.sockets.filter((s) => !s.closes)).toHaveLength(1)
    expect(h.reads).toHaveLength(2)
    expect(h.reads[1].signal?.aborted).toBe(false)
    h.reads[1].resolve(snapshot('recovered'))
    await flush()
    expect(h.applied.map((s) => s.version)).toEqual(['push', 'recovered'])
    h.browser.dispatchEvent(new Event('pagehide'))
    expect(h.sockets.at(-1)!.closes).toBe(1)
    h.reader.stop()
    expect(h.tasks.size).toBe(0)
    h.browser.dispatchEvent(new Event('pageshow'))
    expect(h.sockets).toHaveLength(2)
    expect(h.errors()).toBe(0)
  })
})
