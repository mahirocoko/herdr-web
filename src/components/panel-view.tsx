import type { FC } from 'react'
import TextSurfaceView from './text-surface-view.tsx'

export interface IPanelViewProps {
  paneId: string
  content: string | null
  isLoading: boolean
  error: string | null
  onRefresh?: () => void
  onSwitchToStream?: () => void
}

const PanelView: FC<IPanelViewProps> = ({
  paneId,
  content,
  isLoading,
  error,
  onRefresh,
  onSwitchToStream
}) => {
  return (
    <TextSurfaceView
      id="surface-panel-panel"
      ariaLabel="Full source panel"
      paneId={paneId}
      content={content}
      isLoading={isLoading}
      error={error}
      loadingText="Loading full source panel..."
      emptyText="No terminal output recorded for this pane."
      onRefresh={onRefresh}
      onSwitchToStream={onSwitchToStream}
    />
  )
}

export default PanelView
