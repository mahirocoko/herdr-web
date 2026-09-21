import { useEffect, useRef } from 'react'
import type { FC, UIEvent } from 'react'

export interface IQuestionViewProps {
  paneId: string
  content: string | null
  isLoading: boolean
  error: string | null
  onRefresh?: () => void
}

const QuestionView: FC<IQuestionViewProps> = ({
  paneId,
  content,
  isLoading,
  error,
  onRefresh
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
    const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight
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
        {error && !content ? (
          <div className="question-view__state question-view__state--error" role="alert">
            <span>Failed to read question: {error}</span>
            {onRefresh && (
              <button type="button" className="question-view__retry-btn" onClick={onRefresh}>
                Retry
              </button>
            )}
          </div>
        ) : isLoading && !content ? (
          <div className="question-view__state question-view__state--loading">
            <span>Loading question snapshot...</span>
          </div>
        ) : !content || content.trim().length === 0 ? (
          <div className="question-view__state question-view__state--empty">
            <span>No question text detected.</span>
          </div>
        ) : (
          <pre className="question-view__content">{content}</pre>
        )}
      </div>
    </div>
  )
}

export default QuestionView
