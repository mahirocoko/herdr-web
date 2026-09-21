import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deletePushSubscription,
  fetchPushConfig,
  registerPushSubscription,
  sendPushTest,
  type IPushSubscriptionPayload
} from '@/services/push-client.ts'
import { isIosDevice, isStandaloneDisplay, resolvePushState, type IPushState } from '@/utils/push-helpers.ts'
import {
  areApplicationServerKeysEqual,
  executeRemovalWorkflow
} from '@/utils/push-orchestration.ts'
import {
  createPushOperationRuntime,
  type IPushOperationTicket
} from '@/utils/push-operation-runtime.ts'
import { describePushBrowserError } from '@/utils/push-browser-error.ts'
import { createPushEnableOperation, type IPushRuntimeSnapshot } from '@/utils/push-enable-operation.ts'

const initialSnapshot: IPushRuntimeSnapshot = {
  registration: null,
  subscription: null,
  publicKey: null,
  permission: null,
  isSupported: false,
  isReady: false,
  isBusy: true,
  isOperationPending: false,
  error: null
}

const pushRuntime = createPushOperationRuntime(initialSnapshot)
const EXPECTED_SERVICE_WORKER_VERSION = '2026-09-20-spaces-router-v1'

type PushTicket = IPushOperationTicket<IPushRuntimeSnapshot>

const subscriptionPayload = (subscription: PushSubscription): IPushSubscriptionPayload => {
  const json = subscription.toJSON()
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: json.keys?.p256dh || '',
      auth: json.keys?.auth || ''
    },
    expirationTime: subscription.expirationTime
  }
}

const enablePush = createPushEnableOperation({
  runtime: pushRuntime,
  registerSubscription: (subscription) => registerPushSubscription(subscriptionPayload(subscription)),
  deletePushSubscription,
  getPermission: () => typeof Notification === 'undefined' ? null : Notification.permission
})

const waitForServiceWorkerActivation = async (
  registration: ServiceWorkerRegistration
): Promise<void> => {
  const worker = registration.installing || registration.waiting
  if (!worker || worker.state === 'activated') return

  await new Promise<void>((resolve, reject) => {
    const handleStateChange = () => {
      if (worker.state === 'activated') {
        worker.removeEventListener('statechange', handleStateChange)
        resolve()
      } else if (worker.state === 'redundant') {
        worker.removeEventListener('statechange', handleStateChange)
        reject(new Error('Service worker update was superseded'))
      }
    }
    worker.addEventListener('statechange', handleStateChange)
    handleStateChange()
  })
}

const readServiceWorkerVersion = (
  worker: ServiceWorker,
  timeoutMs = 2000
): Promise<string | null> => new Promise((resolve) => {
  const channel = new MessageChannel()
  let settled = false
  const finish = (version: string | null) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve(version)
  }
  const timer = setTimeout(() => finish(null), timeoutMs)
  channel.port1.onmessage = (event) => {
    const data = event.data
    finish(
      data?.type === 'herdr:service-worker-version' && typeof data.version === 'string'
        ? data.version
        : null
    )
  }
  try {
    worker.postMessage({ type: 'herdr:service-worker-version' }, [channel.port2])
  } catch {
    finish(null)
  }
})

const finishRemoval = (
  ticket: PushTicket,
  result: Awaited<ReturnType<typeof executeRemovalWorkflow<PushSubscription>>>,
  fallbackError: string
) => {
  if (!pushRuntime.isOwner(ticket)) return
  if ('cleanupWarning' in result && result.cleanupWarning) console.warn('[herdr-push] Backend cleanup remains pending after local removal')
  const subscription = result.subscription
  const error = result.status === 'retained' || result.status === 'uncertain'
    ? result.error
    : result.status === 'adopted'
      ? 'A different browser push subscription is active; review before retrying'
      : null
  pushRuntime.complete(ticket, {
    subscription,
    isReady: true,
    permission: typeof Notification === 'undefined' ? null : Notification.permission,
    error: error || (result.status === 'absent' ? null : fallbackError)
  })
}

