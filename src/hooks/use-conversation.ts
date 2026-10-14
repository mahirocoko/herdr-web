import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ConversationError,
  fetchPaneConversation
} from '@/services/conversation-api.ts'
import {
  groupContributions,
  reconcileContributions,
  type IConversationContribution,
  type IConversationRead,
  type IConversationTurn
} from '@/types/conversation.ts'

export interface IUseConversationOptions {
  paneId: string | null
  isEnabled?: boolean
  pollIntervalMs?: number
}

export interface IConversationState {
  turns: IConversationTurn[]
  contributions: IConversationContribution[]
  metadata: IConversationRead['metadata']
  abandoned?: IConversationRead['abandoned']
  source: IConversationRead['source'] | null
  sessionKey: string | null
  before: string | null
  retentionLimited: boolean
}

export const emptyConversation = (): IConversationState => ({
  turns: [],
  contributions: [],
  metadata: { model: null, reasoning_effort: null },
  source: null,
  sessionKey: null,
  before: null,
  retentionLimited: false
})

/** The earliest loaded frontier belongs to the loaded session, not its latest page.
 * Latest responses own overlapping snapshots; older responses cannot roll them back.
 */
export const reconcileConversation = (
  previous: IConversationState,
  page: IConversationRead,
  older: boolean
): IConversationState => {
  if (previous.sessionKey !== page.sessionKey)
    return {
      contributions: page.contributions ?? [],
      turns: page.contributions
        ? groupContributions(page.contributions)
        : page.turns,
      metadata: page.metadata,
      abandoned: page.abandoned,
      source: page.source,
      sessionKey: page.sessionKey,
      before: page.before,
      retentionLimited: false
    }
  if (page.contributions) {
    const prior = previous.contributions.filter((row) => {
      const ephemeral =
        row.role === 'notice' &&
        (row.id.startsWith('bounded-row-') ||
          row.id.startsWith('window-notice-'))
      if (!ephemeral) return true
      if (
        page.range &&
        row.position >= page.range.startByte &&
        row.position <= page.range.endByte
      )
        return false
      return !page.contributions!.some(
        (incoming) =>
          incoming.position === row.position && incoming.role !== 'notice'
      )
    })
    const contributions = reconcileContributions([
      ...prior,
      ...page.contributions
    ])
    let chars = 0
    let parts = 0
    let start = contributions.length
    while (start > 0 && contributions.length - start < 4096) {
      const row = contributions[start - 1]
      const length = new TextEncoder().encode(JSON.stringify(row)).byteLength
      if (chars + length > 16 * 1024 * 1024 || parts + row.parts.length > 16384)
        break
      chars += length
      parts += row.parts.length
      start--
    }
    const limited = start > 0
    const retained = limited
      ? older
        ? previous.contributions
        : contributions.slice(start)
      : contributions
    const retentionLimited = limited || previous.retentionLimited
    const turns = groupContributions(retained)
    if (retentionLimited)
      turns.push({
        id: 'loaded-chat-limit',
        role: 'assistant',
        ts: null,
        parts: [
          {
            kind: 'notice',
            text: 'Loaded Chat limit reached. Some history is not retained; use Terminal for further history.'
          }
        ]
      })
    return {
      contributions: retained,
      turns,
      metadata: older ? previous.metadata : page.metadata,
      abandoned: older ? previous.abandoned : page.abandoned,
      source: page.source,
      sessionKey: page.sessionKey,
      retentionLimited,
      before: retentionLimited ? null : older ? page.before : previous.before
    }
  }
  const turns = new Map<string, IConversationTurn>()
  if (older) {
    for (const turn of page.turns) turns.set(turn.id, turn)
    for (const turn of previous.turns) turns.set(turn.id, turn)
  } else {
    for (const turn of previous.turns) turns.set(turn.id, turn)
    for (const turn of page.turns) turns.set(turn.id, turn)
  }
  return {
    contributions: previous.contributions,
    turns: [...turns.values()],
    metadata: older ? previous.metadata : page.metadata,
    abandoned: older ? previous.abandoned : page.abandoned,
    source: page.source,
    sessionKey: page.sessionKey,
    before: older ? page.before : previous.before,
    retentionLimited: previous.retentionLimited
  }
}

