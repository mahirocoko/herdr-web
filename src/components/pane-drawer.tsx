import { useEffect, useReducer, useRef, useState } from 'react'
import type { FC, FormEvent, ReactNode } from 'react'
import {
  AlertTriangle,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Folder,
  Loader2,
  Minus,
  Plus,
  Trash2,
  X
} from 'lucide-react'
import type { IAgentExplainResult, IPane, IStrictActionRequest, ITab, IWorkspace } from '@/types/herdr.ts'
import type { ILifecycleOperations } from '@/hooks/use-lifecycle-operations.ts'
import { fetchAgentExplain, sendAction } from '@/services/api-client.ts'
import { canSubmitNewTab, deriveTabCreateSourcePanes } from '@/utils/action-target.ts'
import { initialNewTabState, newTabStateReducer, resolveInspectPaneListAction } from '@/utils/new-tab-state.ts'
import {
  freezeTabCloseConfirmation,
  tabConfirmationChanged,
  type ITabCloseConfirmation
} from '@/utils/lifecycle-operations.ts'
import { formatTabLabel, groupPanesByTab, isAgentPane } from '@/utils/workspace-helpers.ts'
import { useTabNotificationPolicy } from '@/hooks/use-tab-notification-policy.ts'

export interface IPaneDrawerProps {
  isOpen: boolean
  workspaces: IWorkspace[]
  tabs?: ITab[]
  panes: IPane[]
  selectedWorkspaceId: string | null
  selectedPaneId: string | null
  onSelectPane: (paneId: string, workspaceId: string) => void
  onClose: () => void
  onRefreshSnapshot?: () => Promise<boolean>
  lifecycle: ILifecycleOperations
}

interface IExplainCacheEntry {
  loading: boolean
  error?: string
  data?: IAgentExplainResult
  fetchedStatus?: string
}

export { isAgentPane } from '@/utils/workspace-helpers.ts'

export const formatRegionLabel = (region?: string): string => {
  if (!region) return ''
  const r = region.toLowerCase()
  if (r.startsWith('osc_title')) return 'OSC Title'
  if (r.startsWith('osc_progress')) return 'OSC Progress'
  if (r.startsWith('bottom')) return 'Recent output (bottom)'
  if (r === 'screen' || r === 'full_screen') return 'Full screen'
  if (r === 'cursor') return 'Cursor area'
  if (r === 'whole_recent') return 'Recent output'
  return region
}

export const formatManifestSource = (sourceKind?: string, version?: string): string => {
  let label = 'Unknown source'
  if (sourceKind === 'builtin') label = 'Herdr built-in'
  else if (sourceKind === 'remote') label = 'Remote manifest'
  else if (sourceKind === 'local') label = 'Local manifest'
  if (version) {
    return `${label} (${version})`
  }
  return label
}

export const getNextFocusIndex = (
  currentIndex: number,
  totalCount: number,
  isShift: boolean
): number => {
  if (totalCount <= 0) return -1
  if (totalCount === 1) return 0
  if (currentIndex === -1) {
    return isShift ? totalCount - 1 : 0
  }
  if (isShift) {
    return (currentIndex - 1 + totalCount) % totalCount
  }
  return (currentIndex + 1) % totalCount
}

