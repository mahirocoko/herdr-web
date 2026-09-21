export type NewTabOutcome = 'observed' | 'rejected' | 'unknown' | null

export interface INewTabState {
  view: 'list' | 'new-tab'
  isCreating: boolean
  error: string | null
  outcome: NewTabOutcome
}

export type NewTabAction =
  | { type: 'OPEN_NEW_TAB' }
  | { type: 'NAVIGATE_BACK' }
  | { type: 'CLOSE_DRAWER' }
  | { type: 'START_CREATE' }
  | { type: 'CREATE_SUCCESS' }
  | { type: 'CREATE_REJECTED'; error: string }
  | { type: 'CREATE_UNKNOWN'; error: string }
  | { type: 'INSPECT_PANE_LIST_SUCCESS' }
  | { type: 'INSPECT_PANE_LIST_FAILURE'; error: string }

export const initialNewTabState: INewTabState = {
  view: 'list',
  isCreating: false,
  error: null,
  outcome: null
}

export const newTabStateReducer = (
  state: INewTabState,
  action: NewTabAction
): INewTabState => {
  switch (action.type) {
    case 'OPEN_NEW_TAB':
      if (state.outcome === 'unknown') {
        return {
          ...state,
          view: 'new-tab'
        }
      }
      return {
        ...state,
        view: 'new-tab',
        error: null,
        outcome: null
      }

    case 'NAVIGATE_BACK':
      if (state.outcome === 'unknown') {
        return {
          ...state,
          view: 'list'
        }
      }
      return {
        ...state,
        view: 'list',
        error: null,
        outcome: null
      }

    case 'CLOSE_DRAWER':
      if (state.outcome === 'unknown') {
        return {
          ...state,
          view: 'list',
          isCreating: false
        }
      }
      return {
        ...state,
        view: 'list',
        isCreating: false,
        error: null,
        outcome: null
      }

    case 'START_CREATE':
      if (state.outcome === 'unknown') {
        return state
      }
      return {
        ...state,
        isCreating: true,
        error: null,
        outcome: null
      }

    case 'CREATE_SUCCESS':
      return {
        ...state,
        view: 'list',
        isCreating: false,
        error: null,
        outcome: null
      }

    case 'CREATE_REJECTED':
      return {
        ...state,
        isCreating: false,
        error: action.error,
        outcome: 'rejected'
      }

    case 'CREATE_UNKNOWN':
      return {
        ...state,
        isCreating: false,
        error: action.error,
        outcome: 'unknown'
      }

    case 'INSPECT_PANE_LIST_SUCCESS':
      return {
        ...state,
        view: 'list',
        error: null,
        outcome: null
      }

    case 'INSPECT_PANE_LIST_FAILURE':
      return {
        ...state,
        outcome: 'unknown',
        error: action.error
      }

    default:
      return state
  }
}

/**
 * Resolves the action to dispatch following an Inspect Pane List attempt.
 * Guarantees that only an explicit boolean `true` clears the unknown outcome;
 * `false`, `null`, `undefined`, or an error retains the unknown state with a truthful error.
 */
export const resolveInspectPaneListAction = (
  refreshed: boolean | null | undefined,
  errorMessage?: string
): NewTabAction => {
  if (refreshed === true) {
    return { type: 'INSPECT_PANE_LIST_SUCCESS' }
  }
  return {
    type: 'INSPECT_PANE_LIST_FAILURE',
    error: errorMessage || 'Failed to refresh pane list: snapshot fetch or validation failed'
  }
}
