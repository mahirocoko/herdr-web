import { describe, expect, test } from 'bun:test'
import {
  createConversationReader,
  emptyConversation,
  reconcileConversation
} from '../use-conversation.ts'
import type { IConversationRead } from '@/types/conversation.ts'
import { ConversationError } from '@/services/conversation-api.ts'

const page = (
  start: number,
  end: number,
  before: string | null,
  sessionKey = 's'
): IConversationRead => ({
  ok: true,
  paneId: 'p',
  source: 'letta-transcript',
  sessionKey,
  metadata: { model: 'model', reasoning_effort: null },
  truncated: false,
  before,
  turns: Array.from({ length: end - start }, (_, index) => ({
    id: String(start + index),
    role: 'assistant',
    ts: null,
    parts: [{ kind: 'text', text: String(start + index) }]
  }))
})

const readerHarness = () => {
  let state = reconcileConversation(
    emptyConversation(),
    page(10, 20, '10'),
    false
  )
  const browser = new EventTarget()
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible'
  })
  const reads: Array<{
    before?: string | null
    signal?: AbortSignal
    resolve: (page: IConversationRead) => void
    reject: (error: unknown) => void
  }> = []
  let loading = false
  let loadingOlder = false
  let error: string | null = null
  const reader = createConversationReader({
    paneId: 'p',
    page: document as unknown as Document,
    browser: browser as unknown as Window,
    pollIntervalMs: 0,
    getState: () => state,
    publish: (next) => {
      state = next
    },
    onLoading: (active, older) => {
      loading = active && !older
      loadingOlder = active && older
    },
    onError: (message) => {
      error = message
    },
    read: (_pane, options) =>
      new Promise((resolve, reject) => {
        reads.push({
          before: options?.before,
          signal: options?.signal,
          resolve,
          reject
        })
      })
  })
  return {
    reader,
    browser,
    document,
    reads,
    state: () => state,
    loading: () => loading,
    loadingOlder: () => loadingOlder,
    error: () => error
  }
}
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('conversation read lifecycle', () => {
  test('Find cancellation fences stale older/session results without retiring a newer read', async () => {
    const h = readerHarness()
    h.reads[0].resolve(page(10, 20, '10'))
    await flush()
    const controller = new AbortController()
    const older = h.reader.request(true, controller.signal)
    expect(h.loadingOlder()).toBe(true)
    expect(await h.reader.request(true)).toBe(false)
    expect(h.reads).toHaveLength(2)
    controller.abort()
    expect(h.reads[1].signal?.aborted).toBe(true)
    expect(h.loadingOlder()).toBe(false)
    const latest = h.reader.request()
    controller.abort()
    expect(h.reads[2].signal?.aborted).toBe(false)
    h.reads[1].resolve(page(0, 10, 'obsolete', 'stale-session'))
    expect(await older).toBe(false)
    h.reads[2].resolve(page(90, 91, null, 'new-session'))
    expect(await latest).toBe(true)
    expect(h.state().sessionKey).toBe('new-session')
    expect(h.state().turns.map((turn) => turn.id)).toEqual(['90'])
    expect(h.error()).toBeNull()
    expect(await h.reader.request(true, controller.signal)).toBe(false)
    h.reader.stop()
  })
  test('Find read failure is truthful and successful older reads advance exactly once', async () => {
    const h = readerHarness()
    h.reads[0].resolve(page(10, 20, '10'))
    await flush()
    const failed = h.reader.request(true, new AbortController().signal)
    h.reads[1].reject(new Error('native read failed'))
    expect(await failed).toBe(false)
    expect(h.error()).toBe('native read failed')
    expect(h.state().before).toBe('10')
    const retry = h.reader.request(true)
    h.reads[2].resolve(page(0, 10, null))
    expect(await retry).toBe(true)
    expect(h.state().before).toBeNull()
    expect(h.state().turns).toHaveLength(20)
    expect(await h.reader.request(true)).toBe(false)
    h.reader.stop()
  })
  for (const order of [
    ['visible', 'pageshow', 'online'],
    ['pageshow', 'online', 'visible'],
    ['online', 'visible', 'pageshow']
  ]) {
    test(`one resume read for ${order.join('+')}, including notifications after success`, async () => {
      const h = readerHarness()
      h.document.visibilityState = 'hidden'
      h.document.dispatchEvent(new Event('visibilitychange'))
      h.document.visibilityState = 'visible'
      for (const [index, event] of order.entries()) {
        if (event === 'visible')
          h.document.dispatchEvent(new Event('visibilitychange'))
        else h.browser.dispatchEvent(new Event(event))
        if (index === 0) {
          h.reads[1].resolve(page(20, 30, '20'))
          await flush()
        }
      }
      expect(h.reads).toHaveLength(2)
      expect(h.reads[1].signal?.aborted).toBe(false)
      h.reads[0].resolve(page(99, 100, null, 'obsolete'))
      await flush()
      expect(h.state().sessionKey).toBe('s')
      expect(h.state().before).toBe('10')
      expect(h.loading()).toBe(false)
      h.reader.stop()
    })
  }

  test('offline retires a stalled visible request once and online resumes it', async () => {
    const h = readerHarness()
    h.browser.dispatchEvent(new Event('offline'))
    h.browser.dispatchEvent(new Event('offline'))
    expect(h.reads[0].signal?.aborted).toBe(true)
    h.browser.dispatchEvent(new Event('online'))
    h.browser.dispatchEvent(new Event('online'))
    expect(h.reads).toHaveLength(2)
    h.reads[1].resolve(page(20, 30, '20'))
    await flush()
    expect(h.state().before).toBe('10')
    expect(h.error()).toBeNull()
    h.reader.stop()
  })
  test('aborts hidden/pagehide tickets; visible/pageshow/online restore reads without losing the loaded frontier', async () => {
    const h = readerHarness()
    h.document.visibilityState = 'hidden'
    h.document.dispatchEvent(new Event('visibilitychange'))
    expect(h.reads[0].signal?.aborted).toBe(true)
    expect(h.loading()).toBe(false)
    h.reads[0].resolve(page(99, 100, null, 'stale'))
    await flush()
    expect(h.state().sessionKey).toBe('s')
    expect(h.state().before).toBe('10')
    h.document.visibilityState = 'visible'
    h.document.dispatchEvent(new Event('visibilitychange'))
    h.reads[1].resolve(page(15, 25, '15'))
    await flush()
    expect(h.state().before).toBe('10')
    expect(h.state().turns.map((turn) => turn.id)).toEqual(
      Array.from({ length: 15 }, (_, i) => String(i + 10))
    )
    const older = h.reader.request(true)
    expect(h.reads[2].before).toBe('10')
    expect(h.loadingOlder()).toBe(true)
    h.browser.dispatchEvent(new Event('pagehide'))
    expect(h.reads[2].signal?.aborted).toBe(true)
    expect(h.loadingOlder()).toBe(false)
    h.browser.dispatchEvent(new Event('pageshow'))
    h.browser.dispatchEvent(new Event('online'))
    expect(h.reads).toHaveLength(4)
    expect(h.reads[3].signal?.aborted).toBe(false)
    h.reads[2].reject(new Error('stale failure'))
    h.reads[3].resolve(page(20, 30, '20'))
    await older
    await flush()
    expect(h.state().before).toBe('10')
    expect(h.state().turns).toHaveLength(20)
    expect(h.error()).toBeNull()
    const olderAgain = h.reader.request(true)
    expect(h.reads[4].before).toBe('10')
    h.reads[4].resolve(page(0, 15, null))
    await olderAgain
    expect(h.state().before).toBeNull()
    expect(new Set(h.state().turns.map((turn) => turn.id)).size).toBe(30)
    h.reader.stop()
    h.browser.dispatchEvent(new Event('online'))
    h.document.dispatchEvent(new Event('visibilitychange'))
    expect(h.reads).toHaveLength(5)
  })

  test('a failed read frees the serial gate and cleanup fences late tickets', async () => {
    const h = readerHarness()
    await h.reader.request(true)
    expect(h.reads).toHaveLength(1)
    h.reads[0].reject(new Error('Conversation read timed out'))
    await flush()
    expect(h.loading()).toBe(false)
    const next = h.reader.request(true)
    expect(h.reads[1].before).toBe('10')
    h.reader.stop()
    expect(h.reads[1].signal?.aborted).toBe(true)
    h.reads[1].resolve(page(0, 10, null, 'late-session'))
    await next
    expect(h.state().sessionKey).toBe('s')
    expect(h.state().before).toBe('10')
  })

  test('recovered native contributions retain IDs without duplication and stale-history 409 still resets', async () => {
    const h = readerHarness()
    const native = page(10, 12, '10')
    native.contributions = native.turns.map((turn, i) => ({
      id: turn.id,
      position: i,
      role: 'assistant',
      ts: null,
      parts: turn.parts
    }))
    h.reads[0].resolve(native)
    await flush()
    h.browser.dispatchEvent(new Event('offline'))
    h.browser.dispatchEvent(new Event('online'))
    h.reads[1].resolve(native)
    await flush()
    expect(h.state().contributions.map((row) => row.id)).toEqual(['10', '11'])
    expect(h.state().before).toBe('10')
    const older = h.reader.request(true)
    h.reads[2].reject(new ConversationError('Changed', 409, 'history_changed'))
    await flush()
    expect(h.state().sessionKey).toBeNull()
    expect(h.reads[3].before).toBeUndefined()
    h.reads[3].resolve(page(40, 41, null, 'new-session'))
    await older
    expect(h.state().sessionKey).toBe('new-session')
    expect(h.state().before).toBeNull()
    h.reader.stop()
  })

  test('older-page session replacement still resets and reads latest before publishing', async () => {
    const h = readerHarness()
    h.reads[0].resolve(page(10, 20, '10'))
    await flush()
    const older = h.reader.request(true)
    h.reads[1].resolve(page(0, 10, 'old-cursor', 'replacement'))
    await flush()
    expect(h.reads[2].before).toBeUndefined()
    h.reads[2].resolve(page(90, 91, null, 'replacement'))
    await older
    expect(h.state().sessionKey).toBe('replacement')
    expect(h.state().turns.map((turn) => turn.id)).toEqual(['90'])
    h.reader.stop()
  })
})

