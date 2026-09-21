import { describe, expect, it } from 'bun:test'
import {
  initialNewTabState,
  newTabStateReducer,
  resolveInspectPaneListAction,
  type INewTabState
} from '../new-tab-state.ts'

describe('newTabStateReducer', () => {
  it('transitions to new-tab view on clean OPEN_NEW_TAB', () => {
    const next = newTabStateReducer(initialNewTabState, { type: 'OPEN_NEW_TAB' })
    expect(next.view).toBe('new-tab')
    expect(next.outcome).toBeNull()
    expect(next.error).toBeNull()
  })

  it('records unknown outcome and persists it across NAVIGATE_BACK, CLOSE_DRAWER, and reopen', () => {
    // 1. Enter new-tab
    let state = newTabStateReducer(initialNewTabState, { type: 'OPEN_NEW_TAB' })

    // 2. Creation fails with unknown
    state = newTabStateReducer(state, {
      type: 'CREATE_UNKNOWN',
      error: 'Creation outcome unknown. Refresh pane list before trying again.'
    })
    expect(state.outcome).toBe('unknown')
    expect(state.error).toContain('Creation outcome unknown')

    // 3. User clicks Back -> view becomes 'list', but unknown outcome and error are retained!
    state = newTabStateReducer(state, { type: 'NAVIGATE_BACK' })
    expect(state.view).toBe('list')
    expect(state.outcome).toBe('unknown')
    expect(state.error).toContain('Creation outcome unknown')

    // 4. User re-enters New Shell Tab -> view becomes 'new-tab', unknown outcome and error are STILL retained!
    state = newTabStateReducer(state, { type: 'OPEN_NEW_TAB' })
    expect(state.view).toBe('new-tab')
    expect(state.outcome).toBe('unknown')
    expect(state.error).toContain('Creation outcome unknown')

    // 5. User closes drawer -> view becomes 'list', unknown outcome and error are retained across reopen!
    state = newTabStateReducer(state, { type: 'CLOSE_DRAWER' })
    expect(state.view).toBe('list')
    expect(state.outcome).toBe('unknown')
    expect(state.error).toContain('Creation outcome unknown')

    // 6. User reopens drawer and clicks New Shell Tab -> still unknown!
    state = newTabStateReducer(state, { type: 'OPEN_NEW_TAB' })
    expect(state.view).toBe('new-tab')
    expect(state.outcome).toBe('unknown')
    expect(state.error).toContain('Creation outcome unknown')
  })

  it('retains unknown state when Inspect pane list refresh fails', () => {
    let state: INewTabState = {
      view: 'new-tab',
      isCreating: false,
      outcome: 'unknown',
      error: 'Creation outcome unknown'
    }

    state = newTabStateReducer(state, {
      type: 'INSPECT_PANE_LIST_FAILURE',
      error: 'Failed to refresh snapshot: network error'
    })

    expect(state.outcome).toBe('unknown')
    expect(state.error).toBe('Failed to refresh snapshot: network error')
  })

  it('clears unknown state only when Inspect pane list succeeds', () => {
    let state: INewTabState = {
      view: 'new-tab',
      isCreating: false,
      outcome: 'unknown',
      error: 'Creation outcome unknown'
    }

    state = newTabStateReducer(state, { type: 'INSPECT_PANE_LIST_SUCCESS' })
    expect(state.view).toBe('list')
    expect(state.outcome).toBeNull()
    expect(state.error).toBeNull()
  })

  it('ignores create attempts while an unknown outcome awaits inspection', () => {
    const state: INewTabState = {
      view: 'new-tab',
      isCreating: false,
      outcome: 'unknown',
      error: 'Creation outcome unknown'
    }

    expect(newTabStateReducer(state, { type: 'START_CREATE' })).toBe(state)
  })

  it('resets normally on standard rejected outcome', () => {
    let state = newTabStateReducer(initialNewTabState, { type: 'OPEN_NEW_TAB' })
    state = newTabStateReducer(state, {
      type: 'CREATE_REJECTED',
      error: 'Workspace not found'
    })
    expect(state.outcome).toBe('rejected')
    expect(state.error).toBe('Workspace not found')

    // Normal rejection resets on Back
    state = newTabStateReducer(state, { type: 'NAVIGATE_BACK' })
    expect(state.view).toBe('list')
    expect(state.outcome).toBeNull()
    expect(state.error).toBeNull()
  })

  it('resets normally on create success', () => {
    let state = newTabStateReducer(initialNewTabState, { type: 'OPEN_NEW_TAB' })
    state = newTabStateReducer(state, { type: 'CREATE_SUCCESS' })
    expect(state.view).toBe('list')
    expect(state.outcome).toBeNull()
    expect(state.error).toBeNull()
  })

  describe('resolveInspectPaneListAction pure helper', () => {
    it('returns INSPECT_PANE_LIST_SUCCESS only when refreshed is strictly true', () => {
      const action = resolveInspectPaneListAction(true)
      expect(action).toEqual({ type: 'INSPECT_PANE_LIST_SUCCESS' })

      const next = newTabStateReducer(
        { view: 'new-tab', isCreating: false, outcome: 'unknown', error: 'Prior unknown' },
        action
      )
      expect(next.outcome).toBeNull()
      expect(next.view).toBe('list')
      expect(next.error).toBeNull()
    })

    it('returns INSPECT_PANE_LIST_FAILURE when refreshed is false, retaining unknown outcome', () => {
      const action = resolveInspectPaneListAction(false)
      expect(action.type).toBe('INSPECT_PANE_LIST_FAILURE')
      if (action.type === 'INSPECT_PANE_LIST_FAILURE') {
        expect(action.error).toContain('snapshot fetch or validation failed')
      }

      const next = newTabStateReducer(
        { view: 'new-tab', isCreating: false, outcome: 'unknown', error: 'Prior unknown' },
        action
      )
      expect(next.outcome).toBe('unknown')
      expect(next.error).toContain('snapshot fetch or validation failed')
    })

    it('returns INSPECT_PANE_LIST_FAILURE with custom error on throw/missing, retaining unknown', () => {
      const action = resolveInspectPaneListAction(false, 'Network timeout while refreshing')
      expect(action).toEqual({
        type: 'INSPECT_PANE_LIST_FAILURE',
        error: 'Network timeout while refreshing'
      })

      const next = newTabStateReducer(
        { view: 'new-tab', isCreating: false, outcome: 'unknown', error: 'Prior unknown' },
        action
      )
      expect(next.outcome).toBe('unknown')
      expect(next.error).toBe('Network timeout while refreshing')
    })

    it('treats undefined or null refreshed result as failure, retaining unknown outcome', () => {
      const actionNull = resolveInspectPaneListAction(null)
      expect(actionNull.type).toBe('INSPECT_PANE_LIST_FAILURE')

      const actionUndefined = resolveInspectPaneListAction(undefined)
      expect(actionUndefined.type).toBe('INSPECT_PANE_LIST_FAILURE')
    })
  })
})
