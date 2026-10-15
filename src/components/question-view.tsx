import { useEffect, useRef } from 'react'
import type { FC, UIEvent } from 'react'
import Button from '@/components/ui/button.tsx'

export interface IQuestionViewProps {
  paneId: string
  content: string | null
  isLoading: boolean
  error: string | null
  onRefresh?: () => void
  onSwitchToStream?: () => void
}

const QuestionView: FC<IQuestionViewProps> = ({
  paneId,
  content,
  isLoading,
  error,
  onRefresh,
  onSwitchToStream
}) => {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const activePaneRef = useRef(paneId)
  const shouldStickToBottomRef = useRef(true)

  useEffect(() => {
    if (activePaneRef.current !== paneId) {
      activePaneRef.current = paneId
      shouldStickToBottomRef.current = true
    }
  }, [paneId])

  useEffect(() => {
    if (!content || !shouldStickToBottomRef.current) return
    const frame = requestAnimationFrame(() => {
      const body = bodyRef.current
      if (body) {
        body.scrollTop = body.scrollHeight
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [content, paneId])

  const handleBodyScroll = (event: UIEvent<HTMLDivElement>) => {
    const body = event.currentTarget
    const distanceFromBottom =
      body.scrollHeight - body.scrollTop - body.clientHeight
    shouldStickToBottomRef.current = distanceFromBottom <= 48
  }

  return (
    <div
      className="question-view"
      role="region"
      id="surface-panel-question"
      aria-label="Blocked Question Snapshot"
    >
      <div
        ref={bodyRef}
        className="question-view__body"
        onScroll={handleBodyScroll}
        tabIndex={0}
        aria-label="Complete question and choices"
      >
        {error && content && (
          <div
            className="question-view__state question-view__state--error"
            role="status"
          >
            <span>
              Question refresh failed: {error}. Showing the last read, not
              current question evidence.
            </span>
            {onRefresh && (
              <Button variant="secondary" size="sm" onClick={onRefresh}>
                Re-read question
              </Button>
            )}
          </div>
        )}
        {error && !content ? (
          <div
            className="question-view__state question-view__state--error"
            role="alert"
          >
            <span>Failed to read question: {error}</span>
            {onRefresh && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="question-view__retry-btn"
                onClick={onRefresh}
              >
                Retry
              </Button>
            )}
          </div>
        ) : isLoading && !content ? (
          <div className="question-view__state question-view__state--loading">
            <span>Loading question snapshot...</span>
          </div>
        ) : !content || content.trim().length === 0 ? (
          <div className="question-view__state question-view__state--empty">
            <span>
              No question text was returned. This does not confirm that the
              agent is ready for input; inspect Terminal or re-read.
            </span>
            {onRefresh && (
              <Button variant="secondary" size="sm" onClick={onRefresh}>
                Re-read question
              </Button>
            )}
          </div>
        ) : (
          <pre className="question-view__content">{content}</pre>
        )}
        {(!content || error) && (
          <div className="question-view__state">
            <span>
              Read-only detection snapshot. Answer recognized questions in Chat
              or use native Herdr.
            </span>
            {onSwitchToStream && (
              <Button variant="secondary" size="sm" onClick={onSwitchToStream}>
                Inspect Terminal
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default QuestionView
