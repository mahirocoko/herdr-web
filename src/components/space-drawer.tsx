import { useEffect, useRef, useState } from 'react'
import type { FC, FormEvent, ReactNode } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
  X
} from 'lucide-react'
import type { ILifecycleOperations } from '@/hooks/use-lifecycle-operations.ts'
import type {
  ILifecycleActionRequest,
  IPane,
  ISnapshotStatus,
  ITab,
  IWorkspace
} from '@/types/herdr.ts'
import {
  deriveWorkspaceSourceChoices,
  freezeWorkspaceCloseConfirmation,
  resolveWorkspaceSourceSelection,
  workspaceConfirmationChanged,
  type IWorkspaceCloseConfirmation
} from '@/utils/lifecycle-operations.ts'
import {
  formatWorkspaceAriaLabel,
  formatWorkspaceSourceLine
} from '@/utils/workspace-helpers.ts'
import {
  getConnectionStatusLabel,
  getStatusDotClass
} from '@/utils/connection-status.ts'

export interface ISpaceDrawerProps {
  isOpen: boolean
  status: ISnapshotStatus
  pushState?: string
  workspaces: IWorkspace[]
  tabs: ITab[]
  panes: IPane[]
  selectedWorkspaceId: string | null
  onSelectWorkspace: (workspaceId: string) => void
  onOpenSettings: () => void
  onClose: () => void
  onRefreshSnapshot?: () => Promise<boolean>
  lifecycle: ILifecycleOperations
  initialView?: 'list' | 'new-space'
}

type SpaceDrawerView = 'list' | 'new-space' | 'close-space' | 'status'

export const getNextSpaceDrawerFocusIndex = (
  currentIndex: number,
  totalCount: number,
  isShift: boolean
): number => {
  if (totalCount <= 0) return -1
  if (totalCount === 1) return 0
  if (currentIndex === -1) return isShift ? totalCount - 1 : 0
  return isShift
    ? (currentIndex - 1 + totalCount) % totalCount
    : (currentIndex + 1) % totalCount
}

export const getWorkspaceStatusDotClass = (status?: string): string => {
  switch (status) {
    case 'blocked':
      return 'space-status-dot--blocked'
    case 'working':
      return 'space-status-dot--working'
    case 'done':
      return 'space-status-dot--done'
    case 'idle':
      return 'space-status-dot--idle'
    default:
      return 'space-status-dot--unknown'
  }
}

const formatCount = (count: number, singular: string): string => (
  `${count} ${singular}${count === 1 ? '' : 's'}`
)

