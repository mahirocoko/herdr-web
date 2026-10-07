import { useCallback, useEffect, useRef, useState } from 'react'
import type { ITerminalClosed, ITerminalFrame } from '@/types/herdr.ts'

export type ITerminalConnectionState =
  'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'

export interface IUseTerminalStreamOptions {
  paneId: string | null
  terminalId?: string | null
  cols?: number
  rows?: number
  paused?: boolean
  onData: (bytes: Uint8Array) => void
  onFrame?: (frame: ITerminalFrame, bytes: Uint8Array) => void | Promise<void>
}

export interface ITerminalScrollState {
  offset: number
  maxOffset: number
  viewportRows: number
}

export interface IUseTerminalStreamReturn {
  connectionState: ITerminalConnectionState
  lastError: string | null
  reconnect: () => void
  scrollState: ITerminalScrollState | null
  sendScroll: (params: {
    deltaRows?: number
    to?: 'latest'
    reset?: boolean
  }) => void
}

export const decodeTerminalBytes = (b64: string): Uint8Array | null => {
  if (typeof b64 !== 'string') return null
  if (b64.length === 0) return new Uint8Array(0)
  try {
    const atobFn =
      typeof globalThis.atob === 'function'
        ? globalThis.atob
        : typeof window !== 'undefined' && typeof window.atob === 'function'
          ? window.atob
          : null
    if (!atobFn) return null
    const binaryStr = atobFn(b64)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }
    return bytes
  } catch {
    return null
  }
}

export const validateTerminalFrame = (
  raw: unknown
): { valid: boolean; frame?: ITerminalFrame; error?: string } => {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Expected object payload' }
  }
  const candidate = raw as Record<string, unknown>
  if (candidate.type !== 'terminal.frame') {
    return { valid: false, error: 'Not a terminal.frame' }
  }

  const { width, height, seq, full, bytes, encoding } = candidate
  if (
    typeof bytes !== 'string' ||
    encoding !== 'ansi' ||
    typeof full !== 'boolean' ||
    typeof seq !== 'number' ||
    !Number.isSafeInteger(seq) ||
    seq < 0 ||
    typeof width !== 'number' ||
    !Number.isInteger(width) ||
    width < 0 ||
    width > 500 ||
    typeof height !== 'number' ||
    !Number.isInteger(height) ||
    height < 0 ||
    height > 200 ||
    (bytes.length > 0 && (width === 0 || height === 0))
  ) {
    return { valid: false, error: 'Invalid native frame metadata' }
  }

  return {
    valid: true,
    frame: {
      type: 'terminal.frame',
      seq,
      encoding: 'ansi',
      width,
      height,
      full,
      bytes
    }
  }
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

export const resolveFitAdmissionClose = (code: number, reason: string) => {
  if (code !== 4409) return null
  if (reason === 'FIT_RELEASING') return { stopRetry: false, error: null }
  const error =
    reason === 'FIT_BUSY'
      ? 'Another viewer is fitting this terminal. Pause or close that viewer, then tap Retry.'
      : reason === 'FIT_BLOCKED_BY_CONTROL'
        ? 'Terminal input control is active. Release control, then tap Retry.'
        : 'Terminal fit admission was rejected. Tap Retry after the terminal is available.'
  return { stopRetry: true, error }
}

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
  const nextDelayMs = Math.min(
    Math.round(currentDelayMs * 1.5),
    MAX_STREAM_RETRY_DELAY_MS
  )
  return {
    shouldRetry: true,
    nextRetryCount: currentRetryCount + 1,
    nextDelayMs
  }
}

