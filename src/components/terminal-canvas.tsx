import { useEffect, useRef, useState, useCallback } from 'react'
import type { FC, UIEvent, WheelEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import {
  Terminal as TerminalIcon,
  Square,
  ArrowDown,
  Copy,
  Check,
  Pause,
  Play
} from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import Button from '@/components/ui/button.tsx'
import {
  useTerminalStream,
  type ITerminalScrollState
} from '@/hooks/use-terminal-stream.ts'
import {
  formatRemainingTime,
  useTerminalControl
} from '@/hooks/use-terminal-control.ts'
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
import {
  calculateFollowScrollTop,
  calculateLatestScrollPosition,
  isScrolledAwayFromCursor,
  shouldFollowLatest
} from '@/utils/terminal-panning.ts'
import { attachTerminalTouchSelection } from '@/utils/terminal-touch-selection.ts'
import type { ITerminalFrame } from '@/types/herdr.ts'

export type TerminalMode = 'observer' | 'control'

export interface ITerminalCanvasProps {
  paneId: string | null
  terminalId?: string | null
  isAgentPane?: boolean
  cols?: number
  rows?: number
  onControlActiveChange?: (isActive: boolean) => void
  onControlOwnershipChange?: (
    ownership: ITerminalControlOwnership,
    paneId?: string
  ) => void
}

const TerminalCanvas: FC<ITerminalCanvasProps> = ({
  paneId,
  terminalId,
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
  const modeRef = useRef<TerminalMode>(mode)
  modeRef.current = mode

  const [controlNotice, setControlNotice] = useState<string | null>(null)
  const [isManuallyPaused, setIsManuallyPaused] = useState(false)
  const scrollStateRef = useRef<ITerminalScrollState | null>(null)

  // Fitted Live observer dimensions measured by FitAddon (1..500 cols, 1..200 rows)
  const [streamDimensions, setStreamDimensions] = useState<ITerminalDimensions>(
    {
      cols,
      rows
    }
  )
  const streamDimensionsRef = useRef<ITerminalDimensions>(streamDimensions)
  streamDimensionsRef.current = streamDimensions

  // Control mode measured dimensions (observer mode uses native frame dimensions)
  const [controlDimensions, setControlDimensions] =
    useState<ITerminalDimensions>({
      cols,
      rows
    })
  const controlDimensionsRef = useRef<ITerminalDimensions>(controlDimensions)
  controlDimensionsRef.current = controlDimensions

  // Panning, scroll-follow, and selection state
  const [isPanned, setIsPanned] = useState(false)
  const isPannedRef = useRef(false)
  isPannedRef.current = isPanned
  const followLeftRef = useRef(0)

  const [isScrolledAway, setIsScrolledAway] = useState(false)
  const [selectedText, setSelectedText] = useState<string | null>(null)
  const selectedTextRef = useRef<string | null>(null)
  selectedTextRef.current = selectedText
  const isTouchSelectingRef = useRef(false)
  const [clipboardNotice, setClipboardNotice] = useState<string | null>(null)
  const clipboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear clipboard notice timer on unmount
  useEffect(() => {
    return () => {
      if (clipboardTimerRef.current) {
        clearTimeout(clipboardTimerRef.current)
      }
    }
  }, [])

  const handleData = useCallback((bytes: Uint8Array) => {
    if (terminalRef.current && bytes.length > 0) {
      terminalRef.current.write(bytes)
    }
  }, [])

  // Observer stream frame handler: frame metadata drives xterm.resize BEFORE bytes write
  const handleStreamFrame = useCallback(
    async (frame: ITerminalFrame, bytes: Uint8Array) => {
      const term = terminalRef.current
      if (!term) return

      if (modeRef.current === 'observer') {
        if (frame.width > 0 && frame.height > 0) {
          if (term.cols !== frame.width || term.rows !== frame.height) {
            term.resize(frame.width, frame.height)
          }
        }

        // Full frame resets screen so stale rows cannot survive
        if (frame.full) {
          if (
            !isTouchSelectingRef.current &&
            !term.hasSelection() &&
            selectedTextRef.current === null
          ) {
            term.reset()
          }
        }
      }

      if (bytes.length > 0) {
        await new Promise<void>((resolve) =>
          term.write(bytes, () => {
            resolve()
            if (terminalRef.current !== term) return
            // Auto-follow: if not panned and no selection, and reading at latest offset, keep active cursor/bottom prompt in view
            if (modeRef.current === 'observer' && containerRef.current) {
              const isAtLatest = (scrollStateRef.current?.offset ?? 0) === 0
              const hasSelection =
                term.hasSelection() ||
                selectedTextRef.current !== null ||
                isTouchSelectingRef.current
              if (
                isAtLatest &&
                shouldFollowLatest(isPannedRef.current, hasSelection)
              ) {
                const screen =
                  containerRef.current.querySelector<HTMLElement>(
                    '.xterm-screen'
                  )
                const screenHeight = screen
                  ? screen.offsetHeight
                  : term.rows * 20
                const screenOffsetTop = screen ? screen.offsetTop : 0
                const targetScrollTop = calculateFollowScrollTop(
                  term.buffer.active.cursorY,
                  term.rows,
                  screenHeight,
                  screenOffsetTop,
                  containerRef.current.clientHeight,
                  containerRef.current.scrollHeight
                )
                containerRef.current.scrollTop = targetScrollTop
              }
            }
          })
        )
      }
    },
    []
  )

  // Observer stream hook: active only in observer mode
  const {
    connectionState: streamConnectionState,
    lastError: streamLastError,
    scrollState,
    sendScroll,
    reconnect: reconnectStream
  } = useTerminalStream({
    paneId: mode === 'observer' ? paneId : null,
    terminalId: mode === 'observer' ? terminalId : null,
    cols: streamDimensions.cols,
    rows: streamDimensions.rows,
    paused: isManuallyPaused,
    onData: handleData,
    onFrame: handleStreamFrame
  })
  scrollStateRef.current = scrollState

  const handleControlReady = useCallback(() => {
    notifyOwnership('active')
  }, [notifyOwnership])

  const handleControlClosed = useCallback(
    (reason?: string) => {
      setMode('observer')
      notifyOwnership('releasing')
      if (reason && reason !== 'Released by user' && reason !== 'detached') {
        setControlNotice(`Control closed: ${reason}`)
      }
    },
    [notifyOwnership]
  )

  const handleControlError = useCallback(
    (error: string) => {
      setMode('observer')
      notifyOwnership('releasing')
      setControlNotice(`Control error: ${error}`)
    },
    [notifyOwnership]
  )

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
    cols: controlDimensions.cols,
    rows: controlDimensions.rows,
    onData: handleData,
    onReady: handleControlReady,
    onClosed: handleControlClosed,
    onError: handleControlError
  })

  // Measure cols/rows for BOTH observer (fitted Live) and control modes using FitAddon
  const updateFittedDimensions = useCallback(() => {
    if (!fitAddonRef.current || !terminalRef.current || !containerRef.current)
      return
    const container = containerRef.current
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return

    try {
      fitAddonRef.current.fit()
      const term = terminalRef.current
      if (term.cols > 0 && term.rows > 0) {
        if (modeRef.current === 'control') {
          const clamped = clampTerminalDimensions(term.cols, term.rows)
          if (haveDimensionsChanged(controlDimensionsRef.current, clamped)) {
            setControlDimensions(clamped)
          }
        } else {
          // Observer mode: valid 1..500 cols, 1..200 rows, no min 40
          const measuredCols = Math.max(1, Math.min(500, term.cols))
          const measuredRows = Math.max(1, Math.min(200, term.rows))
          const nextDims = { cols: measuredCols, rows: measuredRows }
          if (haveDimensionsChanged(streamDimensionsRef.current, nextDims)) {
            setStreamDimensions(nextDims)
          }
        }
      }
    } catch {}
  }, [])

  // Initialize terminal once
  useEffect(() => {
    if (!containerRef.current) return

    const paint = getComputedStyle(containerRef.current)
    const token = (name: string) => paint.getPropertyValue(name).trim()
    const term = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      convertEol: true,
      fontFamily: token('--font-mono'),
      fontSize: Number.parseFloat(token('--fs-md')) || 15,
      lineHeight: 1.25,
      theme: {
        background: token('--color-bg-base'),
        foreground: token('--color-text-primary'),
        cursor: token('--color-accent'),
        selectionBackground: token('--color-accent-glow')
      }
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    if (term.textarea) {
      term.textarea.id = 'herdr-terminal-helper'
      term.textarea.name = 'terminal-helper'
    }

    // Track text selection for copy affordance
    const selectionDisposable = term.onSelectionChange(() => {
      if (term.hasSelection()) {
        const text = term.getSelection()
        if (text) {
          setSelectedText(text)
        }
      }
    })

    const handleContainerClick = () => {
      if (
        terminalRef.current &&
        !terminalRef.current.hasSelection() &&
        !isTouchSelectingRef.current
      ) {
        setSelectedText(null)
      }
    }
    const container = containerRef.current
    container.addEventListener('click', handleContainerClick)

    terminalRef.current = term
    fitAddonRef.current = fitAddon

    // Initial immediate measurement if container already has layout
    if (
      containerRef.current.clientWidth > 0 &&
      containerRef.current.clientHeight > 0
    ) {
      updateFittedDimensions()
    }

    // Font readiness check: ensure canvas refits when custom mono font metrics load
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready
        .then(() => {
          if (terminalRef.current === term) {
            updateFittedDimensions()
          }
        })
        .catch(() => {})
    }

    // Scheduled fallback measurement for late-rendered viewports
    const timeout = setTimeout(() => {
      updateFittedDimensions()
    }, 50)

    // Debounced ResizeObserver for both observer and control modes
    const debouncedResize = debounce(() => {
      updateFittedDimensions()
    }, 150)

    const resizeObserver = new ResizeObserver(() => {
      debouncedResize()
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      clearTimeout(timeout)
      debouncedResize.cancel()
      resizeObserver.disconnect()
      container.removeEventListener('click', handleContainerClick)
      selectionDisposable.dispose()
      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [updateFittedDimensions])

  // Mobile touch long-press and drag selection in observer mode
  useEffect(() => {
    const container = containerRef.current
    if (!container || mode !== 'observer') return

    const cleanup = attachTerminalTouchSelection({
      container,
      getTerminal: () => terminalRef.current,
      isObserverMode: () => modeRef.current === 'observer',
      onTouchScroll: (deltaRows) => {
        sendScroll({ deltaRows })
      },
      onSelection: (text) => {
        setSelectedText(text)
      },
      onClearSelection: () => {
        setSelectedText(null)
      },
      onTouchSelectingChange: (isSelecting) => {
        isTouchSelectingRef.current = isSelecting
      }
    })

    return () => {
      cleanup()
      isTouchSelectingRef.current = false
    }
  }, [mode, paneId, sendScroll])

  // Clear or reset terminal on pane change; reset mode to observer and reset panning
  useEffect(() => {
    if (terminalRef.current && paneId) {
      terminalRef.current.reset()
      updateFittedDimensions()
    }
    if (modeRef.current === 'control') {
      notifyOwnership('releasing')
    }
    setMode('observer')
    setIsManuallyPaused(false)
    setControlNotice(null)
    setIsPanned(false)
    setIsScrolledAway(false)
    isPannedRef.current = false
    followLeftRef.current = 0
    setSelectedText(null)
    setClipboardNotice(null)
    isTouchSelectingRef.current = false
  }, [paneId, updateFittedDimensions, notifyOwnership])

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
    // Refit terminal for control mode
    setTimeout(() => {
      updateFittedDimensions()
    }, 50)
  }

  const handleReleaseControl = () => {
    releaseControl()
    setMode('observer')
    notifyOwnership('releasing')
  }

  // Handle local scrolling in observer mode
  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    if (mode !== 'observer') return
    const target = e.currentTarget
    const term = terminalRef.current
    if (!term) return
    const screen = target.querySelector<HTMLElement>('.xterm-screen')
    const cursorTarget = calculateFollowScrollTop(
      term.buffer.active.cursorY,
      term.rows,
      screen?.offsetHeight ?? term.rows * 20,
      screen?.offsetTop ?? 0,
      target.clientHeight,
      target.scrollHeight
    )
    const scrolledAway =
      isScrolledAwayFromCursor(target.scrollTop, cursorTarget) ||
      Math.abs(target.scrollLeft - followLeftRef.current) > 24
    setIsScrolledAway(scrolledAway)
    isPannedRef.current = scrolledAway
    setIsPanned(scrolledAway)
  }

  // Native source scroll on wheel in observer mode
  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (mode !== 'observer' || isManuallyPaused) return
    if (Math.abs(e.deltaY) < 2) return
    // In Herdr: offset_from_bottom: 0 is bottom/latest.
    // Scrolling UP (deltaY < 0) reveals earlier rows -> offset increases (positive deltaRows).
    // Scrolling DOWN (deltaY > 0) moves towards bottom -> offset decreases (negative deltaRows).
    const rowDelta = Math.trunc(-e.deltaY / 20) || (e.deltaY < 0 ? 1 : -1)
    sendScroll({ deltaRows: rowDelta })
  }

  // Restore latest vertical visibility while preserving horizontal pan and reset native scroll offset
  const handleJumpToLatest = () => {
    if (mode === 'observer') {
      sendScroll({ to: 'latest' })
    }
    const container = containerRef.current
    const term = terminalRef.current
    if (!container || !term) return

    setIsPanned(false)
    setIsScrolledAway(false)
    isPannedRef.current = false
    followLeftRef.current = container.scrollLeft

    const screen = container.querySelector<HTMLElement>('.xterm-screen')
    const screenHeight = screen ? screen.offsetHeight : term.rows * 20
    const screenOffsetTop = screen ? screen.offsetTop : 0
    const targetScrollTop = calculateFollowScrollTop(
      term.buffer.active.cursorY,
      term.rows,
      screenHeight,
      screenOffsetTop,
      container.clientHeight,
      container.scrollHeight
    )

    const { scrollLeft, scrollTop } = calculateLatestScrollPosition(
      container.scrollLeft,
      targetScrollTop
    )

    container.scrollTop = scrollTop
    container.scrollLeft = scrollLeft
  }

  // Copy selection with truthful feedback and safe fallback without sending keys
  const handleCopySelection = () => {
    const term = terminalRef.current
    const text = selectedText ?? term?.getSelection()
    if (!text) return

    const showNotice = (msg: string, durationMs = 2500) => {
      setClipboardNotice(msg)
      if (clipboardTimerRef.current) clearTimeout(clipboardTimerRef.current)
      clipboardTimerRef.current = setTimeout(() => {
        setClipboardNotice(null)
      }, durationMs)
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => showNotice('Copied to clipboard'),
        () => {
          if (document.execCommand?.('copy')) {
            showNotice('Copied to clipboard')
          } else {
            showNotice('Clipboard write blocked by the browser')
          }
        }
      )
    } else if (document.execCommand?.('copy')) {
      showNotice('Copied to clipboard')
    } else {
      showNotice('Clipboard write blocked by the browser')
    }
  }

  return (
    <div className="terminal-canvas-wrapper">
      <div
        className="terminal-canvas__scope-bar"
        role="status"
        aria-live="polite"
      >
        <div className="terminal-canvas__scope-info">
          {mode === 'observer' ? (
            <>
              <span className="terminal-canvas__scope-tag">Read only</span>
              <span className="terminal-canvas__scope-desc">
                {isManuallyPaused
                  ? 'Fit paused · native desktop display active'
                  : scrollState && scrollState.maxOffset === 0
                    ? 'Native output · no scrollback in current screen'
                    : 'Native output · bounded History'}
              </span>
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
              {/* Copy affordance when text is selected */}
              {selectedText && (
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  className="terminal-scope-btn terminal-scope-btn--copy"
                  onClick={handleCopySelection}
                  aria-label="Copy selected terminal text to clipboard"
                  title="Copy selection"
                >
                  <Copy size={13} aria-hidden="true" />
                  <span>Copy</span>
                </Button>
              )}

              {/* Latest affordance button: restores vertical bottom prompt and resets native scroll offset */}
              {!isManuallyPaused &&
                (isScrolledAway || (scrollState?.offset ?? 0) > 0) && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="compact"
                    className="terminal-scope-btn terminal-scope-btn--latest"
                    onClick={handleJumpToLatest}
                    aria-label="Jump to latest terminal output"
                    title={
                      scrollState && scrollState.offset > 0
                        ? `Jump to latest (offset ${scrollState.offset})`
                        : 'Follow latest output'
                    }
                  >
                    <ArrowDown size={13} aria-hidden="true" />
                    <span>Latest</span>
                  </Button>
                )}

              {clipboardNotice && (
                <span
                  className="terminal-scope-badge terminal-scope-badge--clipboard"
                  role="status"
                >
                  <Check size={12} aria-hidden="true" />
                  {clipboardNotice}
                </span>
              )}

              {isManuallyPaused ? (
                <>
                  <span className="terminal-scope-badge terminal-scope-badge--paused">
                    ● Paused
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="compact"
                    className="terminal-scope-btn terminal-scope-btn--resume"
                    onClick={() => setIsManuallyPaused(false)}
                    aria-label="Resume Live fitted terminal stream"
                    title="Resume Live"
                  >
                    <Play size={13} aria-hidden="true" />
                    <span>Resume Live</span>
                  </Button>
                </>
              ) : (
                <>
                  {streamConnectionState === 'connecting' && (
                    <span className="terminal-scope-badge terminal-scope-badge--connecting">
                      Connecting...
                    </span>
                  )}
                  {streamConnectionState === 'reconnecting' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="compact"
                      className="terminal-scope-badge terminal-scope-badge--reconnecting"
                      onClick={reconnectStream}
                      aria-label="Reconnecting stream. Tap to retry now"
                    >
                      Reconnecting (tap to retry)
                    </Button>
                  )}
                  {streamConnectionState === 'error' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="compact"
                      className="terminal-scope-badge terminal-scope-badge--error"
                      onClick={reconnectStream}
                      aria-label={
                        streamLastError
                          ? `Stream error: ${streamLastError}. Tap to retry`
                          : 'Stream disconnected. Tap to retry'
                      }
                    >
                      {streamLastError
                        ? `Error: ${streamLastError}`
                        : 'Disconnected (tap to retry)'}
                    </Button>
                  )}
                  {streamConnectionState === 'connected' && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="compact"
                        className="terminal-scope-btn terminal-scope-btn--pause"
                        onClick={() => setIsManuallyPaused(true)}
                        aria-label="Pause fitted stream and return terminal to desktop dimensions"
                        title="Pause fit"
                      >
                        <Pause size={13} aria-hidden="true" />
                        <span>Pause fit</span>
                      </Button>
                      <span className="terminal-scope-badge terminal-scope-badge--live">
                        ● Live
                      </span>
                    </>
                  )}
                </>
              )}

              {/* Take Control button: rendered only for non-agent panes */}
              {!isAgentPane && paneId && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="terminal-scope-btn terminal-scope-btn--control"
                  onClick={handleTakeControl}
                  aria-label="Take shell control of active pane"
                >
                  <TerminalIcon size={14} aria-hidden="true" />
                  <span>Take Control</span>
                </Button>
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
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    className="terminal-scope-btn terminal-scope-btn--release"
                    onClick={handleReleaseControl}
                    aria-label="Cancel control connection"
                  >
                    <Square size={14} aria-hidden="true" />
                    <span>Cancel</span>
                  </Button>
                </>
              )}

              {controlState === 'ready' && (
                <>
                  <span className="terminal-scope-badge terminal-scope-badge--control">
                    ● Active
                  </span>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    className="terminal-scope-btn terminal-scope-btn--release"
                    onClick={handleReleaseControl}
                    aria-label="Release shell control and return to observer mode"
                  >
                    <Square size={14} aria-hidden="true" />
                    <span>Release</span>
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="terminal-canvas terminal-canvas--fitted"
        onScroll={handleScroll}
        onWheel={handleWheel}
        tabIndex={mode === 'observer' ? 0 : -1}
        role="region"
        aria-label="Terminal canvas view"
      />
    </div>
  )
}

export default TerminalCanvas
