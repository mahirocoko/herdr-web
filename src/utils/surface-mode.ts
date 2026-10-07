export type ISurfaceMode = 'question' | 'panel' | 'history' | 'stream'

export interface IResolveSurfaceModeParams {
  currentMode: ISurfaceMode
  isBlocked: boolean
  wasBlocked: boolean
  paneChanged: boolean
}

/**
 * Pure function to resolve the active surface mode based on pane transitions.
 * - Newly selected pane -> live Terminal ('stream'), including blocked panes
 * - Status changes never replace the surface the user is reading
 * - An explicitly opened Question returns to Terminal once the asking ends
 * - Otherwise preserve current user-selected mode
 */
export const resolveSurfaceMode = ({
  currentMode,
  isBlocked,
  paneChanged
}: IResolveSurfaceModeParams): ISurfaceMode => {
  if (paneChanged) {
    return 'stream'
  }

  if (!isBlocked && currentMode === 'question') {
    return 'stream'
  }

  return currentMode
}

/**
 * Returns the list of surface modes available for a pane.
 * Terminal and History are the primary reading surfaces.
 * Blocked panes additionally offer the explicit Question snapshot.
 * Panel remains an internal snapshot fallback, not a competing primary mode.
 */
export const getAvailableSurfaceModes = (
  isBlocked: boolean
): ISurfaceMode[] => {
  return isBlocked ? ['stream', 'question', 'history'] : ['stream', 'history']
}

export interface IPaneReadConfig {
  source: 'detection' | 'visible' | 'recent-unwrapped'
  lines?: number
  pollIntervalMs: number
}

/**
 * Pure helper providing the pane read parameters and polling intervals for each surface mode.
 * - Panel: source 'visible', no lines, 1000ms active polling
 * - History: source 'recent-unwrapped', 1000 lines, 2000ms active polling
 * - Question: source 'detection', 2000ms polling when blocked
 * - Stream: null (observer streams over WebSocket, not pane read)
 */
export const getPaneReadConfigForMode = (
  mode: ISurfaceMode,
  isBlocked = false
): IPaneReadConfig | null => {
  switch (mode) {
    case 'question':
      return {
        source: 'detection',
        pollIntervalMs: isBlocked ? 2000 : 0
      }
    case 'panel':
      return {
        source: 'visible',
        pollIntervalMs: 1000
      }
    case 'history':
      return {
        source: 'recent-unwrapped',
        lines: 1000,
        pollIntervalMs: 2000
      }
    case 'stream':
      return null
  }
}
