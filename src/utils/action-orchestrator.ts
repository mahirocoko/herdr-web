/**
 * Action orchestration helper.
 *
 * Guarantees:
 * 1. Single shared mutation serialization: drops concurrent triggers while an action is in flight.
 * 2. Immediate settlement: isBusy clears immediately after action() resolves or rejects.
 * 3. Finite result contract: returns 'acknowledged' on success, or 'skipped_busy' when dropped by busy gate.
 *    Action failure continues to rethrow (rejects).
 * 4. Detached background refresh: onSuccessRefresh is triggered as an un-awaited best-effort follow-up
 *    that never delays action resolution or converts success into an error.
 * 5. Error transparency: action failure sets error state and re-throws so the draft is retained.
 *    Skipped-busy returns 'skipped_busy' without setting an error.
 */

export type ActionResultStatus = 'acknowledged' | 'skipped_busy'

export interface IActionOrchestratorConfig {
  /**
   * The primary action to execute (e.g. sendAction).
   */
  action: () => Promise<unknown>
  /**
   * Detached best-effort follow-up triggered only upon successful action acknowledgment.
   */
  onSuccessRefresh?: () => Promise<unknown> | void
  /**
   * Getter for current busy state.
   */
  getIsBusy: () => boolean
  /**
   * Setter for busy state.
   */
  setIsBusy: (busy: boolean) => void
  /**
   * Setter for error message display.
   */
  setError: (error: string | null) => void
}

export const executeGuardedAction = async (
  config: IActionOrchestratorConfig
): Promise<ActionResultStatus> => {
  if (config.getIsBusy()) {
    return 'skipped_busy'
  }

  config.setIsBusy(true)
  config.setError(null)

  try {
    await config.action()
  } catch (err) {
    const message =
      err && typeof err === 'object' && 'outcome' in err && (err as any).outcome === 'unknown'
        ? 'Outcome unknown — inspect the pane before sending again.'
        : err instanceof Error
          ? err.message
          : String(err)
    config.setError(message)
    throw err
  } finally {
    config.setIsBusy(false)
  }

  if (config.onSuccessRefresh) {
    Promise.resolve()
      .then(() => config.onSuccessRefresh!())
      .catch(() => {
        // Background refresh failure must not fail or reject an acknowledged action
      })
  }

  return 'acknowledged'
}
