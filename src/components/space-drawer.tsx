import { useEffect, useRef, useState } from 'react'
import type { FC, FormEvent } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import Button from '@/components/ui/button.tsx'
import Input from '@/components/ui/input.tsx'
import Select from '@/components/ui/select.tsx'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet.tsx'
import type { ILifecycleOperations } from '@/hooks/use-lifecycle-operations.ts'
import type {
  ILifecycleActionRequest,
  IPane,
  ISnapshotStatus,
  ITab,
  IWorkspace,
} from '@/types/herdr.ts'
import {
  deriveWorkspaceSourceChoices,
  freezeWorkspaceCloseConfirmation,
  resolveWorkspaceSourceSelection,
  workspaceConfirmationChanged,
  type IWorkspaceCloseConfirmation,
} from '@/utils/lifecycle-operations.ts'
import {
  formatWorkspaceAriaLabel,
  formatWorkspaceSourceLine,
} from '@/utils/workspace-helpers.ts'
import {
  ACTIVITY_LABEL,
  deriveSpaceActivity,
  getActivityStatusDotClass,
} from '@/utils/activity-status.ts'
import {
  getConnectionStatusLabel,
  getStatusDotClass,
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
  initialView?: 'list' | 'new-space' | 'close-space'
  initialTargetWorkspaceId?: string | null
}

type SpaceDrawerView = 'list' | 'new-space' | 'close-space' | 'status'

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

