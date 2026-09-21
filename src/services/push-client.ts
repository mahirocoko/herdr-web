export interface IPushConfigResponse {
  ok: boolean
  enabled: boolean
  publicKey?: string
  reason?: string
  error?: string
}

export interface IPushSubscriptionKeys {
  p256dh: string
  auth: string
}

export interface IPushSubscriptionPayload {
  endpoint: string
  keys: IPushSubscriptionKeys
  expirationTime?: number | null
}

interface IJsonResponse<T> {
  response: Response
  data: T
}

const timeoutError = (timeoutMs: number) =>
  new Error(`Push request timed out after ${timeoutMs / 1000}s`)

export function fetchJsonWithTimeout<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs?: number
): Promise<IJsonResponse<T>>
export function fetchJsonWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  parseBody: false
): Promise<IJsonResponse<T>>
export async function fetchJsonWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10000,
  parseBody = true
): Promise<IJsonResponse<T>> {
  const controller = new AbortController()
  const callerSignal = init.signal
  if (callerSignal?.aborted) throw callerSignal.reason || new DOMException('Aborted', 'AbortError')

  let rejectDeadline!: (reason: Error) => void
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject })
  const timer = setTimeout(() => {
    const error = timeoutError(timeoutMs)
    controller.abort(error)
    rejectDeadline(error)
  }, timeoutMs)
  const onCallerAbort = () => controller.abort(callerSignal?.reason)
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true })

  try {
    const response = await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      deadline
    ])
    const data = parseBody
      ? await Promise.race([response.json() as Promise<T>, deadline])
      : undefined as T
    return { response, data }
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', onCallerAbort)
  }
}

const requestJson = async <T>(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = 10000
): Promise<T> => {
  const { response, data } = await fetchJsonWithTimeout<T>(input, init, timeoutMs)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return data
}

export const fetchPushConfig = async (signal?: AbortSignal): Promise<IPushConfigResponse> =>
  requestJson('/api/push/config', {
    method: 'GET',
    headers: { 'accept': 'application/json' },
    signal
  })

export const registerPushSubscription = async (
  subscription: IPushSubscriptionPayload,
  signal?: AbortSignal
): Promise<{ ok: boolean }> => requestJson('/api/push/subscriptions', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'accept': 'application/json'
  },
  body: JSON.stringify(subscription),
  signal
})

export const deletePushSubscription = async (
  endpoint: string,
  signal?: AbortSignal
): Promise<{ ok: boolean }> => requestJson('/api/push/subscriptions', {
  method: 'DELETE',
  headers: {
    'content-type': 'application/json',
    'accept': 'application/json'
  },
  body: JSON.stringify({ endpoint }),
  signal
})

export const sendPushTest = async (
  endpoint: string,
  signal?: AbortSignal
): Promise<{ ok: boolean }> => requestJson('/api/push/test', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'accept': 'application/json'
  },
  body: JSON.stringify({ endpoint }),
  signal
})

export interface ILiveTabPolicy {
  workspaceId: string
  tabId: string
  workspaceLabel: string
  workspaceNumber: number
  tabLabel: string
  tabNumber: number
  enabled: boolean
  isDefaultOwner: boolean
  source: 'default' | 'override'
}

export interface ITabPolicyResponse {
  ok: boolean
  tabs: ILiveTabPolicy[]
  error?: string
}

export const fetchTabPolicy = async (signal?: AbortSignal): Promise<ITabPolicyResponse> =>
  requestJson('/api/push/tab-policy', {
    method: 'GET',
    headers: { 'accept': 'application/json' },
    signal
  })

export const updateTabPolicy = async (
  tabId: string,
  enabled: boolean,
  signal?: AbortSignal
): Promise<ITabPolicyResponse> =>
  requestJson('/api/push/tab-policy', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json'
    },
    body: JSON.stringify({ tabId, enabled }),
    signal
  })