const PaneDrawer: FC<IPaneDrawerProps> = ({
  isOpen,
  workspaces,
  tabs = [],
  panes,
  selectedWorkspaceId,
  selectedPaneId,
  onSelectPane,
  onClose,
  onRefreshSnapshot,
  lifecycle
}) => {
  const [expandedPaneId, setExpandedPaneId] = useState<string | null>(null)
  const [explainCache, setExplainCache] = useState<Record<string, IExplainCacheEntry>>({})
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeRequestPaneIdRef = useRef<string | null>(null)
  const requestIdRef = useRef(0)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const drawerRef = useRef<HTMLDivElement | null>(null)
  const handleCloseRef = useRef<() => void>(() => undefined)
  const escapeHandlerRef = useRef<() => void>(() => undefined)
  const initiatingControlRef = useRef<HTMLElement | null>(null)

  const [lifecycleView, setLifecycleView] = useState<'list' | 'close-tab' | 'status'>('list')
  const [tabConfirmation, setTabConfirmation] = useState<ITabCloseConfirmation | null>(null)
  const [confirmationError, setConfirmationError] = useState<string | null>(null)

  // New Shell Tab state
  const [newTabState, dispatchNewTab] = useReducer(newTabStateReducer, initialNewTabState)
  const [selectedSourcePaneId, setSelectedSourcePaneId] = useState<string>('')
  const [tabLabel, setTabLabel] = useState<string>('')

  const cwdChoices = deriveTabCreateSourcePanes(panes, selectedWorkspaceId || '', selectedPaneId)
  const hasLifecycleGate = Boolean(lifecycle.ticket && lifecycle.ticket.phase !== 'rejected')

  // Default to currently selected pane if it belongs to Space, else deterministic first pane
  useEffect(() => {
    if (cwdChoices.length > 0) {
      if (!selectedSourcePaneId || !cwdChoices.some((c) => c.pane.pane_id === selectedSourcePaneId)) {
        setSelectedSourcePaneId(cwdChoices[0].pane.pane_id)
      }
    }
  }, [cwdChoices, selectedSourcePaneId])

  const {
    policies,
    status: policyStatus,
    pendingTabIds,
    error: policyError,
    isTabReady,
    toggleTabPolicy
  } = useTabNotificationPolicy({
    isOpen,
    tabs
  })

  useEffect(() => {
    if (!isOpen) return
    if (lifecycle.ticket && lifecycle.ticket.phase !== 'rejected') {
      setLifecycleView('status')
    }
    const frame = requestAnimationFrame(() => {
      if (lifecycleView === 'close-tab') {
        cancelButtonRef.current?.focus()
      } else {
        closeButtonRef.current?.focus()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [isOpen, lifecycle.ticket?.phase, lifecycleView])

  // Escape and Tab/Shift+Tab focus containment inside modal drawer
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        escapeHandlerRef.current()
        return
      }

      if (e.key === 'Tab') {
        const drawerEl = drawerRef.current
        if (!drawerEl) return

        const focusables = Array.from(
          drawerEl.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null || el === closeButtonRef.current)

        if (focusables.length === 0) {
          e.preventDefault()
          return
        }

        const activeIdx = focusables.indexOf(document.activeElement as HTMLElement)
        const nextIdx = getNextFocusIndex(activeIdx, focusables.length, e.shiftKey)
        if (nextIdx >= 0 && nextIdx < focusables.length) {
          e.preventDefault()
          focusables[nextIdx].focus()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // Drawer close must clear expanded pane and cache, and cancel any in-flight request
  useEffect(() => {
    if (!isOpen) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
      activeRequestPaneIdRef.current = null
      requestIdRef.current++
      setExpandedPaneId(null)
      setExplainCache({})
    }
  }, [isOpen])

  // Component unmount cleanup
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
      activeRequestPaneIdRef.current = null
      requestIdRef.current++
    }
  }, [])

  const handleClose = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    activeRequestPaneIdRef.current = null
    requestIdRef.current++
    setExpandedPaneId(null)
    setExplainCache({})
    dispatchNewTab({ type: 'CLOSE_DRAWER' })
    setLifecycleView('list')
    setConfirmationError(null)
    onClose()
  }
  handleCloseRef.current = handleClose

  const beginLifecycleView = (view: 'close-tab', initiator: HTMLElement | null) => {
    initiatingControlRef.current = initiator
    setConfirmationError(null)
    setLifecycleView(view)
  }

  const returnToList = () => {
    setLifecycleView('list')
    setConfirmationError(null)
    requestAnimationFrame(() => initiatingControlRef.current?.focus())
  }

  escapeHandlerRef.current = () => {
    if (lifecycle.isBusy) {
      handleClose()
      return
    }
    if (newTabState.view === 'new-tab') {
      dispatchNewTab({ type: 'NAVIGATE_BACK' })
      return
    }
    if (lifecycleView !== 'list') {
      returnToList()
      return
    }
    handleClose()
  }

  const handleConfirmTabClose = async () => {
    if (!tabConfirmation || hasLifecycleGate) return
    if (tabConfirmationChanged(tabConfirmation, panes)) {
      const currentTab = tabs.find((tab) => tab.tab_id === tabConfirmation.tabId && tab.workspace_id === tabConfirmation.workspaceId)
      setConfirmationError('Tab membership changed. Review the updated pane count, then confirm again.')
      setTabConfirmation(currentTab ? freezeTabCloseConfirmation(currentTab, panes) : null)
      return
    }
    const started = await lifecycle.dispatchLifecycle({
      type: 'tab-close',
      operationId: crypto.randomUUID(),
      target: {
        workspaceId: tabConfirmation.workspaceId,
        tabId: tabConfirmation.tabId,
        expected: tabConfirmation.expected
      }
    })
    if (started.accepted) setLifecycleView('status')
  }

  const handleInspectLifecycle = async () => {
    const refreshed = await onRefreshSnapshot?.()
    if (refreshed === true && lifecycle.ticket?.phase === 'unknown') {
      lifecycle.clearUnknownAfterRefresh()
      setLifecycleView('list')
      return
    }
    if (refreshed !== true) {
      setConfirmationError('Snapshot refresh failed. The operation remains gated until inspection succeeds.')
    }
  }

  const handleCreateTab = async (e: FormEvent) => {
    e.preventDefault()
    const chosenChoice = cwdChoices.find((c) => c.pane.pane_id === selectedSourcePaneId)
    if (
      !chosenChoice ||
      !chosenChoice.pane.terminal_id ||
      !selectedWorkspaceId ||
      newTabState.isCreating ||
      newTabState.outcome === 'unknown'
    ) return

    dispatchNewTab({ type: 'START_CREATE' })

    const operationId = crypto.randomUUID()
    const req: IStrictActionRequest = {
      type: 'tab-create',
      operationId,
      workspaceId: selectedWorkspaceId,
      target: {
        paneId: chosenChoice.pane.pane_id,
        terminalId: chosenChoice.pane.terminal_id
      },
      ...(tabLabel.trim() ? { label: tabLabel.trim() } : {})
    }

    let resp: Awaited<ReturnType<typeof sendAction>>
    try {
      resp = await sendAction(req)
    } catch (err: any) {
      const isUnknown = Boolean(err && typeof err === 'object' && err.outcome === 'unknown')
      if (isUnknown) {
        dispatchNewTab({
          type: 'CREATE_UNKNOWN',
          error: 'Creation outcome unknown. Inspect pane list before trying again.'
        })
      } else {
        dispatchNewTab({
          type: 'CREATE_REJECTED',
          error: err?.message || 'Failed to create tab'
        })
      }
      return
    }

    if (resp.ok && resp.result?.paneId) {
      dispatchNewTab({ type: 'CREATE_SUCCESS' })
      try {
        await onRefreshSnapshot?.()
      } catch {
        // The correlated server result already proved the tab and pane. A refresh failure
        // must not downgrade success into a retryable create state.
      }
      onSelectPane(resp.result.paneId, selectedWorkspaceId)
      handleClose()
      setTabLabel('')
      return
    }

    if (resp.outcome === 'unknown') {
      dispatchNewTab({
        type: 'CREATE_UNKNOWN',
        error: resp.error || 'Creation outcome unknown. Inspect pane list before trying again.'
      })
    } else {
      dispatchNewTab({
        type: 'CREATE_REJECTED',
        error: resp.error || 'Failed to create tab'
      })
    }
  }

  if (!isOpen) return null

  const tabGroups = groupPanesByTab(tabs, panes, selectedWorkspaceId)
  const canonicalTabCount = tabs.filter((tab) => tab.workspace_id === selectedWorkspaceId).length

  const getStatusBadgeClass = (status?: string) => {
    switch (status) {
      case 'blocked':
        return 'agent-status--blocked'
      case 'working':
        return 'agent-status--working'
      case 'done':
        return 'agent-status--done'
      case 'idle':
        return 'agent-status--idle'
      default:
        return 'agent-status--unknown'
    }
  }

  const getBasename = (pathStr?: string | null) => {
    if (!pathStr) return ''
    const parts = pathStr.split('/').filter(Boolean)
    return parts.pop() || pathStr
  }

  const loadExplain = async (paneId: string, currentStatus?: string) => {
    // One-request-at-a-time: abort any prior pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }

    const currentGeneration = ++requestIdRef.current
    const controller = new AbortController()
    abortControllerRef.current = controller
    activeRequestPaneIdRef.current = paneId

    setExplainCache((prev) => ({
      ...prev,
      [paneId]: { loading: true, fetchedStatus: currentStatus }
    }))

    try {
      const result = await fetchAgentExplain(paneId, controller.signal)
      if (
        controller.signal.aborted ||
        currentGeneration !== requestIdRef.current ||
        activeRequestPaneIdRef.current !== paneId
      ) {
        // Request was obsolete; clear temporary loading state if this pane is still marked loading
        setExplainCache((prev) => {
          if (prev[paneId]?.loading) {
            const next = { ...prev }
            delete next[paneId]
            return next
          }
          return prev
        })
        return
      }

      setExplainCache((prev) => ({
        ...prev,
        [paneId]: { loading: false, data: result, fetchedStatus: currentStatus }
      }))
    } catch (err) {
      if (
        controller.signal.aborted ||
        currentGeneration !== requestIdRef.current ||
        activeRequestPaneIdRef.current !== paneId ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        // Abort is not displayed as an error; clean up loading state
        setExplainCache((prev) => {
          if (prev[paneId]?.loading) {
            const next = { ...prev }
            delete next[paneId]
            return next
          }
          return prev
        })
        return
      }

      const errorMsg = err instanceof Error ? err.message : String(err)
      setExplainCache((prev) => ({
        ...prev,
        [paneId]: { loading: false, error: errorMsg, fetchedStatus: currentStatus }
      }))
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
      if (
        currentGeneration === requestIdRef.current &&
        activeRequestPaneIdRef.current === paneId
      ) {
        activeRequestPaneIdRef.current = null
      }
    }
  }

  const handleToggleExplain = (paneId: string, currentStatus?: string) => {
    if (expandedPaneId === paneId) {
      // Collapsing currently explained pane: cancel active request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
      activeRequestPaneIdRef.current = null
      requestIdRef.current++
      setExpandedPaneId(null)
      setExplainCache((prev) => {
        if (prev[paneId]?.loading) {
          const next = { ...prev }
          delete next[paneId]
          return next
        }
        return prev
      })
    } else {
      // Switching explained pane: cancel any prior pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
      activeRequestPaneIdRef.current = null
      requestIdRef.current++
      setExpandedPaneId(paneId)
      const existing = explainCache[paneId]
      if (!existing || existing.error) {
        loadExplain(paneId, currentStatus)
      }
    }
  }

  const renderLifecycleShell = (title: string, body: ReactNode) => (
    <div className="drawer-overlay" onClick={handleClose} role="presentation">
      <div
        id="tab-pane-drawer"
        ref={drawerRef}
        className="drawer-sheet drawer-sheet--new-tab"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="drawer-sheet__handle" />
        <div className="drawer-sheet__header drawer-sheet__header--nav">
          <button
            type="button"
            className="drawer-sheet__back-btn"
            onClick={returnToList}
            disabled={lifecycle.isBusy}
            aria-label="Back to lifecycle actions"
          >
            <ChevronLeft size={18} aria-hidden="true" />
            <span>Back</span>
          </button>
          <span className="drawer-sheet__title">{title}</span>
          <button
            ref={closeButtonRef}
            type="button"
            className="drawer-sheet__close-btn"
            onClick={handleClose}
            aria-label={lifecycle.isBusy ? 'Close drawer; operation continues checking' : 'Close drawer'}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {body}
      </div>
    </div>
  )

  if (lifecycleView === 'status' && lifecycle.ticket) {
    const ticket = lifecycle.ticket
    const statusMessage = ticket.phase === 'pending'
      ? 'Operation pending. You can close this drawer; it continues checking.'
      : ticket.phase === 'unknown'
        ? ticket.error || 'Outcome unknown. Refresh and inspect before another action.'
        : ticket.phase === 'reconciliation-failed'
          ? ticket.error || 'The server observed the action, but browser reconciliation was not confirmed.'
          : ticket.phase === 'rejected'
            ? ticket.error || 'The action was rejected.'
            : ticket.error || 'Action observed. Refreshing and reconciling the active session.'
    return renderLifecycleShell('Lifecycle Status', (
      <div className="new-tab-form">
        <div className="new-tab-form__body">
          <div className={`new-tab-status ${ticket.phase === 'unknown' ? 'new-tab-status--unknown' : ticket.phase === 'rejected' || ticket.phase === 'reconciliation-failed' ? 'new-tab-status--error' : ''}`} role="status" aria-live="polite">
            <div className="new-tab-status__content">
              {(ticket.phase === 'pending' || ticket.phase === 'observed') && <Loader2 size={16} className="spin" aria-hidden="true" />}
              {ticket.phase !== 'pending' && ticket.phase !== 'observed' && <AlertTriangle size={16} aria-hidden="true" />}
              <span>{statusMessage}</span>
            </div>
          </div>
          <div className="lifecycle-ticket-details">
            <span>{ticket.type}</span>
            <code>{ticket.operationId}</code>
          </div>
          {confirmationError && <div className="new-tab-status new-tab-status--error" role="alert">{confirmationError}</div>}
        </div>
        <div className="new-tab-form__footer lifecycle-form__actions">
          {ticket.phase === 'unknown' && (
            <button type="button" className="new-tab-submit-btn" onClick={handleInspectLifecycle}>
              Refresh and inspect
            </button>
          )}
          {ticket.phase === 'reconciliation-failed' && (
            <button
              type="button"
              className="new-tab-submit-btn"
              onClick={() => lifecycle.retryReconciliation(ticket.requestIdentity)}
            >
              Refresh and inspect
            </button>
          )}
          {ticket.phase === 'rejected' && (
            <button type="button" className="new-tab-submit-btn" onClick={returnToList}>
              Return to actions
            </button>
          )}
          {ticket.phase === 'pending' && (
            <button type="button" className="lifecycle-cancel-btn" onClick={handleClose}>
              Dismiss — operation continues
            </button>
          )}
        </div>
      </div>
    ))
  }

  if (lifecycleView === 'close-tab' && tabConfirmation) {
    return renderLifecycleShell('Close Tab', (
      <div className="new-tab-form">
        <div className="new-tab-form__body lifecycle-confirmation">
          <p><strong>{tabConfirmation.label}</strong></p>
          <code>{tabConfirmation.tabId}</code>
          <p>This closes all {tabConfirmation.paneCount} panes in this Tab. Running contents may be interrupted, and unsaved work may be lost.</p>
          {confirmationError && <div className="new-tab-status new-tab-status--error" role="alert">{confirmationError}</div>}
        </div>
        <div className="new-tab-form__footer lifecycle-form__actions">
          <button ref={cancelButtonRef} type="button" className="lifecycle-cancel-btn" onClick={returnToList}>Cancel</button>
          <button type="button" className="lifecycle-danger-btn" onClick={handleConfirmTabClose} disabled={lifecycle.isBusy}>Close Tab</button>
        </div>
      </div>
    ))
  }

  if (newTabState.view === 'new-tab') {
    const activeWs = workspaces.find((w) => w.workspace_id === selectedWorkspaceId)
    const activeWsLabel =
      activeWs?.label || (activeWs?.number ? `Space ${activeWs.number}` : selectedWorkspaceId || 'Space')

    return (
      <div className="drawer-overlay" onClick={handleClose} role="presentation">
        <div
          id="tab-pane-drawer"
          ref={drawerRef}
          className="drawer-sheet drawer-sheet--new-tab"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="New Shell Tab Form"
        >
          <div className="drawer-sheet__handle" />

          <div className="drawer-sheet__header drawer-sheet__header--nav">
            <button
              type="button"
              className="drawer-sheet__back-btn"
              onClick={() => {
                dispatchNewTab({ type: 'NAVIGATE_BACK' })
              }}
              disabled={newTabState.isCreating}
              aria-label="Back to pane list"
            >
              <ChevronLeft size={18} aria-hidden="true" />
              <span>Back</span>
            </button>

            <span className="drawer-sheet__title">New Shell Tab</span>

            <button
              ref={closeButtonRef}
              type="button"
              className="drawer-sheet__close-btn"
              onClick={handleClose}
              disabled={newTabState.isCreating}
              aria-label="Close drawer"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <form className="new-tab-form" onSubmit={handleCreateTab}>
            <div className="new-tab-form__body">
              <div className="new-tab-field">
                <span className="new-tab-field__label">Destination Space</span>
                <div className="new-tab-field__readonly-value">{activeWsLabel}</div>
              </div>

              <div className="new-tab-field">
                <label htmlFor="new-tab-source-pane" className="new-tab-field__label">
                  Working Directory (from pane)
                </label>
                {cwdChoices.length === 0 ? (
                  <div className="new-tab-field__empty">
                    No active shell or agent panes with terminal identities in this Space.
                  </div>
                ) : (
                  <select
                    id="new-tab-source-pane"
                    className="new-tab-field__select"
                    value={selectedSourcePaneId}
                    onChange={(e) => setSelectedSourcePaneId(e.target.value)}
                    disabled={newTabState.isCreating}
                    aria-label="Select source pane for working directory"
                  >
                    {cwdChoices.map((choice) => (
                      <option key={choice.pane.pane_id} value={choice.pane.pane_id}>
                        {choice.displayCwd} (pane {choice.pane.pane_id})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="new-tab-field">
                <label htmlFor="new-tab-label-input" className="new-tab-field__label">
                  Tab Label (optional)
                </label>
                <input
                  id="new-tab-label-input"
                  type="text"
                  maxLength={50}
                  className="new-tab-field__input"
                  placeholder="e.g. dev, tests, worker"
                  value={tabLabel}
                  onChange={(e) => setTabLabel(e.target.value)}
                  disabled={newTabState.isCreating}
                  aria-label="Tab label"
                />
              </div>

              {newTabState.error && (
                <div
                  className={`new-tab-status ${newTabState.outcome === 'unknown' ? 'new-tab-status--unknown' : 'new-tab-status--error'}`}
                  role="alert"
                >
                  <div className="new-tab-status__content">
                    <AlertTriangle size={14} className="new-tab-status__icon" aria-hidden="true" />
                    <span>{newTabState.error}</span>
                  </div>
                  {newTabState.outcome === 'unknown' && (
                    <button
                      type="button"
                      className="new-tab-status__action-btn"
                      onClick={async () => {
                        try {
                          if (!onRefreshSnapshot) {
                            dispatchNewTab(resolveInspectPaneListAction(false, 'Pane list refresh is unavailable'))
                            return
                          }
                          const refreshed = await onRefreshSnapshot()
                          dispatchNewTab(resolveInspectPaneListAction(refreshed))
                        } catch (refreshErr) {
                          const error = `Failed to refresh pane list: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`
                          dispatchNewTab(resolveInspectPaneListAction(false, error))
                        }
                      }}
                    >
                      Inspect pane list
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="new-tab-form__footer">
              {newTabState.outcome !== 'unknown' && (
                <button
                  type="submit"
                  className="new-tab-submit-btn"
                  disabled={!canSubmitNewTab({
                    isCreatingTab: newTabState.isCreating,
                    hasChoices: cwdChoices.length > 0,
                    createTabOutcome: newTabState.outcome
                  })}
                  aria-label="Create shell tab"
                >
                  {newTabState.isCreating ? (
                    <>
                      <Loader2 size={16} className="spin" aria-hidden="true" />
                      <span>Creating Tab...</span>
                    </>
                  ) : (
                    <span>Create Tab</span>
                  )}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="drawer-overlay" onClick={handleClose} role="presentation">
      <div
        id="tab-pane-drawer"
        ref={drawerRef}
        className="drawer-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Tabs and Panes"
      >
        <div className="drawer-sheet__handle" />

        <div className="drawer-sheet__header">
          <span className="drawer-sheet__title">Tabs & Panes</span>
          <button
            ref={closeButtonRef}
            type="button"
            className="drawer-sheet__close-btn"
            onClick={handleClose}
            aria-label="Close drawer"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Pane List Grouped by Tabs */}
        <div className="drawer-sheet__panes-list">
          {policyError && (
            <div className="tab-policy-error" role="alert">
              <AlertTriangle size={14} className="tab-policy-error__icon" aria-hidden="true" />
              <span>{policyError}</span>
            </div>
          )}
          {tabGroups.length === 0 ? (
            <div className="drawer-sheet__empty">No tabs or panes in this workspace</div>
          ) : (
            tabGroups.map((group, groupIdx) => {
              const tab = group.tab
              const tabKey = tab ? tab.tab_id : `orphan-${groupIdx}`
              const tabTitle = tab ? formatTabLabel(tab) : 'Other Panes'
              const tabStatus = tab?.agent_status
              const tabId = tab?.tab_id
              const isReady = tabId ? isTabReady(tabId) : false
              const tabPolicy = tabId ? policies.get(tabId) : undefined
              const isNotifyEnabled = tabPolicy ? tabPolicy.enabled : false
              const isPending = tabId ? pendingTabIds.has(tabId) : false
              const isLoading = policyStatus === 'loading' && !tabPolicy
              const isUnavailable =
                policyStatus === 'unavailable' ||
                (!isReady && policyStatus !== 'loading')

              return (
                <div key={tabKey} className="tab-group">
                  <div className="tab-group__header">
                    <div className="tab-group__info">
                      <span className="tab-group__title">{tabTitle}</span>
                      {tab && <span className="tab-group__count">{group.panes.length}p</span>}
                    </div>
                    <div className="tab-group__actions">
                      {tabStatus && (
                        <span className={`tab-group__status ${getStatusBadgeClass(tabStatus)}`}>
                          {tabStatus}
                        </span>
                      )}
                      {tab && (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={isReady ? isNotifyEnabled : false}
                          aria-label={
                            isLoading
                              ? `Notifications for ${tabTitle}: Loading...`
                              : isUnavailable
                                ? `Notifications for ${tabTitle}: Unavailable`
                                : `Notifications for ${tabTitle}: ${isNotifyEnabled ? 'On' : 'Off'}`
                          }
                          aria-busy={isPending || isLoading}
                          aria-disabled={!isReady || isPending}
                          className={`tab-notify-switch ${
                            isReady
                              ? isNotifyEnabled
                                ? 'tab-notify-switch--on'
                                : 'tab-notify-switch--off'
                              : isUnavailable
                                ? 'tab-notify-switch--unavailable'
                                : 'tab-notify-switch--loading'
                          } ${isPending ? 'tab-notify-switch--pending' : ''}`}
                          disabled={!isReady}
                          onClick={() => {
                            if (isReady && !isPending) {
                              toggleTabPolicy(tab.tab_id)
                            }
                          }}
                        >
                          <span className="tab-notify-switch__icon" aria-hidden="true">
                            {isPending || isLoading ? (
                              <Loader2 size={13} className="spin" aria-hidden="true" />
                            ) : isUnavailable ? (
                              <Minus size={13} aria-hidden="true" />
                            ) : (
                              <Bell size={13} aria-hidden="true" />
                            )}
                          </span>
                          <span className="tab-notify-switch__track" aria-hidden="true">
                            <span className="tab-notify-switch__thumb" />
                          </span>
                        </button>
                      )}
                      {tab && canonicalTabCount > 1 && (
                        <button
                          type="button"
                          className="tab-close-action"
                          aria-label={`Close ${tabTitle}`}
                          disabled={hasLifecycleGate}
                          onClick={(event) => {
                            setTabConfirmation(freezeTabCloseConfirmation(tab, panes))
                            beginLifecycleView('close-tab', event.currentTarget)
                          }}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                          <span>Close</span>
                        </button>
                      )}
                      {tab && canonicalTabCount <= 1 && (
                        <span className="tab-close-hint">Use Close Space for the last Tab</span>
                      )}
                    </div>
                  </div>

                  <div className="tab-group__panes">
                    {group.panes.length === 0 ? (
                      <div className="tab-group__empty-panes">No panes in this tab</div>
                    ) : (
                      group.panes.map((p) => {
                        const isSelected = p.pane_id === selectedPaneId
                        const hasAgent = isAgentPane(p)
                        const agentLabel = p.display_agent || p.agent || 'Shell'
                        const title = p.terminal_title_stripped || p.title || p.pane_id
                        const dirName = getBasename(p.foreground_cwd || p.cwd)
                        const isExpanded = expandedPaneId === p.pane_id
                        const explain = explainCache[p.pane_id]
                        const isStale = Boolean(
                          explain?.data?.available &&
                          explain.fetchedStatus &&
                          explain.fetchedStatus !== p.agent_status
                        )

                        const activeFlags: string[] = []
                        if (explain?.data?.visibleWorking) activeFlags.push('Visible working')
                        if (explain?.data?.visibleBlocker) activeFlags.push('Visible blocker')
                        if (explain?.data?.visibleIdle) activeFlags.push('Visible idle')
                        if (explain?.data?.screenDetectionSkipped) activeFlags.push('Screen check skipped')
                        if (explain?.data?.stateUpdateSkipped) activeFlags.push('State update skipped')

                        return (
                          <div
                            key={p.pane_id}
                            className={`pane-card ${isSelected ? 'pane-card--selected' : ''}`}
                          >
                            <div className="pane-card__row">
                              <button
                                type="button"
                                className="pane-card__select"
                                onClick={() => {
                                  onSelectPane(p.pane_id, p.workspace_id)
                                  handleClose()
                                }}
                                aria-label={`Select pane ${p.pane_id} ${agentLabel}`}
                              >
                                <div className="pane-card__main">
                                  <div className="pane-card__header-row">
                                    <span className="pane-card__id">{p.pane_id}</span>
                                    <span className="pane-card__agent">{agentLabel}</span>
                                    <span className={`pane-card__status ${getStatusBadgeClass(p.agent_status)}`}>
                                      {p.agent_status}
                                    </span>
                                  </div>

                                  <div className="pane-card__title-row">
                                    <span className="pane-card__title">{title}</span>
                                    {dirName && (
                                      <span className="pane-card__dir">
                                        <Folder size={12} aria-hidden="true" /> {dirName}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {isSelected && (
                                  <span className="pane-card__check" aria-hidden="true">
                                    <Check size={14} aria-hidden="true" />
                                  </span>
                                )}
                              </button>

                              {hasAgent && (
                                <button
                                  type="button"
                                  className={`pane-card__explain-trigger ${isExpanded ? 'pane-card__explain-trigger--active' : ''}`}
                                  onClick={() => handleToggleExplain(p.pane_id, p.agent_status)}
                                  aria-label={`Explain status for pane ${p.pane_id}`}
                                  aria-expanded={isExpanded}
                                  aria-controls={`pane-explain-${p.pane_id}`}
                                >
                                  <span className="pane-card__explain-label">Why?</span>
                                  <span className="pane-card__explain-chevron" aria-hidden="true">
                                    {isExpanded ? (
                                      <ChevronUp size={14} aria-hidden="true" />
                                    ) : (
                                      <ChevronDown size={14} aria-hidden="true" />
                                    )}
                                  </span>
                                </button>
                              )}
                            </div>

                            {isExpanded && (
                              <div
                                id={`pane-explain-${p.pane_id}`}
                                className="pane-card__explain-panel"
                                role="region"
                                aria-live="polite"
                                aria-label={`Explanation for pane ${p.pane_id}`}
                              >
                                {explain?.loading && (
                                  <div className="pane-explain__loading">
                                    <Loader2 size={14} className="pane-explain__spinner spin" aria-hidden="true" />
                                    <span>Inspecting status...</span>
                                  </div>
                                )}

                                {!explain?.loading && explain?.error && (
                                  <div className="pane-explain__error">
                                    <span className="pane-explain__error-text">Could not load explanation</span>
                                    <button
                                      type="button"
                                      className="pane-explain__retry-btn"
                                      onClick={() => loadExplain(p.pane_id, p.agent_status)}
                                      aria-label={`Retry explaining pane ${p.pane_id}`}
                                    >
                                      Retry
                                    </button>
                                  </div>
                                )}

                                {!explain?.loading && explain?.data && !explain.data.available && (
                                  <div className="pane-explain__unavailable">
                                    <span>Shell (no agent rules)</span>
                                  </div>
                                )}

                                {!explain?.loading && explain?.data && explain.data.available && (
                                  <>
                                    {isStale && (
                                      <div className="pane-explain__stale">
                                        <span>Status changed. Tap to refresh.</span>
                                        <button
                                          type="button"
                                          className="pane-explain__refresh-btn"
                                          onClick={() => loadExplain(p.pane_id, p.agent_status)}
                                          aria-label={`Refresh explanation for pane ${p.pane_id}`}
                                        >
                                          Refresh
                                        </button>
                                      </div>
                                    )}

                                    <div className="pane-explain__header">
                                      <span className="pane-explain__target-state">
                                        Why {explain.data.state || p.agent_status}?
                                      </span>
                                      {explain.data.agent && (
                                        <span className="pane-explain__agent-name">
                                          {explain.data.agent}
                                        </span>
                                      )}
                                    </div>

                                    {explain.data.matchedRule && (
                                      <div className="pane-explain__rule">
                                        <span className="pane-explain__rule-label">Matched Rule</span>
                                        <code className="pane-explain__rule-id">
                                          {explain.data.matchedRule.id}
                                        </code>
                                      </div>
                                    )}

                                    <div className="pane-explain__grid">
                                      {explain.data.matchedRule?.region && (
                                        <div className="pane-explain__diagnostic-item">
                                          <span className="pane-explain__diagnostic-key">Region</span>
                                          <span className="pane-explain__diagnostic-val">
                                            {formatRegionLabel(explain.data.matchedRule.region)}
                                          </span>
                                        </div>
                                      )}

                                      {explain.data.manifest && (
                                        <div className="pane-explain__diagnostic-item">
                                          <span className="pane-explain__diagnostic-key">Source</span>
                                          <span className="pane-explain__diagnostic-val">
                                            {formatManifestSource(explain.data.manifest.sourceKind, explain.data.manifest.version)}
                                          </span>
                                        </div>
                                      )}
                                    </div>

                                    {activeFlags.length > 0 && (
                                      <div className="pane-explain__flags">
                                        {activeFlags.map((flag) => (
                                          <span key={flag} className="pane-explain__flag-badge">
                                            {flag}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Drawer Footer: New Shell Tab */}
        <div className="drawer-sheet__footer">
          <button
            type="button"
            className="drawer-footer-row drawer-footer-row--action"
            onClick={() => {
              dispatchNewTab({ type: 'OPEN_NEW_TAB' })
            }}
            aria-label="Open new shell tab creation form"
          >
            <span className="drawer-footer-row__label">
              <Plus size={16} aria-hidden="true" />
              New Shell Tab
            </span>
            <span className="drawer-footer-row__status">
              <ChevronRight size={16} className="drawer-footer-row__chevron" aria-hidden="true" />
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default PaneDrawer