const formatCount = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? '' : 's'}`

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
  initialView = 'list',
  initialTargetWorkspaceId,
}) => {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const activeWorkspaceRef = useRef<HTMLButtonElement | null>(null)
  const initiatingControlRef = useRef<HTMLElement | null>(null)
  const initializedIntentRef = useRef<string | null>(null)

  const [view, setView] = useState<SpaceDrawerView>(initialView)
  const [workspaceLabel, setWorkspaceLabel] = useState('')
  const [workspaceSourceKey, setWorkspaceSourceKey] = useState('herdr-default')
  const [workspaceSourceError, setWorkspaceSourceError] = useState<
    string | null
  >(null)
  const [workspaceConfirmation, setWorkspaceConfirmation] =
    useState<IWorkspaceCloseConfirmation | null>(null)
  const [confirmationError, setConfirmationError] = useState<string | null>(
    null,
  )

  const workspaceSourceChoices = deriveWorkspaceSourceChoices(workspaces, panes)
  const hasLifecycleGate = Boolean(
    lifecycle.ticket && lifecycle.ticket.phase !== 'rejected',
  )

  useEffect(() => {
    if (!isOpen) {
      initializedIntentRef.current = null
      return
    }
    if (lifecycle.ticket && lifecycle.ticket.phase !== 'rejected') {
      setView('status')
      return
    }
    // Capture an opening intent once: polling must not re-freeze confirmation
    // membership or reopen a subview after the user cancels/backtracks.
    const intentKey = `${initialView}:${initialTargetWorkspaceId ?? ''}`
    if (initializedIntentRef.current === intentKey) return
    initializedIntentRef.current = intentKey
    if (initialView === 'new-space') {
      setView('new-space')
    } else if (initialView === 'close-space') {
      const targetWsId = initialTargetWorkspaceId || selectedWorkspaceId
      const target = workspaces.find((w) => w.workspace_id === targetWsId)
      if (target) {
        setWorkspaceConfirmation(
          freezeWorkspaceCloseConfirmation(target, tabs, panes),
        )
        setView('close-space')
      } else {
        setView('list')
      }
    } else {
      setView('list')
    }
  }, [
    initialTargetWorkspaceId,
    initialView,
    isOpen,
    lifecycle.ticket?.phase,
    panes,
    selectedWorkspaceId,
    tabs,
    workspaces,
  ])

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
    if (
      !workspaceSourceChoices.some(
        (choice) => choice.key === workspaceSourceKey,
      )
    ) {
      setWorkspaceSourceError(
        'The selected directory source is no longer available. Choose a current source before creating the Space.',
      )
    }
  }, [workspaceSourceChoices, workspaceSourceKey])

  const handleClose = () => {
    setView('list')
    setConfirmationError(null)
    setWorkspaceConfirmation(null)
    onClose()
  }

  const returnToList = () => {
    setView('list')
    setConfirmationError(null)
    setWorkspaceConfirmation(null)
    requestAnimationFrame(() => initiatingControlRef.current?.focus())
  }

  const beginView = (
    nextView: 'new-space' | 'close-space',
    initiator: HTMLElement | null,
  ) => {
    initiatingControlRef.current = initiator
    setConfirmationError(null)
    setView(nextView)
  }

  const handleCreateWorkspace = async (event: FormEvent) => {
    event.preventDefault()
    if (hasLifecycleGate) return
    const sourceSelection = resolveWorkspaceSourceSelection(
      workspaceSourceChoices,
      workspaceSourceKey,
    )
    if (sourceSelection.kind === 'missing') {
      setWorkspaceSourceError(
        'The selected directory source is no longer available. Choose a current source before creating the Space.',
      )
      return
    }
    setWorkspaceSourceError(null)
    const request: ILifecycleActionRequest = {
      type: 'workspace-create',
      operationId: crypto.randomUUID(),
      ...(workspaceLabel.trim() ? { label: workspaceLabel.trim() } : {}),
      ...(sourceSelection.kind === 'source'
        ? { source: sourceSelection.source }
        : {}),
    }
    const started = await lifecycle.dispatchLifecycle(request)
    if (started.accepted) setView('status')
  }

  const handleConfirmWorkspaceClose = async () => {
    if (!workspaceConfirmation || hasLifecycleGate) return
    if (workspaceConfirmationChanged(workspaceConfirmation, tabs, panes)) {
      const currentWorkspace = workspaces.find(
        (workspace) =>
          workspace.workspace_id === workspaceConfirmation.workspaceId,
      )
      setConfirmationError(
        'Space membership changed. Review the updated counts, then confirm again.',
      )
      setWorkspaceConfirmation(
        currentWorkspace
          ? freezeWorkspaceCloseConfirmation(currentWorkspace, tabs, panes)
          : null,
      )
      return
    }
    const started = await lifecycle.dispatchLifecycle({
      type: 'workspace-close',
      operationId: crypto.randomUUID(),
      target: {
        workspaceId: workspaceConfirmation.workspaceId,
        expected: workspaceConfirmation.expected,
      },
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
      setConfirmationError(
        'Snapshot refresh failed. The operation remains gated until inspection succeeds.',
      )
    }
  }

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          handleClose()
        }
      }}
    >
      <SheetContent
        id="space-drawer"
        side="left"
        className="space-drawer-sheet"
        aria-label="Spaces"
        initialFocus={view === 'close-space' ? cancelButtonRef : closeButtonRef}
      >
        {view === 'status' && lifecycle.ticket && (
          <>
            <SheetHeader className="space-drawer-header space-drawer-header--nav">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="drawer-sheet__back-btn"
                onClick={returnToList}
                disabled={lifecycle.isBusy}
                aria-label="Back to Spaces"
              >
                <ChevronLeft size={18} aria-hidden="true" />
                <span>Back</span>
              </Button>
              <SheetTitle className="space-drawer-title">
                Lifecycle Status
              </SheetTitle>
              <Button
                ref={closeButtonRef}
                type="button"
                variant="ghost"
                size="icon"
                className="side-drawer-close-btn"
                onClick={handleClose}
                aria-label={
                  lifecycle.isBusy
                    ? 'Close Spaces; operation continues checking'
                    : 'Close Spaces'
                }
              >
                <X size={18} aria-hidden="true" />
              </Button>
            </SheetHeader>
            <div className="new-tab-form">
              <div className="new-tab-form__body">
                <div
                  className={`new-tab-status ${lifecycle.ticket.phase === 'unknown' ? 'new-tab-status--unknown' : lifecycle.ticket.phase === 'rejected' || lifecycle.ticket.phase === 'reconciliation-failed' ? 'new-tab-status--error' : ''}`}
                  role="status"
                  aria-live="polite"
                >
                  <div className="new-tab-status__content">
                    {(lifecycle.ticket.phase === 'pending' ||
                      lifecycle.ticket.phase === 'observed') && (
                      <Loader2 size={16} className="spin" aria-hidden="true" />
                    )}
                    {lifecycle.ticket.phase !== 'pending' &&
                      lifecycle.ticket.phase !== 'observed' && (
                        <AlertTriangle size={16} aria-hidden="true" />
                      )}
                    <span>
                      {lifecycle.ticket.phase === 'pending'
                        ? 'Operation pending. You can close this sheet; it continues checking.'
                        : lifecycle.ticket.phase === 'unknown'
                          ? lifecycle.ticket.error ||
                            'Outcome unknown. Refresh and inspect before another action.'
                          : lifecycle.ticket.phase === 'reconciliation-failed'
                            ? lifecycle.ticket.error ||
                              'The server observed the action, but browser reconciliation was not confirmed.'
                            : lifecycle.ticket.phase === 'rejected'
                              ? lifecycle.ticket.error ||
                                'The action was rejected.'
                              : lifecycle.ticket.error ||
                                'Action observed. Refreshing and reconciling the active session.'}
                    </span>
                  </div>
                </div>
                <div className="lifecycle-ticket-details">
                  <span>{lifecycle.ticket.type}</span>
                  <code>{lifecycle.ticket.operationId}</code>
                </div>
                {confirmationError && (
                  <div
                    className="new-tab-status new-tab-status--error"
                    role="alert"
                  >
                    {confirmationError}
                  </div>
                )}
              </div>
              <div className="new-tab-form__footer lifecycle-form__actions">
                {lifecycle.ticket.phase === 'unknown' && (
                  <Button
                    type="button"
                    variant="default"
                    className="new-tab-submit-btn"
                    onClick={handleInspectLifecycle}
                  >
                    Refresh and inspect
                  </Button>
                )}
                {lifecycle.ticket.phase === 'reconciliation-failed' && (
                  <Button
                    type="button"
                    variant="default"
                    className="new-tab-submit-btn"
                    onClick={() =>
                      lifecycle.retryReconciliation(
                        lifecycle.ticket!.requestIdentity,
                      )
                    }
                  >
                    Refresh and inspect
                  </Button>
                )}
                {lifecycle.ticket.phase === 'rejected' && (
                  <Button
                    type="button"
                    variant="default"
                    className="new-tab-submit-btn"
                    onClick={returnToList}
                  >
                    Return to Spaces
                  </Button>
                )}
                {lifecycle.ticket.phase === 'pending' && (
                  <Button
                    type="button"
                    variant="outline"
                    className="lifecycle-cancel-btn"
                    onClick={handleClose}
                  >
                    Dismiss — operation continues
                  </Button>
                )}
              </div>
            </div>
          </>
        )}

        {view === 'new-space' && (
          <>
            <SheetHeader className="space-drawer-header space-drawer-header--nav">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="drawer-sheet__back-btn"
                onClick={returnToList}
                disabled={lifecycle.isBusy}
                aria-label="Back to Spaces"
              >
                <ChevronLeft size={18} aria-hidden="true" />
                <span>Back</span>
              </Button>
              <SheetTitle className="space-drawer-title">New Space</SheetTitle>
              <Button
                ref={closeButtonRef}
                type="button"
                variant="ghost"
                size="icon"
                className="side-drawer-close-btn"
                onClick={handleClose}
                aria-label={
                  lifecycle.isBusy
                    ? 'Close Spaces; operation continues checking'
                    : 'Close Spaces'
                }
              >
                <X size={18} aria-hidden="true" />
              </Button>
            </SheetHeader>
            <form className="new-tab-form" onSubmit={handleCreateWorkspace}>
              <div className="new-tab-form__body">
                <div className="new-tab-field">
                  <label
                    htmlFor="new-space-label"
                    className="new-tab-field__label"
                  >
                    Space Label (optional)
                  </label>
                  <Input
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
                  <label
                    htmlFor="new-space-source"
                    className="new-tab-field__label"
                  >
                    Directory Source
                  </label>
                  <Select
                    id="new-space-source"
                    value={workspaceSourceKey}
                    onValueChange={(val) => {
                      setWorkspaceSourceKey(val)
                      setWorkspaceSourceError(null)
                    }}
                    items={workspaceSourceChoices.map((choice) => ({
                      value: choice.key,
                      label: choice.label,
                    }))}
                    placeholder="Select directory source..."
                    disabled={lifecycle.isBusy}
                    aria-label="Directory Source"
                  />
                  {workspaceSourceError && (
                    <div
                      className="new-tab-status new-tab-status--error"
                      role="alert"
                    >
                      {workspaceSourceError}
                    </div>
                  )}
                </div>
              </div>
              <div className="new-tab-form__footer lifecycle-form__actions">
                <Button
                  ref={cancelButtonRef}
                  type="button"
                  variant="outline"
                  className="lifecycle-cancel-btn"
                  onClick={returnToList}
                  disabled={lifecycle.isBusy}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="default"
                  className="new-tab-submit-btn"
                  disabled={hasLifecycleGate}
                >
                  {lifecycle.isBusy ? 'Creating Space...' : 'Create Space'}
                </Button>
              </div>
            </form>
          </>
        )}

        {view === 'close-space' && workspaceConfirmation && (
          <>
            <SheetHeader className="space-drawer-header space-drawer-header--nav">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="drawer-sheet__back-btn"
                onClick={returnToList}
                disabled={lifecycle.isBusy}
                aria-label="Back to Spaces"
              >
                <ChevronLeft size={18} aria-hidden="true" />
                <span>Back</span>
              </Button>
              <SheetTitle className="space-drawer-title">
                Close Space
              </SheetTitle>
              <Button
                ref={closeButtonRef}
                type="button"
                variant="ghost"
                size="icon"
                className="side-drawer-close-btn"
                onClick={handleClose}
                aria-label={
                  lifecycle.isBusy
                    ? 'Close Spaces; operation continues checking'
                    : 'Close Spaces'
                }
              >
                <X size={18} aria-hidden="true" />
              </Button>
            </SheetHeader>
            <div className="new-tab-form">
              <div className="new-tab-form__body lifecycle-confirmation">
                <p>
                  <strong>{workspaceConfirmation.label}</strong>
                </p>
                <code>{workspaceConfirmation.workspaceId}</code>
                <p>
                  This closes all {workspaceConfirmation.tabCount} current Tabs
                  and {workspaceConfirmation.paneCount} panes. Running shells or
                  agents may be interrupted, and unsaved work may be lost.
                </p>
                {workspaces.length === 1 && (
                  <p>
                    This is the last Space. A new Space can be created
                    afterward.
                  </p>
                )}
                {confirmationError && (
                  <div
                    className="new-tab-status new-tab-status--error"
                    role="alert"
                  >
                    {confirmationError}
                  </div>
                )}
              </div>
              <div className="new-tab-form__footer lifecycle-form__actions">
                <Button
                  ref={cancelButtonRef}
                  type="button"
                  variant="outline"
                  className="lifecycle-cancel-btn"
                  onClick={returnToList}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className="lifecycle-danger-btn"
                  onClick={handleConfirmWorkspaceClose}
                  disabled={lifecycle.isBusy}
                >
                  Close Space
                </Button>
              </div>
            </div>
          </>
        )}

        {view === 'list' && (
          <>
            <SheetHeader className="space-drawer-header">
              <SheetTitle className="space-drawer-title">spaces</SheetTitle>
              <Button
                ref={closeButtonRef}
                type="button"
                variant="ghost"
                size="icon"
                className="side-drawer-close-btn"
                onClick={handleClose}
                aria-label="Close Spaces"
              >
                <X size={18} aria-hidden="true" />
              </Button>
            </SheetHeader>

            <ul className="space-drawer-list" aria-label="Herdr Spaces">
              {workspaces.map((workspace) => {
                const isSelected =
                  workspace.workspace_id === selectedWorkspaceId
                const label = workspace.label || `Space ${workspace.number}`
                const metadata = `${formatCount(workspace.tab_count, 'Tab')} · ${formatCount(workspace.pane_count, 'pane')}`
                const sourceLine = formatWorkspaceSourceLine(workspace)
                const spaceActivity = deriveSpaceActivity(
                  panes,
                  workspace.workspace_id,
                  tabs,
                )
                const ariaLabel = formatWorkspaceAriaLabel(
                  workspace,
                  label,
                  metadata,
                  spaceActivity,
                )
                return (
                  <li
                    key={workspace.workspace_id}
                    className="space-drawer-list__item"
                  >
                    <Button
                      ref={isSelected ? activeWorkspaceRef : undefined}
                      type="button"
                      variant="ghost"
                      className={`space-drawer-item ${isSelected ? 'space-drawer-item--selected' : ''}`}
                      onClick={() => {
                        onSelectWorkspace(workspace.workspace_id)
                        handleClose()
                      }}
                      aria-current={isSelected ? 'page' : undefined}
                      aria-label={ariaLabel}
                      title={`${label} · Activity: ${ACTIVITY_LABEL[spaceActivity]} (Native attention: ${workspace.agent_status || 'unknown'})`}
                    >
                      <span
                        className={`space-status-dot ${getActivityStatusDotClass(spaceActivity)}`}
                        aria-hidden="true"
                      />
                      <span className="space-drawer-item__content">
                        <span className="space-drawer-item__label">
                          {label}
                        </span>
                        {sourceLine && (
                          <span className="space-drawer-item__source">
                            {sourceLine}
                          </span>
                        )}
                        <span className="space-drawer-item__meta">
                          {metadata}
                        </span>
                      </span>
                      {isSelected && (
                        <Check
                          size={16}
                          className="space-drawer-item__check"
                          aria-hidden="true"
                        />
                      )}
                    </Button>
                  </li>
                )
              })}
              {workspaces.length === 0 && (
                <li className="space-drawer-empty">No active Spaces</li>
              )}
            </ul>

            <div
              className="space-drawer-actions"
              aria-label="Space lifecycle actions"
            >
              <Button
                type="button"
                variant="secondary"
                className="space-drawer-action"
                onClick={(event) => beginView('new-space', event.currentTarget)}
                disabled={hasLifecycleGate}
              >
                <Plus size={16} aria-hidden="true" />
                <span>New Space</span>
              </Button>
              {selectedWorkspaceId &&
                workspaces.some(
                  (workspace) => workspace.workspace_id === selectedWorkspaceId,
                ) && (
                  <Button
                    type="button"
                    variant="danger"
                    className="space-drawer-action space-drawer-action--danger"
                    onClick={(event) => {
                      const workspace = workspaces.find(
                        (item) => item.workspace_id === selectedWorkspaceId,
                      )
                      if (!workspace) return
                      setWorkspaceConfirmation(
                        freezeWorkspaceCloseConfirmation(
                          workspace,
                          tabs,
                          panes,
                        ),
                      )
                      beginView('close-space', event.currentTarget)
                    }}
                    disabled={hasLifecycleGate}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    <span>Close Space</span>
                  </Button>
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
                  <span
                    className={`status-dot ${getStatusDotClass(status)}`}
                    aria-hidden="true"
                  />
                  {getConnectionStatusLabel(status)}
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
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
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

export default SpaceDrawer
