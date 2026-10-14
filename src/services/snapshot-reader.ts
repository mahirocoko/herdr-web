import { fetchSnapshot } from './api-client.ts'
import type { ISnapshotResult } from '../types/herdr.ts'
import { parseServerEventMessage } from '../utils/event-stream.ts'
import { bridgeStatusIsHealthy } from '../utils/bridge-status.ts'

export const EVENT_CONNECT_TIMEOUT_MS = 10000
export const EVENT_HEARTBEAT_INTERVAL_MS = 15000

/** Browser read owner only: recovery never acquires input or replays mutations. */
export const createSnapshotReader = ({
  onSnapshot,
  onError,
  onReconnecting,
  pollIntervalMs = 2000,
  browser = window,
  page = document,
  read = fetchSnapshot,
  openSocket = (url: string) => new WebSocket(url),
  timers = { setTimeout, clearTimeout, setInterval, clearInterval }
}: {
  onSnapshot: (snapshot: ISnapshotResult) => void
  onError: (error: unknown) => void
  onReconnecting: () => void
  pollIntervalMs?: number
  browser?: Window
  page?: Document
  read?: typeof fetchSnapshot
  openSocket?: (url: string) => WebSocket
  timers?: Pick<
    typeof globalThis,
    'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval'
  >
}) => {
  const { setTimeout, clearTimeout, setInterval, clearInterval } = timers
  let stopped = false
  let suspended = page.visibilityState === 'hidden'
  let healthy = false
  // Read readiness and bridge health are independent: HTTP can heal Chat while
  // the event bridge reconnects; bridge status alone cannot heal a failed read.
  let readReady = false
  let socket: WebSocket | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let deadline: ReturnType<typeof setTimeout> | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let backoff = 1000
  let revision = 0
  let request: {
    controller: AbortController
    promise: Promise<boolean>
  } | null = null

  const invalidateRead = () => {
    ++revision
    request?.controller.abort()
    request = null
  }
  const refresh = (): Promise<boolean> => {
    if (stopped || suspended) return Promise.resolve(false)
    if (request) return request.promise
    const controller = new AbortController()
    const currentRevision = revision
    const ticket = { controller, promise: Promise.resolve(false) }
    request = ticket
    ticket.promise = (async () => {
      try {
        const snapshot = await read(controller.signal)
        if (stopped || request !== ticket || revision !== currentRevision)
          return false
        readReady = true
        onSnapshot(snapshot)
        return true
      } catch (error) {
        if (!stopped && request === ticket && revision === currentRevision) {
          readReady = false
          onError(error)
        }
        return false
      } finally {
        if (request === ticket) request = null
      }
    })()
    return ticket.promise
  }
  const retire = () => {
    healthy = false
    readReady = false
    if (retry) clearTimeout(retry)
    if (deadline) clearTimeout(deadline)
    if (heartbeat) clearInterval(heartbeat)
    retry = null
    deadline = null
    heartbeat = null
    const old = socket
    socket = null
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null
      // Cancel CONNECTING too; waiting for open can strand the old connection.
      old.close()
    }
  }
  const failed = () => {
    retire()
    if (stopped || suspended) return
    onReconnecting()
    const delay = backoff
    backoff = Math.min(backoff * 1.5, 8000)
    retry = setTimeout(connect, delay)
    void refresh()
  }
  const connect = () => {
    if (stopped || suspended || socket) return
    if (retry) clearTimeout(retry)
    retry = null
    try {
      const protocol = browser.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = openSocket(`${protocol}//${browser.location.host}/api/events`)
      socket = ws
      const current = () => !stopped && socket === ws
      const armDeadline = () => {
        if (deadline) clearTimeout(deadline)
        deadline = setTimeout(() => {
          if (current()) failed()
        }, EVENT_CONNECT_TIMEOUT_MS)
      }
      armDeadline()
      ws.onopen = () => {
        if (!current()) return
        // Opening is not bridge health, nor proof of the application's response.
        heartbeat = setInterval(() => {
          if (!current() || deadline) return
          armDeadline()
          try {
            ws.send('{"type":"events.ping"}')
          } catch {
            failed()
          }
        }, EVENT_HEARTBEAT_INTERVAL_MS)
      }
      ws.onmessage = (event) => {
        if (!current()) return
        const message = parseServerEventMessage(event.data)
        if (!message) return
        if (deadline) clearTimeout(deadline)
        deadline = null
        backoff = 1000
        if (message.type === 'snapshot') {
          invalidateRead()
          readReady = true
          onSnapshot(message.data)
        } else {
          healthy = bridgeStatusIsHealthy(message.status)
          if (!readReady) {
            if (!healthy) onReconnecting()
            void refresh()
          }
        }
      }
      ws.onclose = ws.onerror = () => {
        if (current()) failed()
      }
    } catch {
      failed()
    }
  }
  const suspend = () => {
    if (stopped || suspended) return
    suspended = true
    retire()
    invalidateRead()
  }
  const recover = () => {
    if (stopped || page.visibilityState === 'hidden') return
    if (!suspended) {
      // Overlapping lifecycle notifications must not retire a new attempt or
      // demote successful HTTP truth. Online may accelerate an existing retry.
      if (!socket) {
        connect()
        void refresh()
      }
      return
    }
    suspended = false
    backoff = 1000
    onReconnecting()
    connect()
    void refresh()
  }
  const visibility = () => {
    if (page.visibilityState === 'hidden') suspend()
    else recover()
  }
  page.addEventListener('visibilitychange', visibility)
  browser.addEventListener('pagehide', suspend)
  browser.addEventListener('pageshow', recover)
  browser.addEventListener('online', recover)
  browser.addEventListener('offline', suspend)
  const poll = setInterval(() => {
    if ((!healthy || !readReady) && !suspended) void refresh()
  }, pollIntervalMs)
  connect()
  void refresh()
  return {
    refresh,
    stop: () => {
      stopped = true
      retire()
      invalidateRead()
      clearInterval(poll)
      page.removeEventListener('visibilitychange', visibility)
      browser.removeEventListener('pagehide', suspend)
      browser.removeEventListener('pageshow', recover)
      browser.removeEventListener('online', recover)
      browser.removeEventListener('offline', suspend)
    }
  }
}
