import { useEffect, useRef, useState, useCallback } from 'react'
import type { FC } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal as TerminalIcon, Square } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import { useTerminalStream } from '@/hooks/use-terminal-stream.ts'
import { formatRemainingTime, useTerminalControl } from '@/hooks/use-terminal-control.ts'
import {
  clampTerminalDimensions,
  debounce,
  haveDimensionsChanged,
  type ITerminalDimensions
} from '@/utils/terminal-geometry.ts'
import {
  resolveControlledPaneIdentity,
  resolveTerminalControlConnectionPane,
  type ITerminalControlOwnership
} from '@/utils/terminal-control-ownership.ts'

export type TerminalMode = 'observer' | 'control'

export interface ITerminalCanvasProps {
  paneId: string | null
  isAgentPane?: boolean
  cols?: number
  rows?: number
  onControlActiveChange?: (isActive: boolean) => void
  onControlOwnershipChange?: (ownership: ITerminalControlOwnership, paneId?: string) => void
}

const TerminalCanvas: FC<ITerminalCanvasProps> = ({
  paneId,
  isAgentPane = false,
  cols = 80,
  rows = 24,
  onControlActiveChange,
  onControlOwnershipChange
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  const onControlActiveChangeRef = useRef(onControlActiveChange)
  onControlActiveChangeRef.current = onControlActiveChange
  const onControlOwnershipChangeRef = useRef(onControlOwnershipChange)
  onControlOwnershipChangeRef.current = onControlOwnershipChange

  const controlledPaneIdRef = useRef<string | null>(null)

  const notifyOwnership = useCallback(
    (ownership: ITerminalControlOwnership, overridePaneId?: string) => {
      const targetPane = resolveControlledPaneIdentity(
        controlledPaneIdRef.current,
        paneId,
        overridePaneId
      )
      onControlOwnershipChangeRef.current?.(ownership, targetPane)
      onControlActiveChangeRef.current?.(ownership !== 'idle')
    },
    [paneId]
  )

  const [mode, setMode] = useState<TerminalMode>('observer')
  const [controlNotice, setControlNotice] = useState<string | null>(null)

  const [dimensions, setDimensions] = useState<ITerminalDimensions>({
    cols,
    rows
  })
  const dimensionsRef = useRef<ITerminalDimensions>(dimensions)
  dimensionsRef.current = dimensions

  const handleData = useCallback((bytes: Uint8Array) => {
    if (terminalRef.current) {
      terminalRef.current.write(bytes)
    }
  }, [])

  // Observer stream hook: active only in observer mode
  const {
    connectionState: streamConnectionState,
    lastError: streamLastError,
    reconnect: reconnectStream
  } = useTerminalStream({
    paneId: mode === 'observer' ? paneId : null,
    cols: dimensions.cols,
    rows: dimensions.rows,
    onData: handleData
  })

  const handleControlReady = useCallback(() => {
    notifyOwnership('active')
  }, [notifyOwnership])

  const handleControlClosed = useCallback((reason?: string) => {
    setMode('observer')
    notifyOwnership('releasing')
    if (reason && reason !== 'Released by user' && reason !== 'detached') {
      setControlNotice(`Control closed: ${reason}`)
    }
  }, [notifyOwnership])

  const handleControlError = useCallback((error: string) => {
    setMode('observer')
    notifyOwnership('releasing')
    setControlNotice(`Control error: ${error}`)
  }, [notifyOwnership])

  // Control mode hook: active only in control mode
  const {
    state: controlState,
    remainingSeconds,
    sendInput,
    release: releaseControl
  } = useTerminalControl({
    paneId: resolveTerminalControlConnectionPane(
      mode,
      isAgentPane,
      controlledPaneIdRef.current
    ),
    enabled: mode === 'control' && !isAgentPane,
    cols: dimensions.cols,
    rows: dimensions.rows,
    onData: handleData,
    onReady: handleControlReady,
    onClosed: handleControlClosed,
    onError: handleControlError
  })

  // Measure actual cols and rows from xterm FitAddon
  const updateMeasuredDimensions = useCallback(() => {
    if (!fitAddonRef.current || !terminalRef.current) return
    try {
      fitAddonRef.current.fit()
      const term = terminalRef.current
      if (term.cols > 0 && term.rows > 0) {
        const clamped = clampTerminalDimensions(term.cols, term.rows)
        if (haveDimensionsChanged(dimensionsRef.current, clamped)) {
          setDimensions(clamped)
        }
      }
    } catch {}
  }, [])

  // Initialize terminal once
  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, "Geist Mono", "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      theme: {
        background: '#1e1e1e',
        foreground: '#f1f5f9',
        cursor: '#38bdf8',
        selectionBackground: 'rgba(56, 189, 248, 0.25)',
        black: '#1e1e1e',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#38bdf8',
        white: '#f1f5f9',
        brightBlack: '#475569',
        brightRed: '#ef4444',
        brightGreen: '#22c55e',
        brightYellow: '#f59e0b',
        brightBlue: '#3b82f6',
        brightMagenta: '#a855f7',
        brightCyan: '#06b6d4',
        brightWhite: '#ffffff'
      }
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    if (term.textarea) {
      term.textarea.id = 'herdr-terminal-helper'
      term.textarea.name = 'terminal-helper'
    }

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Initial fit with slight delay for container layout calculation
    const timeout = setTimeout(() => {
      updateMeasuredDimensions()
    }, 50)

    // Debounced ResizeObserver to prevent thrashing
    const debouncedResize = debounce(() => {
      updateMeasuredDimensions()
    }, 150)

    const resizeObserver = new ResizeObserver(() => {
      debouncedResize()
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      clearTimeout(timeout)
      debouncedResize.cancel()
      resizeObserver.disconnect()
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [updateMeasuredDimensions])

  const modeRef = useRef(mode)
  modeRef.current = mode

  // Clear or reset terminal on pane change; reset mode to observer
  useEffect(() => {
    if (terminalRef.current && paneId) {
      terminalRef.current.reset()
      updateMeasuredDimensions()
    }
    if (modeRef.current === 'control') {
      notifyOwnership('releasing')
    }
    setMode('observer')
    setControlNotice(null)
  }, [paneId, updateMeasuredDimensions, notifyOwnership])

  // Automatically reset to observer if selected pane becomes an agent pane
  useEffect(() => {
    if (isAgentPane && mode === 'control') {
      setMode('observer')
      notifyOwnership('releasing')
      setControlNotice('Control mode unavailable for agent panes')
    }
  }, [isAgentPane, mode, notifyOwnership])

  // Reset control on unmount
  useEffect(() => {
    return () => {
      if (modeRef.current === 'control') {
        notifyOwnership('releasing')
      }
    }
  }, [notifyOwnership])

  // Wire xterm stdin strictly in control mode when ready
  useEffect(() => {
    const term = terminalRef.current
    if (!term) return

    if (mode === 'control' && controlState === 'ready') {
      term.options.disableStdin = false
      const disposable = term.onData((text) => {
        sendInput(text)
      })

      return () => {
        disposable.dispose()
        term.options.disableStdin = true
      }
    }

    term.options.disableStdin = true
  }, [mode, controlState, sendInput])

  const handleTakeControl = () => {
    if (isAgentPane || !paneId) return
    controlledPaneIdRef.current = paneId
    setControlNotice(null)
    setMode('control')
    notifyOwnership('engaging', paneId)
  }

  const handleReleaseControl = () => {
    releaseControl()
    setMode('observer')
    notifyOwnership('releasing')
  }

  return (
    <div className="terminal-canvas-wrapper">
      <div className="terminal-canvas__scope-bar" role="status" aria-live="polite">
        <div className="terminal-canvas__scope-info">
          {mode === 'observer' ? (
            <>
              <span className="terminal-canvas__scope-tag">Observer · viewport only</span>
              <span className="terminal-canvas__scope-desc">May omit source panel/scrollback</span>
              {controlNotice && (
                <span className="terminal-canvas__scope-notice" role="alert">
                  {controlNotice}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="terminal-canvas__scope-tag terminal-canvas__scope-tag--control">
                Control · shell only
              </span>
              <span className="terminal-canvas__scope-desc">
                {controlState === 'connecting'
                  ? 'Connecting control...'
                  : controlState === 'ready'
                    ? `${formatRemainingTime(remainingSeconds)} remaining`
                    : 'Control session'}
              </span>
            </>
          )}
        </div>

        <div className="terminal-canvas__scope-status">
          {mode === 'observer' && (
            <>
              {streamConnectionState === 'connecting' && (
                <span className="terminal-scope-badge terminal-scope-badge--connecting">
                  Connecting...
                </span>
              )}
              {streamConnectionState === 'reconnecting' && (
                <button
                  type="button"
                  className="terminal-scope-badge terminal-scope-badge--reconnecting"
                  onClick={reconnectStream}
                  aria-label="Reconnecting stream. Tap to retry now"
                >
                  Reconnecting (tap to retry)
                </button>
              )}
              {streamConnectionState === 'error' && (
                <button
                  type="button"
                  className="terminal-scope-badge terminal-scope-badge--error"
                  onClick={reconnectStream}
                  aria-label={streamLastError ? `Stream error: ${streamLastError}. Tap to retry` : 'Stream disconnected. Tap to retry'}
                >
                  {streamLastError ? `Error: ${streamLastError}` : 'Disconnected (tap to retry)'}
                </button>
              )}
              {streamConnectionState === 'connected' && (
                <span className="terminal-scope-badge terminal-scope-badge--live">
                  ● Live
                </span>
              )}

              {/* Take Control button: rendered only for non-agent panes */}
              {!isAgentPane && paneId && (
                <button
                  type="button"
                  className="terminal-scope-btn terminal-scope-btn--control"
                  onClick={handleTakeControl}
                  aria-label="Take shell control of active pane"
                >
                  <TerminalIcon size={14} aria-hidden="true" />
                  <span>Take Control</span>
                </button>
              )}
            </>
          )}

          {mode === 'control' && (
            <>
              {controlState === 'connecting' && (
                <>
                  <span className="terminal-scope-badge terminal-scope-badge--connecting">
                    Connecting...
                  </span>
                  <button
                    type="button"
                    className="terminal-scope-btn terminal-scope-btn--release"
                    onClick={handleReleaseControl}
                    aria-label="Cancel control connection"
                  >
                    <Square size={14} aria-hidden="true" />
                    <span>Cancel</span>
                  </button>
                </>
              )}

              {controlState === 'ready' && (
                <>
                  <span className="terminal-scope-badge terminal-scope-badge--control">
                    ● Active
                  </span>
                  <button
                    type="button"
                    className="terminal-scope-btn terminal-scope-btn--release"
                    onClick={handleReleaseControl}
                    aria-label="Release shell control and return to observer mode"
                  >
                    <Square size={14} aria-hidden="true" />
                    <span>Release</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div ref={containerRef} className="terminal-canvas" />
    </div>
  )
}

export default TerminalCanvas
