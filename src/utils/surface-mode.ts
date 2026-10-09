export type ISurfaceMode = 'question' | 'panel' | 'chat' | 'stream'

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
 * Terminal is default for all panes. Agent panes additionally offer Chat.
 * Blocked agent panes offer Question. Passing isAgent=false returns Terminal only;
 * existing callers using the default may offer Chat's truthful shell fallback.
 * Panel remains an internal snapshot fallback, not a competing primary mode.
 */
export const getAvailableSurfaceModes = (
  isBlocked: boolean,
  isAgent = true
): ISurfaceMode[] => {
  if (!isAgent) {
    return ['stream']
  }
  return isBlocked ? ['stream', 'question', 'chat'] : ['stream', 'chat']
}

export interface IPaneReadConfig {
  source: 'detection' | 'visible' | 'recent-unwrapped'
  lines?: number
  pollIntervalMs: number
}

/**
 * Pure helper providing the pane read parameters and polling intervals for each surface mode.
 * - Panel: source 'visible', no lines, 1000ms active polling
 * - Question: source 'detection', 2000ms polling when blocked
 * - Chat: null (Chat polls structured conversation endpoint, not text pane read)
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
    case 'chat':
    case 'stream':
      return null
  }
}
