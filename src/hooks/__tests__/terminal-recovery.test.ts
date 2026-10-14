import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

// Evaluate the production hook with local dependencies; never mock React's
// module or replace global timers, so this harness cannot pollute other tests.
const source = readFileSync(
  new URL('../use-terminal-stream.ts', import.meta.url),
  'utf8'
)
const executable = new Bun.Transpiler({ loader: 'ts' }).transformSync(
  source.replace(/^import .*\n/gm, '').replace(/\bexport /g, '')
)

const harness = () => {
  const slots: Array<any> = []
  let cursor = 0
  let effects: Array<() => void> = []
  let time = 0
  let nextId = 0
  const tasks = new Map<number, { at: number; run: () => void }>()
  const browser = Object.assign(new EventTarget(), {
    location: { protocol: 'http:', host: 'test' }
  })
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const sockets: TestSocket[] = []
  class TestSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    readyState = 0
    closes = 0
    onopen: any = null
    onmessage: any = null
    onclose: any = null
    onerror: any = null
    constructor(readonly url: string) {
      sockets.push(this)
    }
    close() {
      this.closes++
      this.readyState = 3
    }
    send() {}
    open() {
      this.readyState = 1
      this.onopen?.({})
    }
    message(data: unknown) {
      this.onmessage?.({ data: JSON.stringify(data) })
    }
    deny(reason = 'FIT_BUSY') {
      this.readyState = 3
      this.onclose?.({ code: 4409, reason })
    }
  }
  const dependencies = {
    window: browser,
    document: page,
    WebSocket: TestSocket,
    setTimeout: (run: () => void, delay: number) => {
      const id = ++nextId
      tasks.set(id, { at: time + delay, run })
      return id
    },
    clearTimeout: (id: number) => tasks.delete(id),
    useRef: (initial: unknown) => {
      const i = cursor++
      return slots[i] ?? (slots[i] = { current: initial })
    },
    useState: (initial: any) => {
      const i = cursor++
      slots[i] ??= {
        value: typeof initial === 'function' ? initial() : initial
      }
      return [
        slots[i].value,
        (next: any) => {
          slots[i].value =
            typeof next === 'function' ? next(slots[i].value) : next
        }
      ]
    },
    useEffect: (run: () => any, deps: unknown[]) => {
      const i = cursor++
      const prior = slots[i]
      if (
        prior?.deps.length === deps.length &&
        deps.every((v, j) => Object.is(v, prior.deps[j]))
      )
        return
      effects.push(() => {
        prior?.cleanup?.()
        slots[i] = { deps, cleanup: run() }
      })
    },
    useCallback: (fn: any) => {
      cursor++
      return fn
    }
  }
  const hook = new Function(
    ...Object.keys(dependencies),
    `${executable}\nreturn useTerminalStream`
  )(...Object.values(dependencies))
  let paneId = 'A'
  let terminalId = 'TA'
  let output: any
  const render = () => {
    cursor = 0
    effects = []
    output = hook({ paneId, terminalId, onData: () => {} })
    effects.forEach((run) => run())
    return output
  }
  const advance = (ms: number) => {
    const end = time + ms
    for (;;) {
      const next = [...tasks.entries()]
        .filter(([, task]) => task.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      tasks.delete(next[0])
      time = next[1].at
      next[1].run()
    }
    time = end
  }
  render()
  return {
    sockets,
    tasks,
    render,
    advance,
    visibility: (value: string) => {
      page.visibilityState = value
      page.dispatchEvent(new Event('visibilitychange'))
      render()
    },
    target: () => {
      paneId = 'B'
      terminalId = 'TB'
      render()
    },
    stop: () => {
      slots.forEach((slot) => slot?.cleanup?.())
      expect(tasks.size).toBe(0)
    }
  }
}
const emptyFrame = {
  type: 'terminal.frame',
  seq: 0,
  full: true,
  encoding: 'ansi',
  width: 80,
  height: 24,
  bytes: ''
}

describe('production terminal hook recovery', () => {
  it('retires forever CONNECTING and OPEN without a first frame, then retries', () => {
    for (const open of [false, true]) {
      const h = harness()
      try {
        if (open) h.sockets[0].open()
        h.advance(10000)
        expect(h.sockets[0].closes).toBe(1)
        expect(h.render().connectionState).toBe('reconnecting')
        h.advance(750)
        expect(h.sockets).toHaveLength(2)
      } finally {
        h.stop()
      }
    }
  })

  it('valid empty first frame proves liveness without falsely declaring Live or retrying idle output', () => {
    const h = harness()
    try {
      h.sockets[0].open()
      h.sockets[0].message(emptyFrame)
      h.advance(60000)
      expect(h.sockets).toHaveLength(1)
      expect(h.sockets[0].closes).toBe(0)
      expect(h.render().connectionState).toBe('connecting')
      expect(h.tasks.size).toBe(0)
    } finally {
      h.stop()
    }
  })

  it('preserves manual denial over hidden/visible, allows explicit Retry and resets on a new exact target', () => {
    const h = harness()
    try {
      h.sockets[0].deny()
      h.visibility('hidden')
      h.visibility('visible')
      h.advance(20000)
      expect(h.sockets).toHaveLength(1)
      expect(h.render().lastError).toContain('Another viewer')
      h.render().reconnect()
      expect(h.sockets).toHaveLength(2)
      h.sockets[1].deny('FIT_BLOCKED_BY_CONTROL')
      h.target()
      expect(h.sockets).toHaveLength(3)
      expect(h.sockets[2].url).toContain('pane=B&terminalId=TB')
    } finally {
      h.stop()
    }
  })

  it('ignores retained message/open/close callbacks from a retired socket', () => {
    const h = harness()
    try {
      const old = h.sockets[0]
      const callbacks = {
        message: old.onmessage,
        open: old.onopen,
        close: old.onclose
      }
      h.target()
      callbacks.message({
        data: JSON.stringify({ type: 'terminal.scroll-state', offset: 99 })
      })
      callbacks.open({})
      callbacks.close({ code: 4409, reason: 'FIT_BUSY' })
      expect(h.render().scrollState).toBeNull()
      expect(h.render().lastError).toBeNull()
      h.advance(10000)
      expect(h.sockets[1].closes).toBe(1)
      h.advance(750)
      expect(h.sockets).toHaveLength(3)
    } finally {
      h.stop()
    }
  })
})
