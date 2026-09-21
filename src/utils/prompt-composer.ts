export type ActionResultStatus = 'acknowledged' | 'skipped_busy'

/**
 * Resolves the draft text in PromptComposer after an async submission attempts to complete.
 * - If submission failed or skipped_busy, retain currentDraft.
 * - If submission succeeded ('acknowledged' or true), clear only when:
 *     1. status is 'acknowledged' or true
 *     2. exact draft is unchanged (currentDraft === submittedDraft)
 *     3. exact pane is unchanged (currentPaneId === submittedPaneId)
 *     4. exact pane generation is unchanged (currentGeneration === submittedGeneration)
 * - Retain on failure, skipped-busy, pane switch, A->B, A->B->A, or newer input.
 */
export const resolveDraftAfterSubmit = (
  currentDraft: string,
  submittedDraft: string,
  status: boolean | ActionResultStatus,
  currentPaneId: string | null,
  submittedPaneId: string | null,
  currentGeneration: number,
  submittedGeneration: number
): string => {
  if (status !== true && status !== 'acknowledged') {
    return currentDraft
  }

  if (!currentPaneId || !submittedPaneId || currentPaneId !== submittedPaneId) {
    return currentDraft
  }

  if (currentGeneration !== submittedGeneration) {
    return currentDraft
  }

  return currentDraft === submittedDraft ? '' : currentDraft
}

export interface IComposerKeyDecision {
  shouldSubmit: boolean
  shouldPreventDefault: boolean
}

/**
 * Evaluates keyboard events in PromptComposer to determine submit vs newline vs no-op.
 *
 * Contract:
 * - IME composition (isComposing or keyCode 229): always allow native IME behavior, never submit.
 * - Shift+Enter: allow native newline insertion (shouldSubmit: false, shouldPreventDefault: false).
 * - Enter (without Shift):
 *     - If trimmedLength === 0 || isBusy || isDisabled: prevent default newline, do not submit.
 *     - If trimmed non-empty and ready: shouldSubmit: true, shouldPreventDefault: true.
 * - Any other key: allow native behavior.
 */
export const evaluateComposerKey = (
  key: string,
  shiftKey: boolean,
  isComposing: boolean,
  trimmedLength: number,
  isBusy: boolean,
  isDisabled: boolean,
  keyCode?: number
): IComposerKeyDecision => {
  if (isComposing || keyCode === 229) {
    return { shouldSubmit: false, shouldPreventDefault: false }
  }

  if (key === 'Enter') {
    if (shiftKey) {
      return { shouldSubmit: false, shouldPreventDefault: false }
    }

    if (trimmedLength === 0 || isBusy || isDisabled) {
      return { shouldSubmit: false, shouldPreventDefault: true }
    }

    return { shouldSubmit: true, shouldPreventDefault: true }
  }

  return { shouldSubmit: false, shouldPreventDefault: false }
}

export const COMPOSER_MIN_HEIGHT = 44
export const COMPOSER_MAX_HEIGHT = 132

/**
 * Calculates clamped textarea height for bounded auto-growth.
 * Clamped between minHeight (default 44px) and maxHeight (default 132px ~ 5 rows).
 */
export const calculateComposerHeight = (
  scrollHeight: number,
  minHeight: number = COMPOSER_MIN_HEIGHT,
  maxHeight: number = COMPOSER_MAX_HEIGHT
): number => {
  if (scrollHeight <= minHeight) {
    return minHeight
  }
  return Math.min(scrollHeight, maxHeight)
}
