import webpush from 'web-push'
import { sanitizeWorkspaceLabel } from './transition-detector.ts'
import type { IPushConfig, IPushPayload, IPushSendResult, IPushSubscription } from './types.ts'

export const isValidWorkspaceId = (id?: string | null): boolean => {
  if (typeof id !== 'string') return false
  const trimmed = id.trim()
  return /^[a-zA-Z0-9_-]{1,128}$/.test(trimmed)
}

export const createNeedsInputPayload = (
  workspaceId?: string,
  workspaceLabel?: string
): IPushPayload => {
  const validWsId = isValidWorkspaceId(workspaceId) ? workspaceId!.trim() : undefined
  const sanitizedLabel = validWsId ? sanitizeWorkspaceLabel(workspaceLabel) : undefined
  const body = sanitizedLabel ? `Space: ${sanitizedLabel}` : 'An agent is waiting for you.'
  const url = validWsId ? `/spaces/${encodeURIComponent(validWsId)}` : '/'

  return {
    type: 'needs_input',
    title: 'Herdr needs input',
    body,
    url,
    timestamp: Date.now(),
    ...(validWsId ? { workspaceId: validWsId } : {}),
    ...(sanitizedLabel ? { workspaceLabel: sanitizedLabel } : {})
  }
}

export const createDonePayload = (
  workspaceId?: string,
  workspaceLabel?: string
): IPushPayload => {
  const validWsId = isValidWorkspaceId(workspaceId) ? workspaceId!.trim() : undefined
  const sanitizedLabel = validWsId ? sanitizeWorkspaceLabel(workspaceLabel) : undefined
  const body = sanitizedLabel ? `Space: ${sanitizedLabel}` : 'An agent finished a task.'
  const url = validWsId ? `/spaces/${encodeURIComponent(validWsId)}` : '/'

  return {
    type: 'done',
    title: 'Herdr task finished',
    body,
    url,
    timestamp: Date.now(),
    ...(validWsId ? { workspaceId: validWsId } : {}),
    ...(sanitizedLabel ? { workspaceLabel: sanitizedLabel } : {})
  }
}

export const createTestPayload = (): IPushPayload => ({
  type: 'test',
  title: 'Herdr Test Alert',
  body: 'Push notifications are active on this device.',
  url: '/',
  timestamp: Date.now()
})

export interface ISendPushOptions {
  ttlSeconds?: number
  timeoutMs?: number
  webPushClient?: Pick<typeof webpush, 'sendNotification' | 'setVapidDetails'>
}

export const sendPushNotification = async (
  subscription: IPushSubscription,
  payload: IPushPayload,
  config: IPushConfig,
  options: ISendPushOptions = {}
): Promise<IPushSendResult> => {
  const client = options.webPushClient || webpush
  const ttl = options.ttlSeconds ?? 60
  const timeoutMs = options.timeoutMs ?? 10000

  let timer: ReturnType<typeof setTimeout> | null = null

  try {
    client.setVapidDetails(config.subject, config.publicKey, config.privateKey)

    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth
      }
    }

    const payloadString = JSON.stringify(payload)
    const sendPromise = client.sendNotification(pushSubscription, payloadString, {
      TTL: ttl,
      urgency: 'high',
      timeout: timeoutMs
    })

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const timeoutErr = new Error(`Push provider request timed out after ${timeoutMs / 1000}s`)
        ;(timeoutErr as any).code = 'ETIMEDOUT'
        reject(timeoutErr)
      }, timeoutMs)
    })

    const res = (await Promise.race([sendPromise, timeoutPromise])) as any

    return {
      ok: true,
      statusCode: res?.statusCode ?? 201
    }
  } catch (err: any) {
    const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : undefined

    // 404 or 410 indicates the subscription is expired or unregistered at push service
    if (statusCode === 404 || statusCode === 410) {
      return {
        ok: false,
        statusCode,
        error: 'Subscription expired or unregistered',
        shouldRemove: true
      }
    }

    let boundedError = 'Push delivery failed'
    if (statusCode === 401 || statusCode === 403) {
      boundedError = 'Push service authorization failed'
    } else if (statusCode === 413) {
      boundedError = 'Push payload too large'
    } else if (statusCode === 429) {
      boundedError = 'Push service rate limited'
    } else if (statusCode && statusCode >= 500) {
      boundedError = 'Push service provider error'
    } else if (err?.code === 'ETIMEDOUT' || err?.message?.includes('timed out')) {
      boundedError = 'Push provider request timed out'
    } else if (err?.code === 'ECONNRESET' || err?.code === 'ENOTFOUND') {
      boundedError = 'Network error contacting push provider'
    }

    return {
      ok: false,
      statusCode,
      error: boundedError,
      shouldRemove: false
    }
  } finally {
    if (timer !== null) {
      clearTimeout(timer)
    }
  }
}
