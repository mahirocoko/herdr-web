import type { FC } from 'react'
import { Loader2, RotateCw } from 'lucide-react'
import { getAvailableSurfaceModes, type ISurfaceMode } from '@/utils/surface-mode.ts'

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
  history: 'History',
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = availableModes.indexOf(mode)
    let nextIndex = -1

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      nextIndex = (currentIndex + 1) % availableModes.length
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      nextIndex = (currentIndex - 1 + availableModes.length) % availableModes.length
    } else if (e.key === 'Home') {
      e.preventDefault()
      nextIndex = 0
    } else if (e.key === 'End') {
      e.preventDefault()
      nextIndex = availableModes.length - 1
    }

    if (nextIndex >= 0) {
      const nextMode = availableModes[nextIndex]
      onSelectMode(nextMode)
      const nextTabEl = document.getElementById(`surface-tab-${nextMode}`)
      nextTabEl?.focus()
    }
  }

  return (
    <header className="surface-header" role="toolbar" aria-label="Surface Navigation">
      <div
        className="surface-header__tabs"
        role="tablist"
        aria-label="Surface Modes"
        onKeyDown={handleKeyDown}
      >
        {availableModes.map((m) => {
          const isActive = mode === m
          return (
            <button
              key={m}
              type="button"
              role="tab"
              id={`surface-tab-${m}`}
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              aria-controls={`surface-panel-${m}`}
              className={`surface-header__tab ${isActive ? 'surface-header__tab--active' : ''}`}
              onClick={() => onSelectMode(m)}
            >
              {MODE_LABELS[m]}
            </button>
          )
        })}
      </div>

      {mode === 'panel' && (
        <span className="surface-header__meta" title="Complete current source snapshot, including source statusline when exposed">
          Full source panel
        </span>
      )}
      {mode === 'history' && (
        <span className="surface-header__meta" title="Bounded to latest 1000 unwrapped rows">
          Latest 1000 lines
        </span>
      )}
      {mode === 'stream' && (
        <span className="surface-header__meta" title="Observer mode streams active viewport only; can omit parts of the 158x52 source panel/statusline when client viewport is shorter">
          Low-latency client viewport
        </span>
      )}

      <div className="surface-header__action-slot">
        {mode !== 'stream' && onRefresh && (
          <button
            type="button"
            className="surface-header__refresh-btn"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label={isLoading ? `Refreshing ${MODE_LABELS[mode]}...` : `Refresh ${MODE_LABELS[mode]}`}
            title={isLoading ? `Refreshing ${MODE_LABELS[mode]}...` : `Refresh ${MODE_LABELS[mode]}`}
          >
            {isLoading ? (
              <Loader2 size={14} className="surface-header__spinner spin" aria-hidden="true" />
            ) : (
              <RotateCw size={14} className="surface-header__refresh-icon" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </header>
  )
}

export default SurfaceHeader
