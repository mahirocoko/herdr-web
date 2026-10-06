import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import { AlertTriangle, ChevronRight, X } from 'lucide-react'
import type { IPane, ITab, IWorkspace } from '@/types/herdr.ts'
import {
  orderBlockedPanes,
  resolveAttentionCloseFocusTarget,
} from '@/utils/action-target.ts'
import { formatTabLabel } from '@/utils/workspace-helpers.ts'
import Button from '@/components/ui/button.tsx'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet.tsx'

export interface IAttentionHorizonProps {
  blockedPanes: IPane[]
  currentWorkspaceId: string
  workspaces?: IWorkspace[]
  tabs?: ITab[]
  onJumpToPane: (paneId: string, workspaceId: string) => void
  fallbackFocusRef?: React.RefObject<HTMLElement | null>
}

const AttentionHorizon: FC<IAttentionHorizonProps> = ({
  blockedPanes,
  currentWorkspaceId,
  workspaces = [],
  tabs = [],
  onJumpToPane,
  fallbackFocusRef,
}) => {
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  const count = blockedPanes.length

  // Base UI Dialog handles focus containment, Escape dismissal, and outside click natively.
  // We keep close button initial focus and fallback focus restoration.
  useEffect(() => {
    if (!isSheetOpen) return

    const frame = requestAnimationFrame(() => {
      closeButtonRef.current?.focus()
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [isSheetOpen])

  const handleOpenSheet = () => {
    setIsSheetOpen(true)
  }

  const handleCloseSheet = () => {
    setIsSheetOpen(false)
    requestAnimationFrame(() => {
      const target = resolveAttentionCloseFocusTarget(
        actionTriggerRef.current,
        fallbackFocusRef?.current,
      )
      target?.focus()
    })
  }

  const handleSelectPane = (paneId: string, workspaceId: string) => {
    handleCloseSheet()
    onJumpToPane(paneId, workspaceId)
  }

  // If no blocked panes and sheet is not open, render nothing
  if (count === 0 && !isSheetOpen) {
    return null
  }

  const primaryBlocked = blockedPanes[0]
  const agentLabel = primaryBlocked
    ? primaryBlocked.display_agent || primaryBlocked.agent || 'Agent'
    : 'Agent'

  const orderedPanes = orderBlockedPanes(
    blockedPanes,
    currentWorkspaceId,
    workspaces,
    tabs,
  )

  return (
    <>
      {count > 0 && (
        <div className="attention-horizon" role="alert" aria-live="assertive">
          <div className="attention-horizon__content">
            <AlertTriangle
              size={16}
              className="attention-horizon__icon"
              aria-hidden="true"
            />
            <span className="attention-horizon__title">
              {count === 1 ? (
                <>
                  {agentLabel} in <code>{primaryBlocked.pane_id}</code> blocked
                </>
              ) : (
                <>{count} panes require attention</>
              )}
            </span>
          </div>

          {count === 1 ? (
            <Button
              ref={actionTriggerRef}
              size="sm"
              variant="warning"
              className="attention-horizon__jump-btn"
              onClick={() =>
                onJumpToPane(
                  primaryBlocked.pane_id,
                  primaryBlocked.workspace_id,
                )
              }
              aria-label={`Jump to blocked pane ${primaryBlocked.pane_id}`}
            >
              Jump
            </Button>
          ) : (
            <Button
              ref={actionTriggerRef}
              size="sm"
              variant="warning"
              className="attention-horizon__jump-btn attention-horizon__jump-btn--review"
              onClick={handleOpenSheet}
              aria-label={`Review ${count} blocked panes`}
              aria-expanded={isSheetOpen}
              aria-controls="attention-queue-sheet"
            >
              Review {count}
            </Button>
          )}
        </div>
      )}

      {/* Attention Queue Bottom Sheet */}
      <Sheet
        open={isSheetOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleCloseSheet()
          } else {
            setIsSheetOpen(true)
          }
        }}
      >
        <SheetContent
          id="attention-queue-sheet"
          side="bottom"
          className="drawer-sheet attention-queue-sheet"
          aria-label="Attention Queue"
        >

          <SheetHeader className="drawer-sheet__header">
            <SheetTitle className="drawer-sheet__title">
              Attention Queue{' '}
              {orderedPanes.length > 0 ? `(${orderedPanes.length})` : ''}
            </SheetTitle>
            <Button
              ref={closeButtonRef}
              variant="ghost"
              size="icon"
              className="drawer-sheet__close-btn"
              onClick={handleCloseSheet}
              aria-label="Close attention queue"
            >
              <X size={18} aria-hidden="true" />
            </Button>
          </SheetHeader>

          <div className="attention-queue-list">
            {orderedPanes.length === 0 ? (
              <div className="attention-queue-empty" role="status">
                <span>No panes currently require attention.</span>
              </div>
            ) : (
              orderedPanes.map((p) => {
                const ws = workspaces.find(
                  (w) => w.workspace_id === p.workspace_id,
                )
                const tab = tabs.find((t) => t.tab_id === p.tab_id)
                const wsLabel =
                  ws?.label ||
                  (ws?.number ? `Space ${ws.number}` : p.workspace_id)
                const tabLabel = tab ? formatTabLabel(tab) : `Tab ${p.tab_id}`
                const pAgent = p.display_agent || p.agent || 'Agent'
                const title = p.terminal_title_stripped || p.title || p.pane_id
                const isCurrentSpace = p.workspace_id === currentWorkspaceId

                return (
                  <Button
                    key={p.pane_id}
                    variant="ghost"
                    className="attention-queue-item"
                    onClick={() => handleSelectPane(p.pane_id, p.workspace_id)}
                    aria-label={`Jump to ${pAgent} in ${wsLabel}, ${tabLabel}, pane ${p.pane_id}`}
                  >
                    <div className="attention-queue-item__main">
                      <div className="attention-queue-item__meta">
                        <span className="attention-queue-item__space">
                          {wsLabel} {isCurrentSpace ? '(Current Space)' : ''}
                        </span>
                        <span className="attention-queue-item__tab">
                          {tabLabel}
                        </span>
                      </div>
                      <div className="attention-queue-item__identity">
                        <span className="attention-queue-item__agent">
                          {pAgent}
                        </span>
                        <code className="attention-queue-item__id">
                          {p.pane_id}
                        </code>
                        <span className="agent-status-tag agent-status--blocked">
                          blocked
                        </span>
                      </div>
                      <div className="attention-queue-item__title">{title}</div>
                    </div>

                    <div className="attention-queue-item__action">
                      <span className="attention-queue-item__action-text">
                        Jump
                      </span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </div>
                  </Button>
                )
              })
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export default AttentionHorizon
