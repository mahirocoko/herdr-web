import { useCallback, useEffect, useRef, useState } from 'react'
import { closeTerminalSocketSafely } from './use-terminal-stream.ts'
import { clampControlDimensions } from '@/utils/terminal-geometry.ts'
import type { ITerminalClosed, ITerminalFrame } from '@/types/herdr.ts'

export type ITerminalControlState = 'idle' | 'connecting' | 'ready' | 'error' | 'released'

export interface IControlReadyEnvelope {
  type: 'control.ready'
  pane: string
  leaseDurationMs: number
}

export interface IControlErrorEnvelope {
  type: 'control.error'
  error: string
}

export interface IUseTerminalControlOptions {
  paneId: string | null
  enabled: boolean
  cols?: number
  rows?: number
  onData: (bytes: Uint8Array) => void
  onReady?: () => void
  onClosed?: (reason?: string) => void
  onError?: (error: string) => void
}

export interface IUseTerminalControlReturn {
  state: ITerminalControlState
  lastError: string | null
  expiresAt: number | null
  remainingSeconds: number
  sendInput: (text: string) => boolean
  sendResize: (cols: number, rows: number) => boolean
  release: () => void
}

export const formatRemainingTime = (totalSeconds: number): string => {
  if (totalSeconds <= 0) return '00:00'
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const mStr = String(minutes).padStart(2, '0')
  const sStr = String(seconds).padStart(2, '0')
  return `${mStr}:${sStr}`
}

export const getTerminalControlConnectionKey = (
  paneId: string | null,
  enabled: boolean
): string | null => {
  if (!enabled || !paneId) return null
  return `${paneId}:control`
}

