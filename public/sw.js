// Herdr Web Service Worker - Web Push & Notifications
const HERDR_SERVICE_WORKER_VERSION = '2026-09-20-spaces-router-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'herdr:service-worker-version') return
  event.ports[0]?.postMessage({
    type: 'herdr:service-worker-version',
    version: HERDR_SERVICE_WORKER_VERSION
  })
})

const sanitizeSpaceLabel = (raw) => {
  if (typeof raw !== 'string') return null
  // Strip C0 (\u0000-\u001f), DEL/C1 (\u007f-\u009f), and bidi-formatting controls:
  // \u061c (ALM), \u200e (LRM), \u200f (RLM), \u202a-\u202e (LRE, RLE, PDF, LRO, RLO), \u2066-\u2069 (LRI, RLI, FSI, PDI)
  const noControls = raw.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
  const collapsed = noControls.trim().replace(/\s+/g, ' ')
  if (!collapsed) return null
  const chars = Array.from(collapsed)
  return chars.length > 64 ? chars.slice(0, 64).join('') : collapsed
}

const isValidWorkspaceId = (id) => {
  if (typeof id !== 'string') return false
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id.trim())
}

const deriveSafeTargetUrl = (workspaceId) => {
  if (isValidWorkspaceId(workspaceId)) {
    return '/spaces/' + encodeURIComponent(workspaceId.trim())
  }
  return '/'
}

// Canonical route parser: /spaces/:workspaceId
const parseCanonicalSpaceUrl = (parsedUrl) => {
  if (!parsedUrl.pathname.startsWith('/spaces/')) return null
  if (parsedUrl.search && parsedUrl.search !== '') return null
  const segment = parsedUrl.pathname.slice('/spaces/'.length)
  try {
    const decoded = decodeURIComponent(segment)
    if (isValidWorkspaceId(decoded)) {
      return decoded.trim()
    }
  } catch {
    return null
  }
  return null
}

// Migration-only compatibility decoder for already displayed legacy notification data containing /?workspace=<id>
const parseLegacyWorkspaceUrl = (parsedUrl) => {
  if (parsedUrl.pathname !== '/') return null
  const keys = Array.from(parsedUrl.searchParams.keys())
  if (keys.length === 1 && keys[0] === 'workspace') {
    const val = parsedUrl.searchParams.get('workspace')
    if (isValidWorkspaceId(val)) {
      return val.trim()
    }
  }
  return null
}

const validateTargetUrl = (rawUrl, origin) => {
  try {
    const parsed = new URL(rawUrl, origin)
    if (parsed.origin !== origin) {
      return new URL('/', origin).href
    }
    if (parsed.hash && parsed.hash !== '') {
      return new URL('/', origin).href
    }

    // 1. Canonical route: /spaces/:workspaceId
    const canonicalWsId = parseCanonicalSpaceUrl(parsed)
    if (canonicalWsId) {
      return new URL('/spaces/' + encodeURIComponent(canonicalWsId), origin).href
    }

    // 2. Migration-only: canonicalize /?workspace=<id> to /spaces/:workspaceId
    const legacyWsId = parseLegacyWorkspaceUrl(parsed)
    if (legacyWsId) {
      return new URL('/spaces/' + encodeURIComponent(legacyWsId), origin).href
    }

    // 3. Root route: /
    if (parsed.pathname === '/' && (!parsed.search || parsed.search === '')) {
      return new URL('/', origin).href
    }

    return new URL('/', origin).href
  } catch {
    return new URL('/', origin).href
  }
}

const deriveSafeNotificationTag = (type, workspaceId) => {
  if (type === 'test') {
    return 'herdr:test'
  }
  if (type === 'needs_input' || type === 'done') {
    if (isValidWorkspaceId(workspaceId)) {
      return 'herdr:space:' + workspaceId.trim() + ':' + type
    }
    return 'herdr:event:' + type
  }
  return 'herdr-notification'
}

