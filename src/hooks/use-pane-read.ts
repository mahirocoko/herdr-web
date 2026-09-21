import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchPaneRead } from '@/services/api-client.ts'
import type { IPaneReadSource } from '@/types/herdr.ts'

export interface IUsePaneReadOptions {
  paneId: string | null
  source: IPaneReadSource
  lines?: number
  isEnabled?: boolean
  pollIntervalMs?: number
}

export interface IUsePaneReadResult {
  content: string | null
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export const usePaneRead = ({
  paneId,
  source,
  lines,
  isEnabled = true,
  pollIntervalMs = 0
}: IUsePaneReadOptions): IUsePaneReadResult => {
  const [content, setContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mountedRef = useRef(true)
  const isFetchingRef = useRef(false)
  const requestIdRef = useRef(0)
  const currentPaneIdRef = useRef<string | null>(paneId)
  currentPaneIdRef.current = paneId
  const prevPaneIdRef = useRef<string | null>(paneId)

  const fetchContent = useCallback(
    async (force = false) => {
      if (!paneId || !isEnabled) return
      if (isFetchingRef.current && !force) return

      const requestId = ++requestIdRef.current
      isFetchingRef.current = true

      try {
        const res = await fetchPaneRead(paneId, source, lines)
        if (
          mountedRef.current &&
          requestId === requestIdRef.current &&
          currentPaneIdRef.current === paneId
        ) {
          setContent(res.content)
          setError(null)
        }
      } catch (err) {
        if (
          mountedRef.current &&
          requestId === requestIdRef.current &&
          currentPaneIdRef.current === paneId
        ) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) {
          isFetchingRef.current = false
          setIsLoading(false)
        }
      }
    },
    [paneId, source, lines, isEnabled]
  )

  useEffect(() => {
    mountedRef.current = true

    if (!paneId || !isEnabled) {
      setContent(null)
      setError(null)
      setIsLoading(false)
      isFetchingRef.current = false
      return
    }

    // Immediately clear content and reset fetch lock on pane switch to avoid showing stale data
    if (prevPaneIdRef.current !== paneId) {
      prevPaneIdRef.current = paneId
      setContent(null)
      setError(null)
      isFetchingRef.current = false
    }

    setIsLoading(true)
    fetchContent(true)

    if (pollIntervalMs > 0) {
      const timer = setInterval(() => {
        fetchContent(false)
      }, pollIntervalMs)

      return () => {
        clearInterval(timer)
      }
    }
  }, [paneId, source, lines, isEnabled, pollIntervalMs, fetchContent])

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleRefetch = useCallback(async () => {
    if (!paneId || !isEnabled) return
    setIsLoading(true)
    await fetchContent(true)
  }, [paneId, isEnabled, fetchContent])

  return {
    content,
    isLoading,
    error,
    refetch: handleRefetch
  }
}