export const useTerminalStream = ({
  paneId,
  terminalId,
  cols = 80,
  rows = 24,
  paused = false,
  onData,
  onFrame
}: IUseTerminalStreamOptions): IUseTerminalStreamReturn => {
  const [connectionState, setConnectionState] =
    useState<ITerminalConnectionState>('disconnected')
  const [lastError, setLastError] = useState<string | null>(null)
  const [scrollState, setScrollState] = useState<ITerminalScrollState | null>(
    null
  )

  const [isBackgroundHidden, setIsBackgroundHidden] = useState<boolean>(() => {
    if (typeof document !== 'undefined') {
      return document.visibilityState === 'hidden'
    }
    return false
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const handleVisibilityChange = () => {
      setIsBackgroundHidden(document.visibilityState === 'hidden')
    }
    const handlePageHide = () => {
      setIsBackgroundHidden(true)
    }
    const handlePageShow = () => {
      setIsBackgroundHidden(document.visibilityState === 'hidden')
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [])

  const socketRef = useRef<WebSocket | null>(null)
  const retryCountRef = useRef<number>(0)
  const retryDelayRef = useRef<number>(INITIAL_STREAM_RETRY_DELAY_MS)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isManuallyClosedRef = useRef<boolean>(false)
  const admissionBlockedRef = useRef(false)
  const connectRef = useRef<(() => void) | null>(null)
  const onDataRef = useRef(onData)
  onDataRef.current = onData
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  const paneGenerationRef = useRef<number>(0)
  const latestColsRef = useRef<number>(cols)
  const latestRowsRef = useRef<number>(rows)
  latestColsRef.current = cols
  latestRowsRef.current = rows

  const lastSentColsRef = useRef<number>(cols)
  const lastSentRowsRef = useRef<number>(rows)
  const resizeDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  // Debounced, deduped resize on the SAME open WebSocket
  useEffect(() => {
    const ws = socketRef.current
    if (
      !ws ||
      ws.readyState !== WebSocket.OPEN ||
      (lastSentColsRef.current === cols && lastSentRowsRef.current === rows)
    ) {
      return
    }

    if (resizeDebounceTimerRef.current) {
      clearTimeout(resizeDebounceTimerRef.current)
    }

    const currentSocket = ws
    const currentGeneration = paneGenerationRef.current

    resizeDebounceTimerRef.current = setTimeout(() => {
      resizeDebounceTimerRef.current = null
      if (
        socketRef.current === currentSocket &&
        currentSocket.readyState === WebSocket.OPEN &&
        paneGenerationRef.current === currentGeneration &&
        (lastSentColsRef.current !== cols || lastSentRowsRef.current !== rows)
      ) {
        lastSentColsRef.current = cols
        lastSentRowsRef.current = rows
        try {
          currentSocket.send(
            JSON.stringify({
              type: 'terminal.resize',
              cols,
              rows
            })
          )
        } catch {}
      }
    }, 60)

    return () => {
      if (resizeDebounceTimerRef.current) {
        clearTimeout(resizeDebounceTimerRef.current)
        resizeDebounceTimerRef.current = null
      }
    }
  }, [cols, rows])

  useEffect(() => {
    paneGenerationRef.current += 1
    const currentGeneration = paneGenerationRef.current

    if (!paneId || !terminalId || paused || isBackgroundHidden) {
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
      if (paneGenerationRef.current !== currentGeneration) return
      admissionBlockedRef.current = false

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }

      if (socketRef.current) {
        const s = socketRef.current
        socketRef.current = null
        closeTerminalSocketSafely(s)
      }

      // Do not prematurely transition to connected; keep connecting/reconnecting until output arrives
      setConnectionState((prev) =>
        prev === 'connected'
          ? 'reconnecting'
          : prev === 'reconnecting'
            ? 'reconnecting'
            : 'connecting'
      )

      const initialCols = cols
      const initialRows = rows
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/api/terminal?pane=${encodeURIComponent(paneId)}&terminalId=${encodeURIComponent(terminalId)}&cols=${initialCols}&rows=${initialRows}`

      const ws = new WebSocket(wsUrl)
      socketRef.current = ws

      ws.onopen = () => {
        if (
          ws !== socketRef.current ||
          paneGenerationRef.current !== currentGeneration
        ) {
          return
        }

        const targetCols = latestColsRef.current
        const targetRows = latestRowsRef.current

        // If dimensions were measured/updated while WebSocket was CONNECTING,
        // send latest measured dimensions immediately on open!
        if (targetCols !== initialCols || targetRows !== initialRows) {
          lastSentColsRef.current = targetCols
          lastSentRowsRef.current = targetRows
          try {
            ws.send(
              JSON.stringify({
                type: 'terminal.resize',
                cols: targetCols,
                rows: targetRows
              })
            )
          } catch {}
        } else {
          lastSentColsRef.current = initialCols
          lastSentRowsRef.current = initialRows
        }
      }

      ws.onmessage = (event) => {
        if (
          ws !== socketRef.current ||
          paneGenerationRef.current !== currentGeneration
        )
          return
        try {
          const raw = JSON.parse(event.data)
          if (raw.type === 'terminal.frame') {
            const frameValidation = validateTerminalFrame(raw)
            if (!frameValidation.valid || !frameValidation.frame) {
              console.warn(
                '[useTerminalStream] Invalid terminal frame:',
                frameValidation.error
              )
              return
            }

            const decodedBytes = decodeTerminalBytes(
              frameValidation.frame.bytes
            )
            if (decodedBytes === null) {
              console.warn(
                '[useTerminalStream] Failed to decode base64 terminal bytes'
              )
              return
            }

            const applied = onFrameRef.current
              ? onFrameRef.current(frameValidation.frame, decodedBytes)
              : decodedBytes.length > 0
                ? onDataRef.current(decodedBytes)
                : undefined
            // Geometry/status alone is not live output. Wait for the consumer's
            // write acknowledgement, and don't let an old socket mark a new pane Live.
            if (decodedBytes.length > 0) {
              void Promise.resolve(applied)
                .then(() => {
                  if (
                    ws !== socketRef.current ||
                    paneGenerationRef.current !== currentGeneration
                  )
                    return
                  setConnectionState('connected')
                  setLastError(null)
                  retryCountRef.current = 0
                  retryDelayRef.current = INITIAL_STREAM_RETRY_DELAY_MS
                })
                .catch(() => {
                  if (
                    ws !== socketRef.current ||
                    paneGenerationRef.current !== currentGeneration
                  )
                    return
                  setConnectionState('error')
                  setLastError('Terminal output could not be rendered')
                })
            }
          } else if (raw.type === 'terminal.scroll-state') {
            const offset =
              typeof raw.offset === 'number'
                ? raw.offset
                : typeof raw.offset_from_bottom === 'number'
                  ? raw.offset_from_bottom
                  : 0
            const maxOffset =
              typeof raw.maxOffset === 'number'
                ? raw.maxOffset
                : typeof raw.max_offset_from_bottom === 'number'
                  ? raw.max_offset_from_bottom
                  : 0
            const viewportRows =
              typeof raw.viewportRows === 'number'
                ? raw.viewportRows
                : typeof raw.viewport_rows === 'number'
                  ? raw.viewport_rows
                  : 24
            setScrollState({ offset, maxOffset, viewportRows })
          } else if (raw.type === 'terminal.closed') {
            const closed = raw as ITerminalClosed
            if (closed.reason) {
              setLastError(closed.reason)
              if (
                closed.reason.includes('busy') ||
                closed.reason.includes('BUSY') ||
                closed.reason.includes('blocked')
              ) {
                admissionBlockedRef.current = true
                setConnectionState('disconnected')
              }
            }
          }
        } catch (err) {
          console.warn('[useTerminalStream] Failed to parse frame:', err)
        }
      }

      ws.onerror = () => {
        if (
          ws !== socketRef.current ||
          paneGenerationRef.current !== currentGeneration
        )
          return
        setConnectionState('error')
        setLastError('Terminal stream socket error')
      }

      ws.onclose = (event) => {
        if (ws !== socketRef.current) return
        if (isManuallyClosedRef.current) {
          setConnectionState('disconnected')
          return
        }

        const admission = resolveFitAdmissionClose(event.code, event.reason)
        if (admission?.stopRetry) {
          admissionBlockedRef.current = true
          setConnectionState('error')
          setLastError(admission.error)
          return
        }

        if (admissionBlockedRef.current) {
          setConnectionState('disconnected')
          return
        }

        const decision = calculateNextStreamRetry(
          retryCountRef.current,
          retryDelayRef.current
        )
        if (!decision.shouldRetry) {
          setConnectionState('error')
          setLastError(
            'Terminal stream disconnected after repeated retry attempts. Tap retry to reconnect.'
          )
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
  }, [paneId, terminalId, paused, isBackgroundHidden])

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

  const sendScroll = useCallback(
    (params: { deltaRows?: number; to?: 'latest'; reset?: boolean }) => {
      const ws = socketRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(JSON.stringify({ type: 'terminal.scroll', ...params }))
      } catch {}
    },
    []
  )

  return {
    connectionState,
    lastError,
    reconnect,
    scrollState,
    sendScroll
  }
}