/** Exact-pane read lifetime. Browser recovery invalidates tickets, not history. */
export const createConversationReader = ({
  paneId,
  getState,
  publish,
  onLoading,
  onError,
  pollIntervalMs = 2000,
  read = fetchPaneConversation,
  page = document,
  browser = window
}: {
  paneId: string
  getState: () => IConversationState
  publish: (state: IConversationState) => void
  onLoading: (loading: boolean, older: boolean) => void
  onError: (error: string | null, code: string | null) => void
  pollIntervalMs?: number
  read?: typeof fetchPaneConversation
  page?: Document
  browser?: Window
}) => {
  let stopped = false
  let suspended = page.visibilityState === 'hidden'
  let pending: { controller: AbortController } | null = null
  const retire = () => {
    const old = pending
    pending = null
    old?.controller.abort()
    onLoading(false, false)
  }
  const request = async (
    older = false,
    signal?: AbortSignal
  ): Promise<boolean> => {
    if (stopped || suspended || pending || signal?.aborted) return false
    const before = older ? getState().before : null
    if (older && !before) return false
    const ticket = { controller: new AbortController() }
    pending = ticket
    onLoading(true, older)
    const cancel = () => {
      // Cancelling Find retires only its own read, never a newer recovery read.
      if (pending === ticket) retire()
    }
    signal?.addEventListener('abort', cancel, { once: true })
    const current = () => !stopped && pending === ticket
    try {
      let result: IConversationRead
      try {
        result = await read(paneId, {
          before,
          signal: ticket.controller.signal
        })
      } catch (error) {
        if (!current()) return false
        if (!(error instanceof ConversationError) || error.status !== 409)
          throw error
        publish(emptyConversation())
        // Preserve the existing single stale-history retry within this gate.
        result = await read(paneId, { signal: ticket.controller.signal })
      }
      if (!current()) return false
      if (
        older &&
        getState().sessionKey &&
        getState().sessionKey !== result.sessionKey
      ) {
        publish(emptyConversation())
        result = await read(paneId, { signal: ticket.controller.signal })
        if (!current()) return false
      }
      publish(reconcileConversation(getState(), result, older))
      onError(null, null)
      return true
    } catch (error) {
      if (!current()) return false
      if (error instanceof ConversationError && error.status === 409)
        publish(emptyConversation())
      onError(
        error instanceof Error ? error.message : 'Conversation unavailable',
        error instanceof ConversationError ? (error.code ?? null) : null
      )
      return false
    } finally {
      signal?.removeEventListener('abort', cancel)
      if (current()) {
        pending = null
        onLoading(false, false)
      }
    }
  }
  const suspend = () => {
    if (stopped || suspended) return
    suspended = true
    retire()
  }
  const recover = () => {
    if (stopped || !suspended || page.visibilityState === 'hidden') return
    suspended = false
    // Suspend already retired the old ticket. Preserve this resume read when
    // visible/pageshow/online overlap, even if a later notification is delayed.
    void request()
  }
  const visibility = () => {
    if (page.visibilityState === 'hidden') suspend()
    else recover()
  }
  page.addEventListener('visibilitychange', visibility)
  browser.addEventListener('pagehide', suspend)
  browser.addEventListener('pageshow', recover)
  browser.addEventListener('online', recover)
  browser.addEventListener('offline', suspend)
  const timer =
    pollIntervalMs > 0
      ? setInterval(() => {
          void request()
        }, pollIntervalMs)
      : null
  void request()
  return {
    request,
    stop: () => {
      stopped = true
      // Cleanup must not publish loading state into an unmounted owner.
      const old = pending
      pending = null
      old?.controller.abort()
      if (timer) clearInterval(timer)
      page.removeEventListener('visibilitychange', visibility)
      browser.removeEventListener('pagehide', suspend)
      browser.removeEventListener('pageshow', recover)
      browser.removeEventListener('online', recover)
      browser.removeEventListener('offline', suspend)
    }
  }
}

export const useConversation = ({
  paneId,
  isEnabled = true,
  pollIntervalMs = 2000
}: IUseConversationOptions) => {
  const [state, setState] = useState<IConversationState>(emptyConversation)
  const stateRef = useRef(state)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const readerRef = useRef<ReturnType<typeof createConversationReader> | null>(
    null
  )
  const publish = useCallback((next: IConversationState) => {
    stateRef.current = next
    setState(next)
  }, [])

  useEffect(() => {
    publish(emptyConversation())
    setError(null)
    setErrorCode(null)
    setIsLoading(false)
    setIsLoadingOlder(false)
  }, [paneId, isEnabled, publish])

  useEffect(() => {
    if (!paneId || !isEnabled || typeof window === 'undefined') return
    setIsLoading(false)
    setIsLoadingOlder(false)
    const reader = createConversationReader({
      paneId,
      pollIntervalMs,
      getState: () => stateRef.current,
      publish,
      onLoading: (loading, older) => {
        setIsLoading(loading && !older)
        setIsLoadingOlder(loading && older)
      },
      onError: (message, code) => {
        setError(message)
        setErrorCode(code)
      }
    })
    readerRef.current = reader
    return () => {
      readerRef.current = null
      reader.stop()
    }
  }, [paneId, isEnabled, pollIntervalMs, publish])

  const loadOlder = useCallback(
    (signal?: AbortSignal) =>
      readerRef.current?.request(true, signal) ?? Promise.resolve(false),
    []
  )
  const refetch = useCallback(
    () => readerRef.current?.request() ?? Promise.resolve(),
    []
  )
  return {
    ...state,
    isLoading,
    isLoadingOlder,
    error,
    errorCode,
    hasOlder: Boolean(state.before),
    loadOlder,
    refetch
  }
}
