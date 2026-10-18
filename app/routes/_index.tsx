import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import type { IAppOutletContext } from '../root.tsx'
import SpaceDrawer from '@/components/space-drawer.tsx'
import Button from '@/components/ui/button.tsx'
import { snapshotReadNotice } from '@/utils/readiness-copy.ts'
import { ownsIndexCreatePresentation } from '@/utils/lifecycle-operations.ts'
import { selectFocusedPaneFromSnapshot } from '@/utils/workspace-helpers.ts'

export const resolveAuthoritativeWorkspaceId = (
  snapshot: IAppOutletContext['snapshot'],
  selectedWorkspaceId: string | null
): string | null => {
  if (!snapshot || !snapshot.workspaces || snapshot.workspaces.length === 0) {
    return null
  }

  // 1. Existing selection if still present
  if (selectedWorkspaceId) {
    const exists = snapshot.workspaces.some(
      (w) => w.workspace_id === selectedWorkspaceId
    )
    if (exists) return selectedWorkspaceId
  }

  // 2. Focused pane's workspace
  const focused = selectFocusedPaneFromSnapshot(snapshot)
  if (focused && focused.workspace_id) {
    const exists = snapshot.workspaces.some(
      (w) => w.workspace_id === focused.workspace_id
    )
    if (exists) return focused.workspace_id
  }

  // 3. Blocked pane's workspace
  const blocked = snapshot.panes?.find((p) => p.agent_status === 'blocked')
  if (blocked && blocked.workspace_id) {
    const exists = snapshot.workspaces.some(
      (w) => w.workspace_id === blocked.workspace_id
    )
    if (exists) return blocked.workspace_id
  }

  // 4. First workspace
  return snapshot.workspaces[0].workspace_id
}

const IndexRoute = () => {
  const {
    snapshot,
    status,
    snapshotError,
    selectedWorkspaceId,
    refreshSnapshot,
    lifecycle,
    push,
    viewportGeometry,
    menuTriggerRef
  } = useOutletContext<IAppOutletContext>()
  const navigate = useNavigate()
  const [isNewSpaceOpen, setIsNewSpaceOpen] = useState(false)

  const ownsCreatePresentation = ownsIndexCreatePresentation(
    isNewSpaceOpen,
    lifecycle.ticket
  )

  useEffect(() => {
    if (ownsCreatePresentation || status !== 'connected' || !snapshot) return
    const targetWsId = resolveAuthoritativeWorkspaceId(
      snapshot,
      selectedWorkspaceId
    )
    if (targetWsId) {
      navigate('/spaces/' + encodeURIComponent(targetWsId), { replace: true })
    }
  }, [ownsCreatePresentation, status, snapshot, selectedWorkspaceId, navigate])

  const appStyle = viewportGeometry
    ? {
        height: `${viewportGeometry.height}px`,
        transform:
          viewportGeometry.offsetTop > 0
            ? `translateY(${viewportGeometry.offsetTop}px)`
            : undefined
      }
    : undefined

  return (
    <div
      className="herdr-app"
      style={appStyle}
      data-keyboard-open={viewportGeometry?.isKeyboardOpen ? 'true' : undefined}
    >
      {status === 'loading' && (
        <div className="herdr-empty-canvas">
          <span role="status">
            Reading Herdr snapshot… Spaces will appear when available.
          </span>
        </div>
      )}

      {(status === 'error' || status === 'reconnecting') && (
        <div className="system-banner system-banner--error" role="status">
          <span>{snapshotReadNotice(status, snapshotError)}</span>
          <Button
            type="button"
            variant="outline"
            className="system-banner__retry"
            onClick={() => refreshSnapshot()}
          >
            Refresh snapshot
          </Button>
        </div>
      )}

      {(status === 'empty' ||
        (status === 'connected' && ownsCreatePresentation)) && (
        <div className="herdr-empty-canvas herdr-empty-canvas--actions">
          <div className="system-banner system-banner--empty">
            <span>
              {lifecycle.ticket
                ? 'Space operation status is available. Inspect before another action.'
                : snapshotReadNotice(status, snapshotError)}
            </span>
          </div>
          <Button
            ref={menuTriggerRef}
            type="button"
            className="system-banner__retry"
            onClick={() => setIsNewSpaceOpen(true)}
          >
            {lifecycle.ticket ? 'View operation status' : 'New Space'}
          </Button>
          {snapshot && snapshot.workspaces.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                const target = resolveAuthoritativeWorkspaceId(
                  snapshot,
                  selectedWorkspaceId
                )
                if (target) navigate('/spaces/' + encodeURIComponent(target))
              }}
            >
              Open current Space
            </Button>
          )}
          <Button variant="outline" onClick={() => refreshSnapshot()}>
            Refresh snapshot
          </Button>
        </div>
      )}

      <SpaceDrawer
        isOpen={isNewSpaceOpen}
        initialView={lifecycle.ticket ? 'status' : 'new-space'}
        status={status}
        pushState={push.state}
        workspaces={snapshot?.workspaces || []}
        tabs={snapshot?.tabs || []}
        panes={snapshot?.panes || []}
        selectedWorkspaceId={selectedWorkspaceId}
        onSelectWorkspace={(workspaceId) =>
          navigate('/spaces/' + encodeURIComponent(workspaceId))
        }
        onOpenSettings={() =>
          navigate('/settings', { state: { appOwned: true } })
        }
        onClose={() => {
          setIsNewSpaceOpen(false)
          requestAnimationFrame(() => menuTriggerRef.current?.focus())
        }}
        onRefreshSnapshot={refreshSnapshot}
        lifecycle={lifecycle}
      />
    </div>
  )
}

export default IndexRoute