const parseWorkspaceIdFromTag = (tag) => {
  if (typeof tag !== 'string') return null
  const match = /^herdr:space:([a-zA-Z0-9_-]{1,128}):(needs_input|done)$/.exec(tag)
  return match && isValidWorkspaceId(match[1]) ? match[1] : null
}

const resolveNotificationTarget = (notification) => {
  const dataWorkspaceId = isValidWorkspaceId(notification.data?.workspaceId)
    ? notification.data.workspaceId.trim()
    : null
  const dataUrl = validateTargetUrl(notification.data?.url || '/', self.location.origin)
  const urlWorkspaceId = parseCanonicalSpaceUrl(new URL(dataUrl))
  const tagWorkspaceId = parseWorkspaceIdFromTag(notification.tag)

  const dataTarget = dataWorkspaceId || urlWorkspaceId
  if (
    (dataWorkspaceId && urlWorkspaceId && dataWorkspaceId !== urlWorkspaceId) ||
    (dataTarget && tagWorkspaceId && dataTarget !== tagWorkspaceId)
  ) {
    return { workspaceId: null, targetUrl: new URL('/', self.location.origin).href, stage: 'click_target_conflict' }
  }
  if (dataTarget) {
    return {
      workspaceId: dataTarget,
      targetUrl: new URL(deriveSafeTargetUrl(dataTarget), self.location.origin).href,
      stage: 'click_target_data'
    }
  }
  if (tagWorkspaceId) {
    return {
      workspaceId: tagWorkspaceId,
      targetUrl: new URL(deriveSafeTargetUrl(tagWorkspaceId), self.location.origin).href,
      stage: 'click_target_tag'
    }
  }
  return { workspaceId: null, targetUrl: new URL('/', self.location.origin).href, stage: 'click_target_none' }
}

const recordClickDiagnostic = async (stage, timeoutMs = 150) => {
  const controller = new AbortController()
  let timer = null
  try {
    const request = fetch('/api/push/click-diagnostic', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json'
      },
      body: JSON.stringify({ stage }),
      credentials: 'same-origin',
      signal: controller.signal
    }).catch(() => undefined)
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        resolve(undefined)
      }, timeoutMs)
    })
    await Promise.race([request, deadline])
  } catch {
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

const postWorkspaceMessageWithAck = (client, workspaceId) => {
  if (!('postMessage' in client) || typeof MessageChannel !== 'function') {
    return Promise.resolve({ status: 'unsupported' })
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel()
    let settled = false
    const finish = (status) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ status })
    }
    const timer = setTimeout(() => finish('timed_out'), 500)
    channel.port1.onmessage = (messageEvent) => {
      const ack = messageEvent?.data
      if (!ack || typeof ack !== 'object') {
        finish('invalid_response')
        return
      }
      if (ack.type === 'herdr:workspace-opened' && ack.workspaceId === workspaceId) {
        finish('acknowledged')
        return
      }
      if (
        ack.type === 'herdr:workspace-rejected' &&
        ack.workspaceId === workspaceId &&
        typeof ack.reason === 'string'
      ) {
        finish('rejected')
        return
      }
      finish('invalid_response')
    }

    try {
      client.postMessage({
        type: 'herdr:open-workspace',
        workspaceId
      }, [channel.port2])
    } catch {
      finish('unsupported')
    }
  })
}

