import { describe, expect, it } from 'bun:test'
import {
  calculateNextStreamRetry,
  closeTerminalSocketSafely,
  INITIAL_STREAM_RETRY_DELAY_MS,
  MAX_STREAM_RETRIES,
  MAX_STREAM_RETRY_DELAY_MS
} from '../use-terminal-stream.ts'

describe('calculateNextStreamRetry', () => {
  it('advances retry count and calculates capped exponential delay', () => {
    const first = calculateNextStreamRetry(0, INITIAL_STREAM_RETRY_DELAY_MS)
    expect(first.shouldRetry).toBe(true)
    expect(first.nextRetryCount).toBe(1)
    expect(first.nextDelayMs).toBe(750)

    const second = calculateNextStreamRetry(first.nextRetryCount, first.nextDelayMs)
    expect(second.shouldRetry).toBe(true)
    expect(second.nextRetryCount).toBe(2)
    expect(second.nextDelayMs).toBe(1125)

    // Delay capped at MAX_STREAM_RETRY_DELAY_MS (5000)
    const capped = calculateNextStreamRetry(4, 4000)
    expect(capped.shouldRetry).toBe(true)
    expect(capped.nextRetryCount).toBe(5)
    expect(capped.nextDelayMs).toBe(MAX_STREAM_RETRY_DELAY_MS)
  })

  it('stops retrying and signals exhaustion after max retries', () => {
    const exhausted = calculateNextStreamRetry(MAX_STREAM_RETRIES, 5000)
    expect(exhausted.shouldRetry).toBe(false)
    expect(exhausted.nextRetryCount).toBe(MAX_STREAM_RETRIES)
    expect(exhausted.nextDelayMs).toBe(5000)

    const beyond = calculateNextStreamRetry(MAX_STREAM_RETRIES + 1, 5000)
    expect(beyond.shouldRetry).toBe(false)
  })

  it('allows resetting retry count cleanly back to zero', () => {
    const resetResult = calculateNextStreamRetry(0, INITIAL_STREAM_RETRY_DELAY_MS)
    expect(resetResult.shouldRetry).toBe(true)
    expect(resetResult.nextRetryCount).toBe(1)
    expect(resetResult.nextDelayMs).toBe(750)
  })
})

const createSocket = (readyState: number) => {
  let openListener: (() => void) | null = null
  let closeCalls = 0
  const socket = {
    readyState,
    onopen: () => {},
    onmessage: () => {},
    onerror: () => {},
    onclose: () => {},
    close: () => { closeCalls++ },
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'open') openListener = listener
    }
  } as unknown as WebSocket

  return {
    socket,
    open: () => openListener?.(),
    closeCalls: () => closeCalls
  }
}

describe('closeTerminalSocketSafely', () => {
  it('waits for a connecting socket to open before closing it', () => {
    const target = createSocket(WebSocket.CONNECTING)
    closeTerminalSocketSafely(target.socket)
    expect(target.closeCalls()).toBe(0)
    target.open()
    expect(target.closeCalls()).toBe(1)
  })

  it('closes an open socket immediately', () => {
    const target = createSocket(WebSocket.OPEN)
    closeTerminalSocketSafely(target.socket)
    expect(target.closeCalls()).toBe(1)
  })

  it('does not close an already closing or closed socket again', () => {
    for (const state of [WebSocket.CLOSING, WebSocket.CLOSED]) {
      const target = createSocket(state)
      closeTerminalSocketSafely(target.socket)
      expect(target.closeCalls()).toBe(0)
    }
  })
})
