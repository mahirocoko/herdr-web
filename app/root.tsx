import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigate
} from 'react-router'
import { useSnapshot } from '@/hooks/use-snapshot.ts'
import { usePushSubscription } from '@/hooks/use-push-subscription.ts'
import { useVisualViewport } from '@/hooks/use-visual-viewport.ts'
import type { IPane, ISnapshotResult, ISnapshotStatus } from '@/types/herdr.ts'
import type { IVisualViewportGeometry } from '@/utils/visual-viewport.ts'
import {
  deriveSpacePath,
  evaluatePendingWorkspaceAck,
  parsePushWorkspaceMessage
} from '@/utils/push-orchestration.ts'
import '@/app.css'

export const recordPushClickDiagnostic = (
  stage: 'app_receive' | 'app_matched' | 'app_unknown' | 'app_ack'
) => {
  if (typeof fetch === 'undefined') return
  void fetch('/api/push/click-diagnostic', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify({ stage })
  }).catch(() => undefined)
}

export interface IAppOutletContext {
  snapshot: ISnapshotResult | null
  status: ISnapshotStatus
  snapshotError: string | null
  selectedWorkspaceId: string | null
  selectedPaneId: string | null
  selectedPane: IPane | null
  setSelectedWorkspaceId: (workspaceId: string) => void
  setSelectedPaneId: (paneId: string, workspaceId?: string) => void
  refreshSnapshot: () => Promise<boolean>
  push: ReturnType<typeof usePushSubscription>
  viewportGeometry: IVisualViewportGeometry | null
  drawerTriggerRef: React.RefObject<HTMLButtonElement | null>
  menuTriggerRef: React.RefObject<HTMLButtonElement | null>
  shouldRestoreMenuFocusRef: React.MutableRefObject<boolean>
}

export const Layout = ({ children }: { children: ReactNode }) => {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"
        />
        <title>Herdr Web</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#101010" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

const Root = () => {
  const {
    snapshot,
    status,
    error: snapshotError,
    selectedWorkspaceId,
    selectedPaneId,
    selectedPane,
    setSelectedWorkspaceId,
    setSelectedPaneId,
    refreshSnapshot
  } = useSnapshot(2000)

  const push = usePushSubscription()
  const viewportGeometry = useVisualViewport()
  const location = useLocation()
  const navigate = useNavigate()

  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const shouldRestoreMenuFocusRef = useRef<boolean>(false)
  const [pendingWorkspaceAck, setPendingWorkspaceAck] = useState<{
    workspaceId: string
    port?: MessagePort
  } | null>(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const workspaceId = parsePushWorkspaceMessage(event.data)
      if (!workspaceId) return
      recordPushClickDiagnostic('app_receive')

      const target = deriveSpacePath(workspaceId)
      navigate(target)

      if (event.ports && event.ports[0]) {
        setPendingWorkspaceAck({ workspaceId, port: event.ports[0] })
      }
    }

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage)
    return () => navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage)
  }, [navigate])

  useEffect(() => {
    if (!pendingWorkspaceAck) return

    const decision = evaluatePendingWorkspaceAck({
      pendingAck: pendingWorkspaceAck,
      currentPathname: location.pathname,
      snapshot,
      status
    })

    if (decision.action === 'wait') {
      return
    }

    if (decision.action === 'reject_unknown') {
      recordPushClickDiagnostic('app_unknown')
      if (decision.port) {
        decision.port.postMessage({
          type: 'herdr:workspace-rejected',
          workspaceId: decision.workspaceId,
          reason: decision.reason
        })
      }
      setPendingWorkspaceAck(null)
      return
    }

    if (decision.action === 'ack') {
      setSelectedWorkspaceId(decision.workspaceId)
      recordPushClickDiagnostic('app_matched')
      if (decision.port) {
        decision.port.postMessage({
          type: 'herdr:workspace-opened',
          workspaceId: decision.workspaceId
        })
        recordPushClickDiagnostic('app_ack')
      }
      setPendingWorkspaceAck(null)
    }
  }, [pendingWorkspaceAck, location.pathname, snapshot, status, setSelectedWorkspaceId])

  const context: IAppOutletContext = {
    snapshot,
    status,
    snapshotError,
    selectedWorkspaceId,
    selectedPaneId,
    selectedPane,
    setSelectedWorkspaceId,
    setSelectedPaneId,
    refreshSnapshot,
    push,
    viewportGeometry,
    drawerTriggerRef,
    menuTriggerRef,
    shouldRestoreMenuFocusRef
  }

  return <Outlet context={context} />
}

export default Root
