import { useEffect, useRef, useState } from 'react'
import type { ITerminalClosed, ITerminalFrame } from '@/types/herdr.ts'

export type ITerminalConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'

export interface IUseTerminalStreamOptions {
  paneId: string | null
  cols?: number
  rows?: number
  onData: (bytes: Uint8Array) => void
}

export interface IUseTerminalStreamReturn {
  connectionState: ITerminalConnectionState
  lastError: string | null
  reconnect: () => void
}

export const closeTerminalSocketSafely = (socket: WebSocket): void => {
  socket.onopen = null
  socket.onmessage = null
  socket.onerror = null
  socket.onclose = null

  if (socket.readyState === WebSocket.CONNECTING) {
    socket.addEventListener('open', () => socket.close(), { once: true })
    socket.addEventListener('error', () => {}, { once: true })
    return
  }

  if (socket.readyState === WebSocket.OPEN) {
    socket.close()
  }
}

export const MAX_STREAM_RETRIES = 6
export const INITIAL_STREAM_RETRY_DELAY_MS = 500
export const MAX_STREAM_RETRY_DELAY_MS = 5000

export interface IStreamRetryDecision {
  shouldRetry: boolean
  nextRetryCount: number
  nextDelayMs: number
}

export const calculateNextStreamRetry = (
  currentRetryCount: number,
  currentDelayMs: number,
  maxRetries = MAX_STREAM_RETRIES
): IStreamRetryDecision => {
  if (currentRetryCount >= maxRetries) {
    return {
      shouldRetry: false,
      nextRetryCount: currentRetryCount,
      nextDelayMs: currentDelayMs
    }
  }
  const nextDelayMs = Math.min(Math.round(currentDelayMs * 1.5), MAX_STREAM_RETRY_DELAY_MS)
  return {
    shouldRetry: true,
    nextRetryCount: currentRetryCount + 1,
    nextDelayMs
  }
}

export const useTerminalStream = ({
  paneId,
  cols = 80,
  rows = 24,
  onData
}: IUseTerminalStreamOptions): IUseTerminalStreamReturn => {
  const [connectionState, setConnectionState] = useState<ITerminalConnectionState>('disconnected')
  const [lastError, setLastError] = useState<string | null>(null)

  const socketRef = useRef<WebSocket | null>(null)
  const retryCountRef = useRef<number>(0)
  const retryDelayRef = useRef<number>(INITIAL_STREAM_RETRY_DELAY_MS)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isManuallyClosedRef = useRef<boolean>(false)
  const connectRef = useRef<(() => void) | null>(null)
  const onDataRef = useRef(onData)
  onDataRef.current = onData

  useEffect(() => {
    if (!paneId) {
      setConnectionState('disconnected')
      setLastError(null)
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (socketRef.current) {
        isManuallyClosedRef.current = true
        const s = socketRef.current
        socketRef.current = null
        closeTerminalSocketSafely(s)
      }
      connectRef.current = null
      return
    }

    isManuallyClosedRef.current = false
    retryCountRef.current = 0
    retryDelayRef.current = INITIAL_STREAM_RETRY_DELAY_MS

    const connect = () => {
      if (isManuallyClosedRef.current) return

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      if (socketRef.current) {
        const s = socketRef.current
        socketRef.current = null
        closeTerminalSocketSafely(s)
      }

      setConnectionState((prev) => (prev === 'connected' ? 'reconnecting' : 'connecting'))

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/terminal?pane=${encodeURIComponent(paneId)}&cols=${cols}&rows=${rows}`

      const ws = new WebSocket(wsUrl)
      socketRef.current = ws

      ws.onopen = () => {
        if (ws !== socketRef.current) return
        setConnectionState('connected')
        setLastError(null)
        retryCountRef.current = 0
        retryDelayRef.current = INITIAL_STREAM_RETRY_DELAY_MS
      }

      ws.onmessage = (event) => {
        if (ws !== socketRef.current) return
        try {
          const raw = JSON.parse(event.data)
          if (raw.type === 'terminal.frame' && typeof raw.bytes === 'string' && raw.bytes.length > 0) {
            const frame = raw as ITerminalFrame
            const binaryStr = window.atob(frame.bytes)
            const bytes = new Uint8Array(binaryStr.length)
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i)
            }
            onDataRef.current(bytes)
          } else if (raw.type === 'terminal.closed') {
            const closed = raw as ITerminalClosed
            if (closed.reason) {
              setLastError(closed.reason)
            }
          }
        } catch (err) {
          console.warn('[useTerminalStream] Failed to parse frame:', err)
        }
      }

      ws.onerror = () => {
        if (ws !== socketRef.current) return
        setConnectionState('error')
        setLastError('Terminal stream socket error')
      }

      ws.onclose = () => {
        if (ws !== socketRef.current) return
        if (isManuallyClosedRef.current) {
          setConnectionState('disconnected')
          return
        }

        const decision = calculateNextStreamRetry(retryCountRef.current, retryDelayRef.current)
        if (!decision.shouldRetry) {
          setConnectionState('error')
          setLastError('Terminal stream disconnected after repeated retry attempts. Tap retry to reconnect.')
          return
        }

        retryCountRef.current = decision.nextRetryCount
        retryDelayRef.current = decision.nextDelayMs
        setConnectionState('reconnecting')

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null
          connect()
        }, decision.nextDelayMs)
      }
    }

    connectRef.current = connect
    connect()

    return () => {
      isManuallyClosedRef.current = true
      connectRef.current = null
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (socketRef.current) {
        const s = socketRef.current
        socketRef.current = null
        closeTerminalSocketSafely(s)
      }
    }
  }, [paneId, cols, rows])

  const reconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    isManuallyClosedRef.current = false
    retryCountRef.current = 0
    retryDelayRef.current = INITIAL_STREAM_RETRY_DELAY_MS
    setLastError(null)

    if (socketRef.current) {
      const s = socketRef.current
      socketRef.current = null
      closeTerminalSocketSafely(s)
    }

    connectRef.current?.()
  }

  return {
    connectionState,
    lastError,
    reconnect
  }
}
