import { urlBase64ToUint8Array } from './push-helpers.ts'

export const isValidWorkspaceId = (id?: string | null): boolean => {
  if (typeof id !== 'string') return false
  const trimmed = id.trim()
  return /^[a-zA-Z0-9_-]{1,128}$/.test(trimmed)
}

export const deriveSpacePath = (workspaceId?: string | null): string => {
  if (isValidWorkspaceId(workspaceId)) {
    return '/spaces/' + encodeURIComponent(workspaceId!.trim())
  }
  return '/'
}

export const parseSpacePath = (pathname: string): string | null => {
  if (!pathname.startsWith('/spaces/')) return null
  const segment = pathname.slice('/spaces/'.length)
  if (!segment || segment.includes('/')) return null
  try {
    const decoded = decodeURIComponent(segment)
    return isValidWorkspaceId(decoded) ? decoded.trim() : null
  } catch {
    return null
  }
}

export const parsePushWorkspaceMessage = (data: unknown): string | null => {
  if (!data || typeof data !== 'object') return null
  const message = data as Record<string, unknown>
  if (message.type !== 'herdr:open-workspace') return null
  return typeof message.workspaceId === 'string' && isValidWorkspaceId(message.workspaceId)
    ? message.workspaceId.trim()
    : null
}

export interface IConsumeWorkspaceDeepLinkParams {
  targetWorkspaceId: string
  workspaces: Array<{ workspace_id: string }>
  onSelectWorkspace: (id: string) => void
}

export const consumeWorkspaceDeepLink = (
  params: IConsumeWorkspaceDeepLinkParams
): { matched: boolean } => {
  const matched = params.workspaces.some((workspace) => workspace.workspace_id === params.targetWorkspaceId)
  if (matched) params.onSelectWorkspace(params.targetWorkspaceId)
  return { matched }
}

export interface IEvaluatePendingWorkspaceAckParams {
  pendingAck: { workspaceId: string; port?: MessagePort } | null
  currentPathname: string
  snapshot: { workspaces?: Array<{ workspace_id: string }> } | null
  status: string
}

export type IEvaluatePendingWorkspaceAckDecision =
  | { action: 'wait'; reason: 'no_pending' | 'snapshot_loading' | 'snapshot_unhealthy' | 'snapshot_missing' | 'route_not_committed' }
  | { action: 'reject_unknown'; workspaceId: string; reason: 'unknown_space'; port?: MessagePort }
  | { action: 'ack'; workspaceId: string; port?: MessagePort }

export const evaluatePendingWorkspaceAck = (
  params: IEvaluatePendingWorkspaceAckParams
): IEvaluatePendingWorkspaceAckDecision => {
  const { pendingAck, currentPathname, snapshot, status } = params
  if (!pendingAck) {
    return { action: 'wait', reason: 'no_pending' }
  }
  if (status === 'loading') {
    return { action: 'wait', reason: 'snapshot_loading' }
  }
  if (status !== 'connected' && status !== 'empty') {
    return { action: 'wait', reason: 'snapshot_unhealthy' }
  }
  if (!snapshot) {
    return { action: 'wait', reason: 'snapshot_missing' }
  }

  const expectedPath = deriveSpacePath(pendingAck.workspaceId)
  if (currentPathname !== expectedPath) {
    return { action: 'wait', reason: 'route_not_committed' }
  }

  const isMember = Boolean(
    snapshot.workspaces?.some((w) => w.workspace_id === pendingAck.workspaceId)
  )

  if (!isMember) {
    return {
      action: 'reject_unknown',
      workspaceId: pendingAck.workspaceId,
      reason: 'unknown_space',
      port: pendingAck.port
    }
  }

  return { action: 'ack', workspaceId: pendingAck.workspaceId, port: pendingAck.port }
}

export const areApplicationServerKeysEqual = (
  appServerKeyBuffer: ArrayBufferLike | null | undefined,
  configPublicKeyBase64: string
): boolean => {
  if (!appServerKeyBuffer) return true
  const configured = urlBase64ToUint8Array(configPublicKeyBase64)
  const subscribed = new Uint8Array(appServerKeyBuffer)
  if (configured.length !== subscribed.length) return false
  return configured.every((byte, index) => byte === subscribed[index])
}