const SpaceDrawer: FC<ISpaceDrawerProps> = ({
  isOpen,
  status,
  pushState,
  workspaces,
  tabs,
  panes,
  selectedWorkspaceId,
  onSelectWorkspace,
  onOpenSettings,
  onClose,
  onRefreshSnapshot,
  lifecycle,
  initialView = 'list'
}) => {
  const drawerRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const activeWorkspaceRef = useRef<HTMLButtonElement | null>(null)
  const initiatingControlRef = useRef<HTMLElement | null>(null)
  const escapeHandlerRef = useRef<() => void>(() => undefined)

  const [view, setView] = useState<SpaceDrawerView>(initialView)
  const [workspaceLabel, setWorkspaceLabel] = useState('')
  const [workspaceSourceKey, setWorkspaceSourceKey] = useState('herdr-default')
  const [workspaceSourceError, setWorkspaceSourceError] = useState<string | null>(null)
  const [workspaceConfirmation, setWorkspaceConfirmation] = useState<IWorkspaceCloseConfirmation | null>(null)
  const [confirmationError, setConfirmationError] = useState<string | null>(null)

  const workspaceSourceChoices = deriveWorkspaceSourceChoices(workspaces, panes)
  const hasLifecycleGate = Boolean(lifecycle.ticket && lifecycle.ticket.phase !== 'rejected')

  useEffect(() => {
    if (!isOpen) return
    if (lifecycle.ticket && lifecycle.ticket.phase !== 'rejected') {
      setView('status')
    } else if (initialView === 'new-space') {
      setView('new-space')
    }
    const frame = requestAnimationFrame(() => {
      if (view === 'close-space') cancelButtonRef.current?.focus()
      else closeButtonRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [initialView, isOpen, lifecycle.ticket?.phase, view])

  useEffect(() => {
    if (!isOpen || !selectedWorkspaceId || view !== 'list') return
    const frame = requestAnimationFrame(() => {
      activeWorkspaceRef.current?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [isOpen, selectedWorkspaceId, view])

  useEffect(() => {
    if (workspaceSourceKey === 'herdr-default') {
      setWorkspaceSourceError(null)
      return
    }
    if (!workspaceSourceChoices.some((choice) => choice.key === workspaceSourceKey)) {
      setWorkspaceSourceError('The selected directory source is no longer available. Choose a current source before creating the Space.')
    }
  }, [workspaceSourceChoices, workspaceSourceKey])

  const handleClose = () => {
    setView('list')
    setConfirmationError(null)
    onClose()
  }

  const returnToList = () => {
    setView('list')
    setConfirmationError(null)
    requestAnimationFrame(() => initiatingControlRef.current?.focus())
  }

  const beginView = (nextView: 'new-space' | 'close-space', initiator: HTMLElement | null) => {
    initiatingControlRef.current = initiator
    setConfirmationError(null)
    setView(nextView)
  }

  escapeHandlerRef.current = () => {
    if (lifecycle.isBusy) {
      handleClose()
      return
    }
    if (view !== 'list') {
      returnToList()
      return
    }
    handleClose()
  }

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        escapeHandlerRef.current()
        return
      }

      if (event.key !== 'Tab') return
      const focusables = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      ).filter((element) => element.offsetParent !== null || element === closeButtonRef.current)
      const nextIndex = getNextSpaceDrawerFocusIndex(
        focusables.indexOf(document.activeElement as HTMLElement),
        focusables.length,
        event.shiftKey
      )
      if (nextIndex >= 0) {
        event.preventDefault()
        focusables[nextIndex].focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const handleCreateWorkspace = async (event: FormEvent) => {
    event.preventDefault()
    if (hasLifecycleGate) return
    const sourceSelection = resolveWorkspaceSourceSelection(workspaceSourceChoices, workspaceSourceKey)
    if (sourceSelection.kind === 'missing') {
      setWorkspaceSourceError('The selected directory source is no longer available. Choose a current source before creating the Space.')
      return
    }
    setWorkspaceSourceError(null)
    const request: ILifecycleActionRequest = {
      type: 'workspace-create',
      operationId: crypto.randomUUID(),
      ...(workspaceLabel.trim() ? { label: workspaceLabel.trim() } : {}),
      ...(sourceSelection.kind === 'source' ? { source: sourceSelection.source } : {})
    }
    const started = await lifecycle.dispatchLifecycle(request)
    if (started.accepted) setView('status')
  }

  const handleConfirmWorkspaceClose = async () => {
    if (!workspaceConfirmation || hasLifecycleGate) return
    if (workspaceConfirmationChanged(workspaceConfirmation, tabs, panes)) {
      const currentWorkspace = workspaces.find(
        (workspace) => workspace.workspace_id === workspaceConfirmation.workspaceId
      )
      setConfirmationError('Space membership changed. Review the updated counts, then confirm again.')
      setWorkspaceConfirmation(
        currentWorkspace ? freezeWorkspaceCloseConfirmation(currentWorkspace, tabs, panes) : null
      )
      return
    }
    const started = await lifecycle.dispatchLifecycle({
      type: 'workspace-close',
      operationId: crypto.randomUUID(),
      target: {
        workspaceId: workspaceConfirmation.workspaceId,
        expected: workspaceConfirmation.expected
      }
    })
    if (started.accepted) setView('status')
  }

  const handleInspectLifecycle = async () => {
    const refreshed = await onRefreshSnapshot?.()
    if (refreshed === true && lifecycle.ticket?.phase === 'unknown') {
      lifecycle.clearUnknownAfterRefresh()
      setView('list')
      return
    }
    if (refreshed !== true) {
      setConfirmationError('Snapshot refresh failed. The operation remains gated until inspection succeeds.')
    }
  }

  if (!isOpen) return null

  const renderShell = (title: string, body: ReactNode) => (
    <div className="side-drawer-overlay" onClick={handleClose} role="presentation">
      <div
        id="space-drawer"
        ref={drawerRef}
        className="space-drawer-sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="space-drawer-header space-drawer-header--nav">
          <button
            type="button"
            className="drawer-sheet__back-btn"
            onClick={returnToList}
            disabled={lifecycle.isBusy}
            aria-label="Back to Spaces"
          >
            <ChevronLeft size={18} aria-hidden="true" />
            <span>Back</span>
          </button>
          <span className="space-drawer-title">{title}</span>
          <button
            ref={closeButtonRef}
            type="button"
            className="side-drawer-close-btn"
            onClick={handleClose}
            aria-label={lifecycle.isBusy ? 'Close Spaces; operation continues checking' : 'Close Spaces'}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {body}
      </div>
    </div>
  )

  if (view === 'status' && lifecycle.ticket) {
    const ticket = lifecycle.ticket
    const statusMessage = ticket.phase === 'pending'
      ? 'Operation pending. You can close this sheet; it continues checking.'
      : ticket.phase === 'unknown'
        ? ticket.error || 'Outcome unknown. Refresh and inspect before another action.'
        : ticket.phase === 'reconciliation-failed'
          ? ticket.error || 'The server observed the action, but browser reconciliation was not confirmed.'
          : ticket.phase === 'rejected'
            ? ticket.error || 'The action was rejected.'
            : ticket.error || 'Action observed. Refreshing and reconciling the active session.'

    return renderShell('Lifecycle Status', (
      <div className="new-tab-form">
        <div className="new-tab-form__body">
          <div
            className={`new-tab-status ${ticket.phase === 'unknown' ? 'new-tab-status--unknown' : ticket.phase === 'rejected' || ticket.phase === 'reconciliation-failed' ? 'new-tab-status--error' : ''}`}
            role="status"
            aria-live="polite"
          >
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
              Return to Spaces
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

  if (view === 'new-space') {
    return renderShell('New Space', (
      <form className="new-tab-form" onSubmit={handleCreateWorkspace}>
        <div className="new-tab-form__body">
          <div className="new-tab-field">
            <label htmlFor="new-space-label" className="new-tab-field__label">Space Label (optional)</label>
            <input
              id="new-space-label"
              className="new-tab-field__input"
              type="text"
              maxLength={100}
              value={workspaceLabel}
              onChange={(event) => setWorkspaceLabel(event.target.value)}
              disabled={lifecycle.isBusy}
              placeholder="e.g. project, review, experiments"
            />
          </div>
          <div className="new-tab-field">
            <label htmlFor="new-space-source" className="new-tab-field__label">Directory Source</label>
            <select
              id="new-space-source"
              className="new-tab-field__select"
              value={workspaceSourceKey}
              onChange={(event) => {
                setWorkspaceSourceKey(event.target.value)
                setWorkspaceSourceError(null)
              }}
              disabled={lifecycle.isBusy}
            >
              {workspaceSourceChoices.map((choice) => (
                <option key={choice.key} value={choice.key}>{choice.label}</option>
              ))}
            </select>
            {workspaceSourceError && (
              <div className="new-tab-status new-tab-status--error" role="alert">{workspaceSourceError}</div>
            )}
          </div>
        </div>
        <div className="new-tab-form__footer lifecycle-form__actions">
          <button ref={cancelButtonRef} type="button" className="lifecycle-cancel-btn" onClick={returnToList} disabled={lifecycle.isBusy}>Cancel</button>
          <button type="submit" className="new-tab-submit-btn" disabled={hasLifecycleGate}>
            {lifecycle.isBusy ? 'Creating Space...' : 'Create Space'}
          </button>
        </div>
      </form>
    ))
  }

  if (view === 'close-space' && workspaceConfirmation) {
    return renderShell('Close Space', (
      <div className="new-tab-form">
        <div className="new-tab-form__body lifecycle-confirmation">
          <p><strong>{workspaceConfirmation.label}</strong></p>
          <code>{workspaceConfirmation.workspaceId}</code>
          <p>This closes all {workspaceConfirmation.tabCount} current Tabs and {workspaceConfirmation.paneCount} panes. Running shells or agents may be interrupted, and unsaved work may be lost.</p>
          {workspaces.length === 1 && <p>This is the last Space. A new Space can be created afterward.</p>}
          {confirmationError && <div className="new-tab-status new-tab-status--error" role="alert">{confirmationError}</div>}
        </div>
        <div className="new-tab-form__footer lifecycle-form__actions">
          <button ref={cancelButtonRef} type="button" className="lifecycle-cancel-btn" onClick={returnToList}>Cancel</button>
          <button type="button" className="lifecycle-danger-btn" onClick={handleConfirmWorkspaceClose} disabled={lifecycle.isBusy}>Close Space</button>
        </div>
      </div>
    ))
  }

  return (
    <div className="side-drawer-overlay" onClick={handleClose} role="presentation">
      <div
        id="space-drawer"
        ref={drawerRef}
        className="space-drawer-sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Spaces"
      >
        <div className="space-drawer-header">
          <span className="space-drawer-title">spaces</span>
          <button
            ref={closeButtonRef}
            type="button"
            className="side-drawer-close-btn"
            onClick={handleClose}
            aria-label="Close Spaces"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <ul className="space-drawer-list" aria-label="Herdr Spaces">
          {workspaces.map((workspace) => {
            const isSelected = workspace.workspace_id === selectedWorkspaceId
            const label = workspace.label || `Space ${workspace.number}`
            const metadata = `${formatCount(workspace.tab_count, 'Tab')} · ${formatCount(workspace.pane_count, 'pane')}`
            const sourceLine = formatWorkspaceSourceLine(workspace)
            const ariaLabel = formatWorkspaceAriaLabel(workspace, label, metadata)
            return (
              <li key={workspace.workspace_id} className="space-drawer-list__item">
                <button
                  ref={isSelected ? activeWorkspaceRef : undefined}
                  type="button"
                  className={`space-drawer-item ${isSelected ? 'space-drawer-item--selected' : ''}`}
                  onClick={() => {
                    onSelectWorkspace(workspace.workspace_id)
                    handleClose()
                  }}
                  aria-current={isSelected ? 'page' : undefined}
                  aria-label={ariaLabel}
                >
                  <span className={`space-status-dot ${getWorkspaceStatusDotClass(workspace.agent_status)}`} aria-hidden="true" />
                  <span className="space-drawer-item__content">
                    <span className="space-drawer-item__label">{label}</span>
                    {sourceLine && <span className="space-drawer-item__source">{sourceLine}</span>}
                    <span className="space-drawer-item__meta">{metadata}</span>
                  </span>
                  {isSelected && <Check size={16} className="space-drawer-item__check" aria-hidden="true" />}
                </button>
              </li>
            )
          })}
          {workspaces.length === 0 && (
            <li className="space-drawer-empty">No active Spaces</li>
          )}
        </ul>

        <div className="space-drawer-actions" aria-label="Space lifecycle actions">
          <button
            type="button"
            className="space-drawer-action"
            onClick={(event) => beginView('new-space', event.currentTarget)}
            disabled={hasLifecycleGate}
          >
            <Plus size={16} aria-hidden="true" />
            <span>New Space</span>
          </button>
          {selectedWorkspaceId && workspaces.some((workspace) => workspace.workspace_id === selectedWorkspaceId) && (
            <button
              type="button"
              className="space-drawer-action space-drawer-action--danger"
              onClick={(event) => {
                const workspace = workspaces.find((item) => item.workspace_id === selectedWorkspaceId)
                if (!workspace) return
                setWorkspaceConfirmation(freezeWorkspaceCloseConfirmation(workspace, tabs, panes))
                beginView('close-space', event.currentTarget)
              }}
              disabled={hasLifecycleGate}
            >
              <Trash2 size={16} aria-hidden="true" />
              <span>Close Space</span>
            </button>
          )}
        </div>

        <div className="space-drawer-footer">
          <div
            className="space-drawer-connection"
            role="status"
            aria-live="polite"
            aria-label={`Connection status: ${getConnectionStatusLabel(status)}`}
          >
            <span className="space-drawer-footer__label">Connection</span>
            <span className="space-drawer-footer__value">
              <span className={`status-dot ${getStatusDotClass(status)}`} aria-hidden="true" />
              {getConnectionStatusLabel(status)}
            </span>
          </div>
          <button
            type="button"
            className="space-drawer-settings"
            onClick={() => {
              handleClose()
              onOpenSettings()
            }}
            aria-label="Open push notification settings"
          >
            <span>Push Notifications</span>
            <span className="space-drawer-settings__status">
              <span>{pushState === 'active' ? 'Active' : 'Off'}</span>
              <ChevronRight size={16} aria-hidden="true" />
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default SpaceDrawer