describe('conversation state owner', () => {
  test('120-turn frontier survives polling and preserves all loaded IDs as latest slides', () => {
    let state = reconcileConversation(
      emptyConversation(),
      page(70, 120, '70'),
      false
    )
    state = reconcileConversation(state, page(20, 70, '20'), true)
    state = reconcileConversation(state, page(70, 120, '70'), false)
    expect(state.before).toBe('20')
    state = reconcileConversation(state, page(0, 20, null), true)
    state = reconcileConversation(state, page(71, 121, '71'), false)
    expect(state.turns.map((turn) => turn.id)).toEqual(
      Array.from({ length: 121 }, (_, i) => String(i))
    )
    expect(state.before).toBeNull()
  })

  test('latest overlapping native snapshots win; older pages cannot revert them', () => {
    let state = reconcileConversation(
      emptyConversation(),
      page(1, 3, '1'),
      false
    )
    const updated = page(2, 4, '2')
    updated.turns[0].parts = [{ kind: 'text', text: 'updated' }]
    state = reconcileConversation(state, updated, false)
    state = reconcileConversation(state, page(0, 3, null), true)
    expect(state.turns.find((turn) => turn.id === '2')?.parts).toEqual([
      { kind: 'text', text: 'updated' }
    ])
    expect(new Set(state.turns.map((turn) => turn.id)).size).toBe(
      state.turns.length
    )
  })

  test('session replacement drops turns and all stale metadata/frontier', () => {
    const old = reconcileConversation(
      emptyConversation(),
      page(0, 50, 'cursor'),
      false
    )
    const replacement = page(90, 91, null, 'replacement')
    replacement.metadata.model = null
    const state = reconcileConversation(old, replacement, false)
    expect(state.turns.map((turn) => turn.id)).toEqual(['90'])
    expect(state.metadata.model).toBeNull()
    expect(state.before).toBeNull()
  })
})