export const useTerminalControl = ({
  paneId,
  enabled,
  cols = 80,
  rows = 24,
  onData,
  onReady,
  onClosed,
  onError
}: IUseTerminalControlOptions): IUseTerminalControlReturn => {
  const [state, setState] = useState<ITerminalControlState>('idle')
  const [lastError, setLastError] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0)

  const stateRef = useRef<ITerminalControlState>(state)
  stateRef.current = state

  const colsRef = useRef(cols)
  colsRef.current = cols
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const socketRef = useRef<WebSocket | null>(null)
  const onDataRef = useRef(onData)
  onDataRef.current = onData
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onClosedRef = useRef(onClosed)
  onClosedRef.current = onClosed
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const hasClosedFiredRef = useRef(false)
  const triggerClosed = useCallback((reason: string) => {
    if (!hasClosedFiredRef.current) {
      hasClosedFiredRef.current = true
      onClosedRef.current?.(reason)
    }
  }, [])

  const releaseSocket = useCallback(() => {
    if (socketRef.current) {
      const s = socketRef.current
      socketRef.current = null
      if (s.readyState === WebSocket.OPEN) {
        try {
          s.send(JSON.stringify({ type: 'terminal.release' }))
        } catch {}
      }
      closeTerminalSocketSafely(s)
    }
  }, [])

  // Socket connection lifecycle: keyed ONLY by [paneId, enabled]
  useEffect(() => {
    hasClosedFiredRef.current = false

    if (!enabled || !paneId) {
      setState('idle')
      setLastError(null)
      setExpiresAt(null)
      setRemainingSeconds(0)
      releaseSocket()
      return
    }

    setState('connecting')
    setLastError(null)
    setExpiresAt(null)
    setRemainingSeconds(0)

    const normalized = clampControlDimensions(colsRef.current, rowsRef.current)
    const initialCols = normalized.cols
    const initialRows = normalized.rows
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/terminal/control?pane=${encodeURIComponent(paneId)}&cols=${initialCols}&rows=${initialRows}`

    const ws = new WebSocket(wsUrl)
    socketRef.current = ws

    ws.onmessage = (event) => {
      if (ws !== socketRef.current) return
      try {
        const raw = JSON.parse(event.data)
        if (!raw || typeof raw !== 'object') {
          throw new Error('Malformed payload')
        }

        if (raw.type === 'control.ready') {
          const readyMsg = raw as IControlReadyEnvelope
          if (
            readyMsg.pane !== paneId ||
            typeof readyMsg.leaseDurationMs !== 'number' ||
            !Number.isFinite(readyMsg.leaseDurationMs) ||
            !Number.isInteger(readyMsg.leaseDurationMs) ||
            readyMsg.leaseDurationMs <= 0 ||
            readyMsg.leaseDurationMs > 600000
          ) {
            setState('error')
            setLastError('Invalid control.ready parameters received from server')
            onErrorRef.current?.('Invalid control.ready parameters')
            releaseSocket()
            return
          }

          const durationMs = readyMsg.leaseDurationMs
          const expiry = Date.now() + durationMs
          setExpiresAt(expiry)
          setRemainingSeconds(Math.max(0, Math.floor(durationMs / 1000)))
          setState('ready')
          setLastError(null)
          onReadyRef.current?.()
          return
        }

        if (raw.type === 'control.error') {
          const errorMsg = raw as IControlErrorEnvelope
          setState('error')
          setLastError(errorMsg.error || 'Control error')
          onErrorRef.current?.(errorMsg.error || 'Control error')
          releaseSocket()
          return
        }

        if (raw.type === 'terminal.frame') {
          const frame = raw as ITerminalFrame
          if (
            typeof frame.bytes !== 'string' ||
            frame.bytes.length === 0 ||
            frame.bytes.length % 4 !== 0 ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(frame.bytes)
          ) {
            setState('error')
            setLastError('Malformed terminal frame received from server')
            onErrorRef.current?.('Malformed terminal frame')
            releaseSocket()
            return
          }

          try {
            const binaryStr = window.atob(frame.bytes)
            const bytes = new Uint8Array(binaryStr.length)
            for (let i = 0; i < binaryStr.length; i++) {
              bytes[i] = binaryStr.charCodeAt(i)
            }
            onDataRef.current(bytes)
          } catch {
            setState('error')
            setLastError('Failed to decode terminal frame')
            onErrorRef.current?.('Failed to decode terminal frame')
            releaseSocket()
            return
          }
          return
        }

        if (raw.type === 'terminal.closed') {
          const closed = raw as ITerminalClosed
          setState('released')
          if (closed.reason) {
            setLastError(closed.reason)
          }
          triggerClosed(closed.reason || 'closed')
          releaseSocket()
          return
        }

        throw new Error(`Unsupported envelope: ${String(raw.type)}`)
      } catch (err) {
        setState('error')
        const msg = err instanceof Error ? err.message : 'Malformed control message'
        setLastError(msg)
        onErrorRef.current?.(msg)
        releaseSocket()
      }
    }

    ws.onerror = () => {
      if (ws !== socketRef.current) return
      setState('error')
      setLastError('Control socket connection failed')
      onErrorRef.current?.('Control socket connection failed')
    }

    ws.onclose = () => {
      if (ws !== socketRef.current) return
      socketRef.current = null
      setState((prev) => {
        if (prev !== 'error' && prev !== 'released') {
          triggerClosed('Control socket closed')
          return 'released'
        }
        return prev
      })
    }

    return () => {
      releaseSocket()
    }
  }, [paneId, enabled, releaseSocket, triggerClosed])

  const sendResize = useCallback((c: number, r: number): boolean => {
    if (stateRef.current !== 'ready' || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return false
    }
    const normalized = clampControlDimensions(c, r)
    try {
      socketRef.current.send(JSON.stringify({ type: 'terminal.resize', cols: normalized.cols, rows: normalized.rows }))
      return true
    } catch {
      return false
    }
  }, [])

  // Propagate dimension changes via terminal.resize on existing socket without reconnecting
  useEffect(() => {
    if (state === 'ready') {
      sendResize(cols, rows)
    }
  }, [cols, rows, state, sendResize])

  // pagehide and visibilitychange (when document becomes hidden) cleanup while connecting or ready
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    if (state !== 'connecting' && state !== 'ready') return

    const handlePageHide = () => {
      releaseSocket()
      setState('released')
      triggerClosed('page_hidden')
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        handlePageHide()
      }
    }

    window.addEventListener('pagehide', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [state, releaseSocket, triggerClosed])

  // Lease countdown timer
  useEffect(() => {
    if (state !== 'ready' || !expiresAt) return

    const updateRemaining = () => {
      const now = Date.now()
      const diffMs = expiresAt - now
      const seconds = Math.max(0, Math.floor(diffMs / 1000))
      setRemainingSeconds(seconds)
      if (seconds <= 0) {
        setState('released')
        setLastError('Control lease expired (10 minute limit)')
        triggerClosed('Control lease expired')
        releaseSocket()
      }
    }

    updateRemaining()
    const timer = setInterval(updateRemaining, 1000)

    return () => clearInterval(timer)
  }, [state, expiresAt, releaseSocket, triggerClosed])

  const sendInput = useCallback((text: string): boolean => {
    if (stateRef.current !== 'ready' || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      return false
    }
    if (!text || text.length === 0) {
      return false
    }
    try {
      socketRef.current.send(JSON.stringify({ type: 'terminal.input', text }))
      return true
    } catch {
      return false
    }
  }, [])

  const release = useCallback((): void => {
    releaseSocket()
    setState('released')
    triggerClosed('Released by user')
  }, [releaseSocket, triggerClosed])

  return {
    state,
    lastError,
    expiresAt,
    remainingSeconds,
    sendInput,
    sendResize,
    release
  }
}
