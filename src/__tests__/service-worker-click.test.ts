import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'

interface IClickEvent {
  notification: {
    data?: { url?: string; workspaceId?: string }
    tag?: string
    close: () => void
  }
  waitUntil: (promise: Promise<unknown>) => void
}

const loadClickHandler = (
  clients: Record<string, unknown>,
  fetchImpl: typeof fetch = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch
) => {
  const listeners = new Map<string, (event: IClickEvent) => void>()
  const source = fs.readFileSync(path.resolve(import.meta.dir, '../../public/sw.js'), 'utf8')
  const self = {
    location: { origin: 'https://herdr.example' },
    clients,
    registration: { showNotification: async () => undefined },
    skipWaiting: () => undefined,
    addEventListener: (type: string, handler: (event: IClickEvent) => void) => {
      listeners.set(type, handler)
    }
  }
  class FakeMessageChannel {
    public port1: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: (data: unknown) => void }
    public port2: { onmessage: ((event: { data: unknown }) => void) | null; postMessage: (data: unknown) => void }

    constructor() {
      this.port1 = {
        onmessage: null,
        postMessage: (data) => this.port2.onmessage?.({ data })
      }
      this.port2 = {
        onmessage: null,
        postMessage: (data) => this.port1.onmessage?.({ data })
      }
    }
  }
  vm.runInNewContext(source, {
    self,
    URL,
    Array,
    Promise,
    MessageChannel: FakeMessageChannel,
    AbortController,
    fetch: fetchImpl,
    Response,
    setTimeout,
    clearTimeout
  })
  return listeners.get('notificationclick')!
}

