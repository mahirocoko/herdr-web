import { useEffect } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import type { IAppOutletContext } from '../root.tsx'
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
    const exists = snapshot.workspaces.some((w) => w.workspace_id === selectedWorkspaceId)
    if (exists) return selectedWorkspaceId
  }

  // 2. Focused pane's workspace
  const focused = selectFocusedPaneFromSnapshot(snapshot)
  if (focused && focused.workspace_id) {
    const exists = snapshot.workspaces.some((w) => w.workspace_id === focused.workspace_id)
    if (exists) return focused.workspace_id
  }

  // 3. Blocked pane's workspace
  const blocked = snapshot.panes?.find((p) => p.agent_status === 'blocked')
  if (blocked && blocked.workspace_id) {
    const exists = snapshot.workspaces.some((w) => w.workspace_id === blocked.workspace_id)
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
    viewportGeometry
  } = useOutletContext<IAppOutletContext>()
  const navigate = useNavigate()

  useEffect(() => {
    if (status !== 'connected' || !snapshot) return
    const targetWsId = resolveAuthoritativeWorkspaceId(snapshot, selectedWorkspaceId)
    if (targetWsId) {
      navigate('/spaces/' + encodeURIComponent(targetWsId), { replace: true })
    }
  }, [status, snapshot, selectedWorkspaceId, navigate])

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
    <div className="herdr-app" style={appStyle}>
      {status === 'loading' && (
        <div className="herdr-empty-canvas">
          <span>Loading Herdr session...</span>
        </div>
      )}

      {status === 'error' && snapshotError && (
        <div className="system-banner system-banner--error" role="alert">
          <span>Failed to connect to Herdr daemon: {snapshotError}</span>
          <button
            type="button"
            className="system-banner__retry"
            onClick={() => refreshSnapshot()}
          >
            Retry
          </button>
        </div>
      )}

      {status === 'empty' && (
        <div className="system-banner system-banner--empty">
          <span>No active Herdr workspaces or panes discovered.</span>
        </div>
      )}
    </div>
  )
}

export default IndexRoute
