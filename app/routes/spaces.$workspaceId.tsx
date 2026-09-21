import { useParams, useNavigate } from 'react-router'
import SpaceDashboard from '@/app.tsx'
import { isValidWorkspaceId } from '@/utils/push-orchestration.ts'

export const resolveSpaceRouteParam = (rawWorkspaceId?: string | null): string | null => {
  if (typeof rawWorkspaceId !== 'string') return null
  const trimmed = rawWorkspaceId.trim()
  return isValidWorkspaceId(trimmed) ? trimmed : null
}

const SpaceRoute = () => {
  const { workspaceId: rawWorkspaceId } = useParams()
  const navigate = useNavigate()
  const workspaceId = resolveSpaceRouteParam(rawWorkspaceId)

  if (!workspaceId) {
    return (
      <div className="herdr-app">
        <div className="system-banner system-banner--error" role="alert">
          <span>Invalid Space identifier: "{rawWorkspaceId || ''}"</span>
        </div>
        <div className="herdr-empty-canvas">
          <button
            type="button"
            className="system-banner__retry"
            onClick={() => navigate('/', { replace: true })}
          >
            Return to Active Space
          </button>
        </div>
      </div>
    )
  }

  return <SpaceDashboard workspaceId={workspaceId} />
}

export default SpaceRoute
