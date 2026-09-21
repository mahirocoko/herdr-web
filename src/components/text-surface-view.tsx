import { useEffect, useMemo, useRef, useState } from 'react'
import type { FC, UIEvent } from 'react'
import { ArrowDown } from 'lucide-react'
import {
  calculateDistanceFromBottom,
  calculateNewScrollTop,
  isNearBottom
} from '@/utils/scroll-position.ts'
import { parseTerminalContent } from '@/utils/terminal-highlight.ts'

export interface ITextSurfaceViewProps {
  id: string
  ariaLabel: string
  paneId: string
  content: string | null
  isLoading: boolean
  error: string | null
  emptyText: string
  loadingText: string
  onRefresh?: () => void
  onSwitchToStream?: () => void
}

const TextSurfaceView: FC<ITextSurfaceViewProps> = ({
  id,
  ariaLabel,
  paneId,
  content,
  isLoading,
  error,
  emptyText,
  loadingText,
  onRefresh,
  onSwitchToStream
}) => {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const activePaneRef = useRef(paneId)
  const followLatestRef = useRef(true)
  const distanceFromBottomRef = useRef(0)
  const prevScrollHeightRef = useRef(0)
  const [isAwayFromBottom, setIsAwayFromBottom] = useState(false)

  // Reset scroll-to-bottom on pane change
  useEffect(() => {
    if (activePaneRef.current !== paneId) {
      activePaneRef.current = paneId
      followLatestRef.current = true
      distanceFromBottomRef.current = 0
      prevScrollHeightRef.current = 0
      setIsAwayFromBottom(false)
    }
  }, [paneId])

  // Handle content changes (polling or refetch)
  useEffect(() => {
    if (!content) return

    const frame = requestAnimationFrame(() => {
      const body = bodyRef.current
      if (!body) return

      if (followLatestRef.current) {
        body.scrollTop = body.scrollHeight
        distanceFromBottomRef.current = 0
        setIsAwayFromBottom(false)
      } else {
        // Preserve reading position when scrolled up
        const targetScrollTop = calculateNewScrollTop({
          followLatest: false,
          prevScrollTop: body.scrollTop,
          prevScrollHeight: prevScrollHeightRef.current,
          newScrollHeight: body.scrollHeight,
          clientHeight: body.clientHeight,
          prevDistanceFromBottom: distanceFromBottomRef.current
        })
        body.scrollTop = targetScrollTop
        const near = isNearBottom(body.scrollTop, body.scrollHeight, body.clientHeight, 48)
        setIsAwayFromBottom(!near)
      }

      prevScrollHeightRef.current = body.scrollHeight
    })

    return () => cancelAnimationFrame(frame)
  }, [content, paneId])

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const body = event.currentTarget
    const near = isNearBottom(body.scrollTop, body.scrollHeight, body.clientHeight, 48)
    followLatestRef.current = near
    distanceFromBottomRef.current = calculateDistanceFromBottom(body.scrollTop, body.scrollHeight, body.clientHeight)
    setIsAwayFromBottom(!near)
  }

  const handleScrollToLatest = () => {
    followLatestRef.current = true
    distanceFromBottomRef.current = 0
    setIsAwayFromBottom(false)
    const body = bodyRef.current
    if (body) {
      body.scrollTop = body.scrollHeight
    }
  }

  const parsedLines = useMemo(() => {
    if (!content) return []
    return parseTerminalContent(content)
  }, [content])

  return (
    <div
      className="text-surface-view"
      role="region"
      id={id}
      aria-label={ariaLabel}
    >
      <div
        ref={bodyRef}
        className="text-surface-view__body"
        onScroll={handleScroll}
        tabIndex={0}
        aria-label={`${ariaLabel} scrollable content`}
      >
        {error && !content ? (
          <div className="text-surface-view__state text-surface-view__state--error" role="alert">
            <span>Failed to load content: {error}</span>
            {onRefresh && (
              <button
                type="button"
                className="text-surface-view__retry-btn"
                onClick={onRefresh}
              >
                Retry
              </button>
            )}
          </div>
        ) : isLoading && !content ? (
          <div className="text-surface-view__state text-surface-view__state--loading">
            <span>{loadingText}</span>
          </div>
        ) : !content || content.trim().length === 0 ? (
          <div className="text-surface-view__state text-surface-view__state--empty">
            <span>{emptyText}</span>
            {onSwitchToStream && (
              <button
                type="button"
                className="text-surface-view__toggle-stream-btn"
                onClick={onSwitchToStream}
              >
                Switch to Stream Observer
              </button>
            )}
          </div>
        ) : (
          <pre className="text-surface-view__content">
            {parsedLines.map((line, lineIndex) => (
              <span
                key={lineIndex}
                className={`term-line term-line--${line.lineType}`}
              >
                {line.segments.map((segment, segIndex) =>
                  segment.tokenType ? (
                    <span
                      key={segIndex}
                      className={`term-token term-token--${segment.tokenType}`}
                    >
                      {segment.text}
                    </span>
                  ) : (
                    segment.text
                  )
                )}
                {line.newline}
              </span>
            ))}
          </pre>
        )}
      </div>

      {isAwayFromBottom && content && content.length > 0 && (
        <button
          type="button"
          className="text-surface-view__latest-btn"
          onClick={handleScrollToLatest}
          aria-label="Jump to latest output"
        >
          <ArrowDown size={14} aria-hidden="true" />
          <span>Latest</span>
        </button>
      )}
    </div>
  )
}

export default TextSurfaceView
