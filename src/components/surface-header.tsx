import type { FC } from 'react'
import { Loader2, RotateCw } from 'lucide-react'
import {
  getAvailableSurfaceModes,
  type ISurfaceMode
} from '@/utils/surface-mode.ts'
import Button from '@/components/ui/button.tsx'
import { ToggleGroup } from '@/components/ui/toggle-group.tsx'
import { Toggle } from '@/components/ui/toggle.tsx'

export interface ISurfaceHeaderProps {
  mode: ISurfaceMode
  onSelectMode: (mode: ISurfaceMode) => void
  isBlocked: boolean
  isLoading?: boolean
  onRefresh?: () => void
}

const MODE_LABELS: Record<ISurfaceMode, string> = {
  question: 'Question',
  panel: 'Panel',
  chat: 'Chat',
  stream: 'Stream'
}

const SurfaceHeader: FC<ISurfaceHeaderProps> = ({
  mode,
  onSelectMode,
  isBlocked,
  isLoading = false,
  onRefresh
}) => {
  const availableModes = getAvailableSurfaceModes(isBlocked)

  return (
    <header
      className="surface-header"
      role="toolbar"
      aria-label="Surface Navigation"
    >
      <ToggleGroup
        value={[mode]}
        onValueChange={(val) => {
          if (val.length > 0) {
            const nextMode = val[val.length - 1] as ISurfaceMode
            onSelectMode(nextMode)
          }
        }}
        className="surface-header__tabs"
        aria-label="Surface Modes"
      >
        {availableModes.map((m) => {
          const isActive = mode === m
          return (
            <Toggle
              key={m}
              value={m}
              id={`surface-tab-${m}`}
              variant="outline"
              size="sm"
              className={`surface-header__tab ${isActive ? 'surface-header__tab--active' : ''}`}
            >
              {MODE_LABELS[m]}
            </Toggle>
          )
        })}
      </ToggleGroup>

      {mode === 'panel' && (
        <span
          className="surface-header__meta"
          title="Complete current source snapshot, including source statusline when exposed"
        >
          Full source panel
        </span>
      )}
      {mode === 'chat' && (
        <span
          className="surface-header__meta"
          title="Provider-native conversation transcript"
        >
          Chat lens
        </span>
      )}
      {mode === 'stream' && (
        <span
          className="surface-header__meta"
          title="Observer mode streams active viewport only; can omit parts of the 158x52 source panel/statusline when client viewport is shorter"
        >
          Low-latency client viewport
        </span>
      )}

      <div className="surface-header__action-slot">
        {mode !== 'stream' && onRefresh && (
          <Button
            variant="ghost"
            size="icon"
            className="surface-header__refresh-btn"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label={
              isLoading
                ? `Refreshing ${MODE_LABELS[mode]}...`
                : `Refresh ${MODE_LABELS[mode]}`
            }
            title={
              isLoading
                ? `Refreshing ${MODE_LABELS[mode]}...`
                : `Refresh ${MODE_LABELS[mode]}`
            }
          >
            {isLoading ? (
              <Loader2
                size={14}
                className="surface-header__spinner spin"
                aria-hidden="true"
              />
            ) : (
              <RotateCw
                size={14}
                className="surface-header__refresh-icon"
                aria-hidden="true"
              />
            )}
          </Button>
        )}
      </div>
    </header>
  )
}

export default SurfaceHeader
