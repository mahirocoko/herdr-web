import { usePaneRead } from './use-pane-read.ts'

export interface IUsePaneDetectionOptions {
  paneId: string | null
  isBlocked: boolean
  isEnabled?: boolean
  pollIntervalMs?: number
}

export interface IUsePaneDetectionResult {
  content: string | null
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

/**
 * Backward-compatible wrapper around usePaneRead for question detection.
 */
export const usePaneDetection = ({
  paneId,
  isBlocked,
  isEnabled = true,
  pollIntervalMs = 2000
}: IUsePaneDetectionOptions): IUsePaneDetectionResult => {
  return usePaneRead({
    paneId,
    source: 'detection',
    isEnabled: isEnabled && isBlocked,
    pollIntervalMs: isBlocked ? pollIntervalMs : 0
  })
}