describe('public/sw.js: notification click runtime', () => {
  test('messages an existing PWA client with the validated Space and focuses it', async () => {
    const messages: unknown[] = []
    let focused = 0
    const client = {
      url: 'https://herdr.example/?workspace=w5N',
      postMessage: (message: unknown, ports: Array<{ postMessage: (data: unknown) => void }>) => {
        messages.push(message)
        ports[0].postMessage({ type: 'herdr:workspace-opened', workspaceId: 'w5N' })
      },
      focus: async () => { focused++ }
    }
    const handler = loadClickHandler({
      matchAll: async () => [client],
      openWindow: async () => undefined
    })
    let closed = 0
    let completion!: Promise<unknown>
    handler({
      notification: {
        data: { url: '/?workspace=w5N' },
        close: () => { closed++ }
      },
      waitUntil: (promise) => { completion = promise }
    })
    await completion

    expect(closed).toBe(1)
    expect(messages).toEqual([{ type: 'herdr:open-workspace', workspaceId: 'w5N' }])
    expect(focused).toBe(1)
  })

  test('recovers a missing notification data target from the exact safe Space tag', async () => {
    const messages: unknown[] = []
    const client = {
      url: 'https://herdr.example/',
      postMessage: (message: unknown, ports: Array<{ postMessage: (data: unknown) => void }>) => {
        messages.push(message)
        ports[0].postMessage({ type: 'herdr:workspace-opened', workspaceId: 'w5N' })
      },
      focus: async () => undefined
    }
    const handler = loadClickHandler({
      matchAll: async () => [client],
      openWindow: async () => undefined
    })
    let completion!: Promise<unknown>
    handler({
      notification: {
        tag: 'herdr:space:w5N:done',
        close: () => undefined
      },
      waitUntil: (promise) => { completion = promise }
    })
    await completion

    expect(messages).toEqual([{ type: 'herdr:open-workspace', workspaceId: 'w5N' }])
  })

  test('fails closed when validated data and tag target different Spaces', async () => {
    const messages: unknown[] = []
    const opened: string[] = []
    const client = {
      url: 'https://herdr.example/other',
      postMessage: (message: unknown) => { messages.push(message) },
      focus: async () => undefined
    }
    const handler = loadClickHandler({
      matchAll: async () => [client],
      openWindow: async (url: string) => { opened.push(url) }
    })
    let completion!: Promise<unknown>
    handler({
      notification: {
        data: { url: '/?workspace=w5N', workspaceId: 'w5N' },
        tag: 'herdr:space:w5H:done',
        close: () => undefined
      },
      waitUntil: (promise) => { completion = promise }
    })
    await completion

    expect(messages).toEqual([])
    expect(opened).toEqual(['https://herdr.example/'])
  })

  test('explicit rejection of unknown Space causes zero navigate, zero focus, zero open', async () => {
    const opened: string[] = []
    const diagnostics: string[] = []
    let focused = 0
    let navigated = 0
    const client = {
      url: 'https://herdr.example/',
      postMessage: (_message: unknown, ports: Array<{ postMessage: (data: unknown) => void }>) => {
        ports[0].postMessage({
          type: 'herdr:workspace-rejected',
          workspaceId: 'w5N',
          reason: 'unknown_space'
        })
      },
      navigate: async () => { navigated++; return client },
      focus: async () => { focused++ }
    }
    const handler = loadClickHandler(
      {
        matchAll: async () => [client],
        openWindow: async (url: string) => { opened.push(url) }
      },
      (async (_url: string, init?: RequestInit) => {
        if (init?.body) {
          const parsed = JSON.parse(init.body as string)
          if (parsed.stage) diagnostics.push(parsed.stage)
        }
        return new Response(null, { status: 204 })
      }) as unknown as typeof fetch
    )
    let completion!: Promise<unknown>
    handler({
      notification: {
        data: { url: '/spaces/w5N', workspaceId: 'w5N' },
        close: () => undefined
      },
      waitUntil: (promise) => { completion = promise }
    })
    await completion

    expect(focused).toBe(0)
    expect(navigated).toBe(0)
    expect(opened).toEqual([])
    expect(diagnostics).toContain('ack_rejected')
  })

  test('timeout on legacy/no-listener client causes zero navigate, zero focus, zero open', async () => {
    const opened: string[] = []
    const diagnostics: string[] = []
    let focused = 0
    let navigated = 0
    const client = {
      url: 'https://herdr.example/',
      postMessage: () => undefined, // No ack returned on port
      navigate: async () => { navigated++; return client },
      focus: async () => { focused++ }
    }
    const handler = loadClickHandler(
      {
        matchAll: async () => [client],
        openWindow: async (url: string) => { opened.push(url) }
      },
      (async (_url: string, init?: RequestInit) => {
        if (init?.body) {
          const parsed = JSON.parse(init.body as string)
          if (parsed.stage) diagnostics.push(parsed.stage)
        }
        return new Response(null, { status: 204 })
      }) as unknown as typeof fetch
    )
    let completion!: Promise<unknown>
    handler({
      notification: {
        data: { url: '/spaces/w5N', workspaceId: 'w5N' },
        close: () => undefined
      },
      waitUntil: (promise) => { completion = promise }
    })
    await completion

    expect(focused).toBe(0)
    expect(navigated).toBe(0)
    expect(opened).toEqual([])
    expect(diagnostics).toContain('ack_timeout')
  })

  test('invalid response on port causes zero navigate, zero focus, zero open', async () => {
    const opened: string[] = []
    const diagnostics: string[] = []
    let focused = 0
    let navigated = 0
    const client = {
      url: 'https://herdr.example/',
      postMessage: (_message: unknown, ports: Array<{ postMessage: (data: unknown) => void }>) => {
        ports[0].postMessage({ type: 'unexpected_payload', foo: 'bar' })
      },
      navigate: async () => { navigated++; return client },
      focus: async () => { focused++ }
    }
    const handler = loadClickHandler(
      {
        matchAll: async () => [client],
        openWindow: async (url: string) => { opened.push(url) }
      },
      (async (_url: string, init?: RequestInit) => {
        if (init?.body) {
          const parsed = JSON.parse(init.body as string)
          if (parsed.stage) diagnostics.push(parsed.stage)
        }
        return new Response(null, { status: 204 })
      }) as unknown as typeof fetch
    )
    let completion!: Promise<unknown>
    handler({
      notification: {
        data: { url: '/spaces/w5N', workspaceId: 'w5N' },
        close: () => undefined
      },
      waitUntil: (promise) => { completion = promise }
    })
    await completion

    expect(focused).toBe(0)
    expect(navigated).toBe(0)
    expect(opened).toEqual([])
    expect(diagnostics).toContain('ack_invalid')
  })

  test('existing client without messaging support causes zero navigate, zero focus, zero open', async () => {
    const opened: string[] = []
    const diagnostics: string[] = []
    let staleFocuses = 0
    let navigated = 0
    const client = {
      url: 'https://herdr.example/',
      navigate: async () => { navigated++; return client },
      focus: async () => { staleFocuses++ }
    }
    const handler = loadClickHandler(
      {
        matchAll: async () => [client],
        openWindow: async (url: string) => { opened.push(url) }
      },
      (async (_url: string, init?: RequestInit) => {
        if (init?.body) {
          const parsed = JSON.parse(init.body as string)
          if (parsed.stage) diagnostics.push(parsed.stage)
        }
        return new Response(null, { status: 204 })
      }) as unknown as typeof fetch
    )
    let completion!: Promise<unknown>
    handler({
      notification: {
        data: { url: '/spaces/w5N', workspaceId: 'w5N' },
        close: () => undefined
      },
      waitUntil: (promise) => { completion = promise }
    })
    await completion

    expect(staleFocuses).toBe(0)
    expect(navigated).toBe(0)
    expect(opened).toEqual([])
    expect(diagnostics).toContain('ack_unsupported')
  })

  test('zero existing clients opens canonical Space path', async () => {
    const opened: string[] = []
    const diagnostics: string[] = []
    const handler = loadClickHandler(
      {
        matchAll: async () => [],
        openWindow: async (url: string) => {
          opened.push(url)
          return { focus: async () => undefined }
        }
      },
      (async (_url: string, init?: RequestInit) => {
        if (init?.body) {
          const parsed = JSON.parse(init.body as string)
          if (parsed.stage) diagnostics.push(parsed.stage)
        }
        return new Response(null, { status: 204 })
      }) as unknown as typeof fetch
    )
    let completion!: Promise<unknown>
    handler({
      notification: {
        data: { url: '/spaces/w5N', workspaceId: 'w5N' },
        close: () => undefined
      },
      waitUntil: (promise) => { completion = promise }
    })
    await completion

    expect(opened).toEqual(['https://herdr.example/spaces/w5N'])
    expect(diagnostics).toContain('open_ok')
  })

  test('a stalled diagnostic request cannot block Space routing', async () => {
    const messages: unknown[] = []
    const client = {
      url: 'https://herdr.example/',
      postMessage: (message: unknown, ports: Array<{ postMessage: (data: unknown) => void }>) => {
        messages.push(message)
        ports[0].postMessage({ type: 'herdr:workspace-opened', workspaceId: 'w5N' })
      },
      focus: async () => undefined
    }
    const handler = loadClickHandler(
      {
        matchAll: async () => [client],
        openWindow: async () => undefined
      },
      (() => new Promise<Response>(() => {})) as unknown as typeof fetch
    )
    let completion!: Promise<unknown>
    const startedAt = Date.now()
    handler({
      notification: {
        data: { url: '/?workspace=w5N', workspaceId: 'w5N' },
        tag: 'herdr:space:w5N:done',
        close: () => undefined
      },
      waitUntil: (promise) => { completion = promise }
    })
    await completion

    expect(messages).toEqual([{ type: 'herdr:open-workspace', workspaceId: 'w5N' }])
    expect(Date.now() - startedAt).toBeLessThan(500)
  })
})