self.addEventListener('push', (event) => {
  let title = 'Herdr Notification'
  let body = 'Herdr has an update.'
  let tag = 'herdr-notification'
  let targetUrl = '/'
  let targetWorkspaceId = null

  if (event.data) {
    try {
      const data = event.data.json()
      if (data && typeof data === 'object') {
        const type = data.type
        const wsId = isValidWorkspaceId(data.workspaceId) ? data.workspaceId.trim() : null
        const wsLabel = wsId ? sanitizeSpaceLabel(data.workspaceLabel) : null

        if (type === 'needs_input') {
          title = 'Herdr needs input'
          body = wsLabel ? `Space: ${wsLabel}` : 'An agent is waiting for you.'
          targetUrl = deriveSafeTargetUrl(wsId)
          targetWorkspaceId = wsId
          tag = deriveSafeNotificationTag(type, wsId)
        } else if (type === 'done') {
          title = 'Herdr task finished'
          body = wsLabel ? `Space: ${wsLabel}` : 'An agent finished a task.'
          targetUrl = deriveSafeTargetUrl(wsId)
          targetWorkspaceId = wsId
          tag = deriveSafeNotificationTag(type, wsId)
        } else if (type === 'test') {
          title = 'Herdr Test Alert'
          body = 'Push notifications are active on this device.'
          targetUrl = '/'
          tag = deriveSafeNotificationTag(type, null)
        }
      }
    } catch {
      // Ignore malformed or raw payload text; keep generic fallback. Never show raw body.
    }
  }

  const options = {
    body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag,
    data: {
      url: targetUrl,
      ...(targetWorkspaceId ? { workspaceId: targetWorkspaceId } : {})
    }
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const resolvedTarget = resolveNotificationTarget(event.notification)
  const { targetUrl, workspaceId } = resolvedTarget

  event.waitUntil(
    (async () => {
      await recordClickDiagnostic(resolvedTarget.stage)
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const sameOriginClients = []
      for (const client of clientList) {
        if (client && client.url) {
          try {
            const clientUrl = new URL(client.url)
            if (clientUrl.origin === self.location.origin) {
              sameOriginClients.push({ client, clientUrl })
            }
          } catch {
            // Ignore malformed client URLs
          }
        }
      }

      if (isValidWorkspaceId(workspaceId)) {
        if (sameOriginClients.length > 0) {
          const { client } = sameOriginClients[0]
          const ackResult = await postWorkspaceMessageWithAck(client, workspaceId.trim())
          if (ackResult.status === 'acknowledged') {
            await recordClickDiagnostic('ack_received')
            if ('focus' in client) {
              await client.focus()
            }
            return
          }
          if (ackResult.status === 'rejected') {
            await recordClickDiagnostic('ack_rejected')
            return
          }
          if (ackResult.status === 'timed_out') {
            await recordClickDiagnostic('ack_timeout')
            return
          }
          if (ackResult.status === 'invalid_response') {
            await recordClickDiagnostic('ack_invalid')
            return
          }
          await recordClickDiagnostic('ack_unsupported')
          return
        }

        // When zero same-origin window clients exist, openWindow('/spaces/:workspaceId') remains allowed
        if (self.clients.openWindow) {
          try {
            const openedClient = await self.clients.openWindow(targetUrl)
            await recordClickDiagnostic(openedClient ? 'open_ok' : 'open_null')
          } catch {
            await recordClickDiagnostic('open_error')
          }
        }
        return
      }

      // Non-Space / root test notifications: preserve safe exact-root behavior deliberately
      for (const { client, clientUrl } of sameOriginClients) {
        if ('focus' in client) {
          if (clientUrl.href === targetUrl) {
            await client.focus()
            return
          }
          if ('navigate' in client) {
            try {
              const navigatedClient = await client.navigate(targetUrl)
              if (navigatedClient && 'focus' in navigatedClient) {
                await recordClickDiagnostic('navigate_ok')
                await navigatedClient.focus()
                return
              }
              await recordClickDiagnostic('navigate_null')
            } catch {
              await recordClickDiagnostic('navigate_error')
            }
          }
        }
      }

      if (self.clients.openWindow) {
        try {
          const openedClient = await self.clients.openWindow(targetUrl)
          await recordClickDiagnostic(openedClient ? 'open_ok' : 'open_null')
        } catch {
          await recordClickDiagnostic('open_error')
        }
      }
    })()
  )
})
