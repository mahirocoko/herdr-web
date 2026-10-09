import type {
  IConversationRead,
  IConversationToolOutput
} from '@/types/conversation.ts'

export class ConversationError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ConversationError'
    this.status = status
    this.code = code
  }
}

export interface IFetchPaneConversationOptions {
  before?: string | null
  signal?: AbortSignal
}

/** Owner-only recorded output, never a filesystem path or provider URL. */
export const fetchConversationToolOutput = async (
  paneId: string,
  history: string,
  ref: string,
  options?: { signal?: AbortSignal }
): Promise<IConversationToolOutput> => {
  const params = new URLSearchParams({
    pane_id: paneId,
    history_id: history,
    ref
  })
  const res = await fetch(`/api/conversation/output?${params}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options?.signal,
    cache: 'no-store'
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({}))
    throw new ConversationError(
      error.error || 'Recorded output unavailable',
      res.status,
      error.code
    )
  }
  const data = (await res.json()) as IConversationToolOutput
  if (
    !data ||
    data.ok !== true ||
    data.paneId !== paneId ||
    data.sessionKey !== history ||
    data.ref !== ref ||
    typeof data.output !== 'string' ||
    data.lengthUnit !== 'utf16-code-units' ||
    data.length !== data.output.length ||
    (data.outputRevision !== undefined &&
      !/^[a-f0-9]{64}$/.test(data.outputRevision))
  )
    throw new ConversationError(
      'Invalid recorded-output payload from server',
      500
    )
  return data
}

export interface IConversationImage {
  blob: Blob
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
  width: number
  height: number
}

/** Native opaque attachment read, not a filesystem URL; UI owns later rendering. */
export const fetchConversationImage = async (
  paneId: string,
  history: string,
  ref: string,
  options?: { signal?: AbortSignal }
): Promise<IConversationImage> => {
  const params = new URLSearchParams({
    pane_id: paneId,
    history_id: history,
    ref
  })
  const response = await fetch(`/api/conversation/image?${params}`, {
    headers: { Accept: 'image/png,image/jpeg,image/gif,image/webp' },
    cache: 'no-store',
    signal: options?.signal
  })
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}))
    throw new ConversationError(
      failure.error || 'Native image unavailable',
      response.status,
      failure.code
    )
  }
  const mediaType = response.headers.get('content-type')
  const width = Number(response.headers.get('x-image-width'))
  const height = Number(response.headers.get('x-image-height'))
  if (
    !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(
      mediaType ?? ''
    ) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 8192 ||
    height > 8192 ||
    width * height > 32 * 1024 * 1024 ||
    !response.body
  )
    throw new ConversationError('Invalid native-image payload', 500)
  const reader = response.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > 8 * 1024 * 1024) {
        await reader.cancel()
        throw new ConversationError('Native image exceeds limit', 413)
      }
      chunks.push(new Uint8Array(chunk.value))
    }
  } finally {
    reader.releaseLock()
  }
  if (!size) throw new ConversationError('Invalid native-image payload', 500)
  return {
    blob: new Blob(chunks, { type: mediaType! }),
    mediaType: mediaType as IConversationImage['mediaType'],
    width,
    height
  }
}

export const fetchPaneConversation = async (
  paneId: string,
  options?: IFetchPaneConversationOptions
): Promise<IConversationRead> => {
  const params = new URLSearchParams({ pane_id: paneId })
  if (options?.before) {
    params.set('before', options.before)
  }
  const res = await fetch(`/api/conversation?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    signal: options?.signal
  })

  if (!res.ok) {
    const errorData = await res
      .json()
      .catch(() => ({ error: `HTTP ${res.status}` }))
    throw new ConversationError(
      errorData.error || `Failed to fetch conversation (status ${res.status})`,
      res.status,
      errorData.code
    )
  }

  const data = (await res.json()) as IConversationRead
  if (!data || !data.ok || !Array.isArray(data.turns)) {
    throw new ConversationError('Invalid conversation payload from server', 500)
  }
  return data
}