export interface IPushSubscriptionLike {
  endpoint: string
  unsubscribe: () => Promise<boolean>
}

export interface IRemovalWorkflowParams<T extends IPushSubscriptionLike> {
  capturedSub: T
  getSubscription: () => Promise<T | null>
  deleteBackendSubscription: (endpoint: string) => Promise<unknown>
  onLocalSubscription?: (subscription: T | null) => void
}

export type IRemovalWorkflowResult<T extends IPushSubscriptionLike> =
  | { status: 'absent'; subscription: null; cleanupWarning?: string }
  | { status: 'adopted'; subscription: T; cleanupWarning?: string }
  | { status: 'retained'; subscription: T; error: string }
  | { status: 'uncertain'; subscription: T; error: string }

const cleanupCapturedEndpoint = async (
  endpoint: string,
  deleteBackendSubscription: (endpoint: string) => Promise<unknown>
): Promise<string | undefined> => {
  try {
    await deleteBackendSubscription(endpoint)
    return undefined
  } catch {
    return 'Backend cleanup remains pending after local removal'
  }
}

export const executeRemovalWorkflow = async <T extends IPushSubscriptionLike>(
  params: IRemovalWorkflowParams<T>
): Promise<IRemovalWorkflowResult<T>> => {
  const { capturedSub, getSubscription, deleteBackendSubscription, onLocalSubscription } = params
  let removed = false
  try {
    removed = await capturedSub.unsubscribe()
  } catch {
    removed = false
  }

  if (removed) {
    onLocalSubscription?.(null)
    const cleanupWarning = await cleanupCapturedEndpoint(capturedSub.endpoint, deleteBackendSubscription)
    return { status: 'absent', subscription: null, cleanupWarning }
  }

  let authoritative: T | null
  try {
    authoritative = await getSubscription()
  } catch {
    return {
      status: 'uncertain',
      subscription: capturedSub,
      error: 'Could not confirm the browser push subscription after removal failed'
    }
  }

  if (!authoritative) {
    onLocalSubscription?.(null)
    const cleanupWarning = await cleanupCapturedEndpoint(capturedSub.endpoint, deleteBackendSubscription)
    return { status: 'absent', subscription: null, cleanupWarning }
  }

  onLocalSubscription?.(authoritative)
  if (authoritative.endpoint === capturedSub.endpoint) {
    return {
      status: 'retained',
      subscription: authoritative,
      error: 'Browser push subscription is still active'
    }
  }

  const cleanupWarning = await cleanupCapturedEndpoint(capturedSub.endpoint, deleteBackendSubscription)
  return { status: 'adopted', subscription: authoritative, cleanupWarning }
}

export interface IRollbackWorkflowResult<T> {
  rolledBack: boolean
  retainedSub: T | null
  cleanupWarning?: string
}

export const executeSubscribeRollback = async <T extends IPushSubscriptionLike>(
  newlyCreatedSub: T | null,
  options: {
    getSubscription?: () => Promise<T | null>
    deleteBackendSubscription?: (endpoint: string) => Promise<unknown>
    onLocalSubscription?: (subscription: T | null) => void
  } = {}
): Promise<IRollbackWorkflowResult<T>> => {
  if (!newlyCreatedSub) return { rolledBack: true, retainedSub: null }
  const result = await executeRemovalWorkflow({
    capturedSub: newlyCreatedSub,
    getSubscription: options.getSubscription || (async () => newlyCreatedSub),
    deleteBackendSubscription: options.deleteBackendSubscription || (async () => undefined),
    onLocalSubscription: options.onLocalSubscription
  })
  if (result.status === 'absent') {
    return { rolledBack: true, retainedSub: null, cleanupWarning: result.cleanupWarning }
  }
  return { rolledBack: false, retainedSub: result.subscription }
}

export const beginPushSubscribe = (
  registration: Pick<ServiceWorkerRegistration, 'pushManager'>,
  publicKey: string
): Promise<PushSubscription> => {
  const applicationServerKey = urlBase64ToUint8Array(publicKey)
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey as unknown as BufferSource
  })
}
