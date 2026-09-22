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
import { useLifecycleOperations, type ILifecycleOperations } from '@/hooks/use-lifecycle-operations.ts'
import { usePushSubscription } from '@/hooks/use-push-subscription.ts'
import { useVisualViewport } from '@/hooks/use-visual-viewport.ts'
import type { IPane, ISnapshotResult, ISnapshotStatus } from '@/types/herdr.ts'
import type { IVisualViewportGeometry } from '@/utils/visual-viewport.ts'
import {
  deriveSpacePath,
  evaluatePendingWorkspaceAck,
  parsePushWorkspaceMessage,
  parseSpacePath
} from '@/utils/push-orchestration.ts'
import {
  shouldApplyCreateResultNavigation,
  snapshotConfirmsCreatedTarget,
  type ILifecycleNavigationOrigin
} from '@/utils/lifecycle-operations.ts'
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
  lifecycle: ILifecycleOperations
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
          content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-visual"
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
    refreshSnapshot,
    getSnapshot
  } = useSnapshot(2000)

  const lifecycle = useLifecycleOperations()
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

  useEffect(() => {
    if ((status !== 'connected' && status !== 'empty') || !snapshot) return
    const routeWorkspaceId = parseSpacePath(location.pathname)
    if (snapshot.workspaces.length === 0) {
      if (location.pathname !== '/') navigate('/', { replace: true })
      return
    }
    if (!routeWorkspaceId) return
    if (snapshot.workspaces.some((workspace) => workspace.workspace_id === routeWorkspaceId)) return

    const fallbackId = selectedWorkspaceId && snapshot.workspaces.some((workspace) => workspace.workspace_id === selectedWorkspaceId)
      ? selectedWorkspaceId
      : snapshot.focused_workspace_id && snapshot.workspaces.some((workspace) => workspace.workspace_id === snapshot.focused_workspace_id)
        ? snapshot.focused_workspace_id
        : snapshot.active_workspace_id && snapshot.workspaces.some((workspace) => workspace.workspace_id === snapshot.active_workspace_id)
          ? snapshot.active_workspace_id
          : snapshot.workspaces[0].workspace_id
    navigate(deriveSpacePath(fallbackId), { replace: true })
  }, [location.pathname, navigate, selectedWorkspaceId, snapshot, status])

  const lifecycleOriginRef = useRef<Map<string, ILifecycleNavigationOrigin>>(new Map())
  const currentPathnameRef = useRef(location.pathname)
  const currentWorkspaceIdRef = useRef(selectedWorkspaceId)
  const currentPaneIdRef = useRef(selectedPaneId)
  const currentLifecycleTicketRef = useRef(lifecycle.ticket)
  currentPathnameRef.current = location.pathname
  currentWorkspaceIdRef.current = selectedWorkspaceId
  currentPaneIdRef.current = selectedPaneId
  currentLifecycleTicketRef.current = lifecycle.ticket

  useEffect(() => {
    const ticket = lifecycle.ticket
    if (!ticket || ticket.phase !== 'pending' || lifecycleOriginRef.current.has(ticket.requestIdentity)) return
    lifecycleOriginRef.current.set(ticket.requestIdentity, {
      requestIdentity: ticket.requestIdentity,
      pathname: currentPathnameRef.current,
      workspaceId: currentWorkspaceIdRef.current,
      paneId: currentPaneIdRef.current
    })
  }, [lifecycle.ticket])

  const reconciledLifecycleRef = useRef<string | null>(null)
  useEffect(() => {
    const ticket = lifecycle.ticket
    if (!ticket || ticket.phase !== 'observed') return
    const attemptKey = `${ticket.requestIdentity}:${ticket.reconciliationAttempt}`
    if (reconciledLifecycleRef.current === attemptKey) return
    reconciledLifecycleRef.current = attemptKey

    void (async () => {
      const refreshed = await refreshSnapshot()
      const currentTicket = currentLifecycleTicketRef.current
      if (
        currentTicket?.requestIdentity !== ticket.requestIdentity ||
        currentTicket.reconciliationAttempt !== ticket.reconciliationAttempt ||
        currentTicket.phase !== 'observed'
      ) return

      const authoritative = getSnapshot()
      if (!refreshed || !authoritative) {
        lifecycle.reportReconciliationFailure(
          ticket.requestIdentity,
          ticket.reconciliationAttempt,
          'The server observed the action, but the browser could not confirm the refreshed session. Refresh and inspect before continuing.'
        )
        return
      }

      if (ticket.type === 'workspace-create') {
        if (!snapshotConfirmsCreatedTarget(authoritative, ticket.result || undefined)) {
          lifecycle.reportReconciliationFailure(
            ticket.requestIdentity,
            ticket.reconciliationAttempt,
            'The server observed Space creation, but the returned Space and pane were not confirmed in the refreshed session.'
          )
          return
        }
        const result = ticket.result as { workspaceId: string; tabId: string; paneId: string }
        if (shouldApplyCreateResultNavigation({
          origin: lifecycleOriginRef.current.get(ticket.requestIdentity),
          requestIdentity: ticket.requestIdentity,
          attempt: ticket.reconciliationAttempt,
          currentTicket: currentLifecycleTicketRef.current,
          currentPathname: currentPathnameRef.current,
          currentWorkspaceId: currentWorkspaceIdRef.current,
          currentPaneId: currentPaneIdRef.current
        })) {
          setSelectedPaneId(result.paneId, result.workspaceId)
          navigate(deriveSpacePath(result.workspaceId), { replace: true })
        }
      }

      lifecycleOriginRef.current.delete(ticket.requestIdentity)
      lifecycle.clearObserved(ticket.requestIdentity)
    })()
  }, [getSnapshot, lifecycle, navigate, refreshSnapshot, setSelectedPaneId])

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
    lifecycle,
    push,
    viewportGeometry,
    drawerTriggerRef,
    menuTriggerRef,
    shouldRestoreMenuFocusRef
  }

  return <Outlet context={context} />
}

export default Root
