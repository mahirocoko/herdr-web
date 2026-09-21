import { beginPushSubscribe, executeSubscribeRollback } from './push-orchestration.ts'
import { describePushSubscribeError } from './push-browser-error.ts'
import type { createPushOperationRuntime, IPushOperationSnapshot, IPushOperationTicket } from './push-operation-runtime.ts'

export interface IPushRuntimeSnapshot extends IPushOperationSnapshot {
  registration: ServiceWorkerRegistration | null
  subscription: PushSubscription | null
  publicKey: string | null
  permission: NotificationPermission | null
  isSupported: boolean
  isReady: boolean
}

interface IPushEnableDependencies {
  runtime: ReturnType<typeof createPushOperationRuntime<IPushRuntimeSnapshot>>
  registerSubscription: (subscription: PushSubscription) => Promise<unknown>
  deletePushSubscription: (endpoint: string) => Promise<unknown>
  getPermission: () => NotificationPermission | null
}

type PushTicket = IPushOperationTicket<IPushRuntimeSnapshot>

export const createPushEnableOperation = ({
  runtime, registerSubscription, deletePushSubscription, getPermission
}: IPushEnableDependencies) => {
  const settle = async (ticket: PushTicket, subscribePromise: Promise<PushSubscription>) => {
    let subscription: PushSubscription
    try {
      subscription = await subscribePromise
    } catch (error) {
      if (!runtime.isOwner(ticket)) return
      runtime.complete(ticket, {
        permission: getPermission(),
        error: describePushSubscribeError('Failed to create the browser push subscription', error)
      })
      return
    }
    if (!runtime.isOwner(ticket)) return
    runtime.publish(ticket, {
      subscription,
      permission: getPermission()
    })

    try {
      await registerSubscription(subscription)
      if (!runtime.isOwner(ticket)) return
      runtime.complete(ticket, { subscription, isReady: true, error: null })
    } catch {
      if (!runtime.isOwner(ticket)) return
      const rollback = await executeSubscribeRollback(subscription, {
        getSubscription: () => ticket.snapshot.registration!.pushManager.getSubscription(),
        deleteBackendSubscription: deletePushSubscription,
        onLocalSubscription: (next) => {
          runtime.publish(ticket, { subscription: next })
        }
      })
      if (!runtime.isOwner(ticket)) return
      if (rollback.cleanupWarning) console.warn('[herdr-push] Backend cleanup remains pending after enable rollback')
      runtime.complete(ticket, {
        subscription: rollback.retainedSub,
        isReady: true,
        error: rollback.rolledBack
          ? 'Backend registration failed; the browser subscription was rolled back'
          : 'Backend registration failed and the browser subscription may still be active'
      })
    }
  }

  // Keep admission and browser invocation in the caller's synchronous gesture.
  return (onTicket: (ticket: PushTicket) => void): Promise<void> => {
    const facts = runtime.snapshot()
    if (!facts.registration || !facts.publicKey || !facts.isReady) return Promise.resolve()
    const admission = runtime.admitExclusive('enable')
    onTicket(admission.ticket)
    if (!admission.admitted) return Promise.resolve()

    let subscribePromise: Promise<PushSubscription>
    try {
      subscribePromise = beginPushSubscribe(facts.registration, facts.publicKey)
    } catch (error) {
      runtime.complete(admission.ticket, {
        permission: getPermission(),
        error: describePushSubscribeError('Failed to start the browser push subscription', error)
      })
      return Promise.resolve()
    }
    return settle(admission.ticket, subscribePromise)
  }
}
