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
  const generationRef = useRef(0)
  const requestRef = useRef<{
    controller: AbortController
    generation: number
  } | null>(null)
  const publish = useCallback((next: IConversationState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const request = useCallback(
    async (older: boolean, generation: number) => {
      if (
        !paneId ||
        !isEnabled ||
        generation !== generationRef.current ||
        requestRef.current
      )
        return
      const before = older ? stateRef.current.before : null
      if (older && !before) return
      const ticket = { controller: new AbortController(), generation }
      requestRef.current = ticket
      if (older) setIsLoadingOlder(true)
      else setIsLoading(true)
      const current = () =>
        generation === generationRef.current && requestRef.current === ticket
      try {
        let page: IConversationRead
        try {
          page = await fetchPaneConversation(paneId, {
            before,
            signal: ticket.controller.signal
          })
        } catch (err) {
          if (!current()) return
          if (!(err instanceof ConversationError) || err.status !== 409)
            throw err
          publish(emptyConversation())
          // Retry once without stale paging/session state, within the same gate.
          page = await fetchPaneConversation(paneId, {
            signal: ticket.controller.signal
          })
        }
        if (!current()) return
        if (
          older &&
          stateRef.current.sessionKey &&
          stateRef.current.sessionKey !== page.sessionKey
        ) {
          publish(emptyConversation())
          page = await fetchPaneConversation(paneId, {
            signal: ticket.controller.signal
          })
          if (!current()) return
        }
        publish(reconcileConversation(stateRef.current, page, older))
        setError(null)
        setErrorCode(null)
      } catch (err) {
        if (!current()) return
        if (err instanceof ConversationError && err.status === 409)
          publish(emptyConversation())
        setError(
          err instanceof Error ? err.message : 'Conversation unavailable'
        )
        setErrorCode(
          err instanceof ConversationError ? (err.code ?? null) : null
        )
      } finally {
        if (current()) {
          requestRef.current = null
          setIsLoading(false)
          setIsLoadingOlder(false)
        }
      }
    },
    [paneId, isEnabled, publish]
  )

  useEffect(() => {
    requestRef.current?.controller.abort()
    requestRef.current = null
    const generation = ++generationRef.current
    publish(emptyConversation())
    setError(null)
    setErrorCode(null)
    setIsLoading(false)
    setIsLoadingOlder(false)
    if (paneId && isEnabled) void request(false, generation)
    return () => {
      ++generationRef.current
      requestRef.current?.controller.abort()
      requestRef.current = null
    }
  }, [paneId, isEnabled, publish, request])

  useEffect(() => {
    if (!paneId || !isEnabled || pollIntervalMs <= 0) return
    const refreshVisible = () => {
      if (document.visibilityState !== 'hidden')
        void request(false, generationRef.current)
    }
    const timer = setInterval(refreshVisible, pollIntervalMs)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [paneId, isEnabled, pollIntervalMs, request])

  const loadOlder = useCallback(
    () => request(true, generationRef.current),
    [request]
  )
  const refetch = useCallback(
    () => request(false, generationRef.current),
    [request]
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
