import type { FC } from 'react'
import TextSurfaceView from './text-surface-view.tsx'

export interface IHistoryViewProps {
  paneId: string
  content: string | null
  isLoading: boolean
  error: string | null
  onRefresh?: () => void
  onSwitchToStream?: () => void
}

const HistoryView: FC<IHistoryViewProps> = ({
  paneId,
  content,
  isLoading,
  error,
  onRefresh,
  onSwitchToStream
}) => {
  return (
    <TextSurfaceView
      id="surface-panel-history"
      ariaLabel="Terminal History (bounded latest 1000 lines)"
      paneId={paneId}
      content={content}
      isLoading={isLoading}
      error={error}
      loadingText="Loading terminal history (latest 1000 lines)..."
      emptyText="No terminal output recorded for this pane."
      onRefresh={onRefresh}
      onSwitchToStream={onSwitchToStream}
    />
  )
}

export default HistoryView
