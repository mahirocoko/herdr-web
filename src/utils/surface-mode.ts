export type ISurfaceMode = 'question' | 'panel' | 'history' | 'stream'

export interface IResolveSurfaceModeParams {
  currentMode: ISurfaceMode
  isBlocked: boolean
  wasBlocked: boolean
  paneChanged: boolean
}

/**
 * Pure function to resolve the active surface mode based on pane transitions.
 * - Newly selected non-blocked pane -> 'panel' (full current source snapshot)
 * - Newly selected blocked pane -> 'question' (detection snapshot)
 * - Transition from non-blocked to blocked -> 'question'
 * - Transition from blocked to non-blocked -> 'panel'
 * - Edge case: non-blocked pane currently in 'question' -> 'panel'
 * - Otherwise preserve current user-selected mode
 */
export const resolveSurfaceMode = ({
  currentMode,
  isBlocked,
  wasBlocked,
  paneChanged
}: IResolveSurfaceModeParams): ISurfaceMode => {
  if (paneChanged) {
    return isBlocked ? 'question' : 'panel'
  }

  if (isBlocked && !wasBlocked) {
    return 'question'
  }

  if (!isBlocked && wasBlocked) {
    return 'panel'
  }

  if (!isBlocked && currentMode === 'question') {
    return 'panel'
  }

  return currentMode
}

/**
 * Returns the list of surface modes available for a pane.
 * Blocked panes offer Question, Panel, History, and Stream.
 * Normal (non-blocked) panes offer Panel, History, and Stream.
 */
export const getAvailableSurfaceModes = (isBlocked: boolean): ISurfaceMode[] => {
  return isBlocked
    ? ['question', 'panel', 'history', 'stream']
    : ['panel', 'history', 'stream']
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