const runInitialInspection = async (ticket: PushTicket) => {
  if (typeof window === 'undefined') return
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!supported) {
    pushRuntime.complete(ticket, { isSupported: false, isReady: false, error: null })
    return
  }
  pushRuntime.publish(ticket, { isSupported: true, permission: Notification.permission })

  try {
    const registered = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none'
    })
    if (registered.active) {
      await registered.update()
    }
    await waitForServiceWorkerActivation(registered)
    if (!pushRuntime.isOwner(ticket)) return
    const registration = await navigator.serviceWorker.ready
    if (!pushRuntime.isOwner(ticket)) return
    const activeWorker = registration.active
    const workerVersion = activeWorker
      ? await readServiceWorkerVersion(activeWorker)
      : null
    if (!pushRuntime.isOwner(ticket)) return
    if (workerVersion !== EXPECTED_SERVICE_WORKER_VERSION) {
      pushRuntime.complete(ticket, {
        registration,
        isReady: false,
        error: 'Service worker update is pending. Close and reopen Herdr to finish the update.'
      })
      return
    }
    pushRuntime.publish(ticket, { registration })

    const config = await fetchPushConfig()
    if (!pushRuntime.isOwner(ticket)) return
    if (!config.enabled || !config.publicKey) {
      pushRuntime.complete(ticket, {
        publicKey: null,
        isReady: false,
        error: config.reason || 'Push notifications are not enabled on the backend'
      })
      return
    }
    pushRuntime.publish(ticket, { publicKey: config.publicKey })

    const subscription = await registration.pushManager.getSubscription()
    if (!pushRuntime.isOwner(ticket)) return
    pushRuntime.publish(ticket, { subscription })
    if (!subscription) {
      pushRuntime.complete(ticket, { isReady: true, error: null })
      return
    }

    if (!areApplicationServerKeysEqual(subscription.options.applicationServerKey, config.publicKey)) {
      if (!pushRuntime.upgradeToExclusive(ticket, 'rotation')) return
      const result = await executeRemovalWorkflow({
        capturedSub: subscription,
        getSubscription: () => registration.pushManager.getSubscription(),
        deleteBackendSubscription: deletePushSubscription,
        onLocalSubscription: (next) => {
          pushRuntime.publish(ticket, { subscription: next })
        }
      })
      finishRemoval(ticket, result, 'Could not remove obsolete push subscription')
      return
    }

    if (Notification.permission === 'granted') {
      if (!pushRuntime.upgradeToExclusive(ticket, 'sync-cleanup')) return
      try {
        await registerPushSubscription(subscriptionPayload(subscription))
        if (!pushRuntime.isOwner(ticket)) return
        pushRuntime.complete(ticket, { subscription, isReady: true, error: null })
      } catch {
        if (!pushRuntime.isOwner(ticket)) return
        pushRuntime.complete(ticket, {
          subscription,
          isReady: true,
          error: 'Failed to synchronize the browser subscription with the backend'
        })
      }
      return
    }

    pushRuntime.complete(ticket, { subscription, isReady: true, error: null })
  } catch (error) {
    if (!pushRuntime.isOwner(ticket)) return
    pushRuntime.complete(ticket, {
      isReady: Boolean(pushRuntime.snapshot().registration),
      error: describePushBrowserError('Could not inspect push notification status', error)
    })
  }
}

export interface IUsePushSubscriptionResult {
  state: IPushState
  error: string | null
  isReady: boolean
  hasSubscription: boolean
  isOperationPending: boolean
  subscribe: () => Promise<void>
  unsubscribe: () => Promise<void>
  sendTestAlert: () => Promise<void>
  refresh: () => Promise<void>
}

export const usePushSubscription = (): IUsePushSubscriptionResult => {
  const [snapshot, setSnapshot] = useState(pushRuntime.snapshot())
  const mountedRef = useRef(false)
  const viewGenerationRef = useRef(0)
  const detachRef = useRef<(() => void) | null>(null)

  const attach = useCallback((ticket: PushTicket) => {
    detachRef.current?.()
    const generation = viewGenerationRef.current
    detachRef.current = pushRuntime.observe(ticket, (next) => {
      if (mountedRef.current && viewGenerationRef.current === generation) setSnapshot(next)
    })
  }, [])

  const refresh = useCallback((): Promise<void> => {
    const admission = pushRuntime.admitInspection()
    attach(admission.ticket)
    if (!admission.admitted) return Promise.resolve()
    return runInitialInspection(admission.ticket)
  }, [attach])

  useEffect(() => {
    mountedRef.current = true
    viewGenerationRef.current++
    const current = pushRuntime.currentTicket()
    if (current) attach(current)
    else void refresh()
    return () => {
      mountedRef.current = false
      viewGenerationRef.current++
      detachRef.current?.()
      detachRef.current = null
    }
  }, [attach, refresh])

  const subscribe = useCallback((): Promise<void> => {
    return enablePush(attach)
  }, [attach])

  const unsubscribe = useCallback((): Promise<void> => {
    const facts = pushRuntime.snapshot()
    if (!facts.registration || !facts.subscription) return Promise.resolve()
    const admission = pushRuntime.admitExclusive('disable')
    attach(admission.ticket)
    if (!admission.admitted) return Promise.resolve()
    const captured = facts.subscription
    return executeRemovalWorkflow({
      capturedSub: captured,
      getSubscription: () => facts.registration!.pushManager.getSubscription(),
      deleteBackendSubscription: deletePushSubscription,
      onLocalSubscription: (next) => {
        pushRuntime.publish(admission.ticket, { subscription: next })
      }
    }).then((result) => finishRemoval(admission.ticket, result, 'Failed to disable push notifications'))
  }, [attach])

  const sendTestAlert = useCallback(async (): Promise<void> => {
    const facts = pushRuntime.snapshot()
    if (!facts.subscription) return
    const admission = pushRuntime.admitExclusive('test')
    attach(admission.ticket)
    if (!admission.admitted) return
    try {
      await sendPushTest(facts.subscription.endpoint)
      if (pushRuntime.isOwner(admission.ticket)) pushRuntime.complete(admission.ticket, { error: null })
    } catch {
      if (pushRuntime.isOwner(admission.ticket)) {
        pushRuntime.complete(admission.ticket, { error: 'Failed to dispatch the push test alert' })
      }
    }
  }, [attach])

  const state = resolvePushState({
    isSupported: snapshot.isSupported,
    isIos: isIosDevice(),
    isStandalone: isStandaloneDisplay(),
    permission: snapshot.permission,
    hasSubscription: Boolean(snapshot.subscription),
    isBusy: snapshot.isBusy,
    backendError: snapshot.error
  })

  return {
    state,
    error: snapshot.error,
    isReady: snapshot.isReady && Boolean(snapshot.registration && snapshot.publicKey),
    hasSubscription: Boolean(snapshot.subscription),
    isOperationPending: snapshot.isOperationPending,
    subscribe,
    unsubscribe,
    sendTestAlert,
    refresh
  }
}
