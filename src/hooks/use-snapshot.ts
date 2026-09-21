import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSnapshot } from '@/services/api-client.ts'
import type { IPane, ISnapshotResult, ISnapshotStatus } from '@/types/herdr.ts'
import {
  selectBestPaneForWorkspace,
  selectFocusedPaneFromSnapshot
} from '@/utils/workspace-helpers.ts'
import { parseServerEventMessage } from '@/utils/event-stream.ts'
import { bridgeStatusIsHealthy } from '@/utils/bridge-status.ts'

export interface IUseSnapshotReturn {
  snapshot: ISnapshotResult | null
  status: ISnapshotStatus
  error: string | null
  selectedWorkspaceId: string | null
  selectedPaneId: string | null
  selectedPane: IPane | null
  setSelectedWorkspaceId: (workspaceId: string) => void
  setSelectedPaneId: (paneId: string, workspaceId?: string) => void
  selectWorkspace: (workspaceId: string) => void
  refreshSnapshot: () => Promise<boolean>
}

export const useSnapshot = (pollIntervalMs = 2000): IUseSnapshotReturn => {
  const [snapshot, setSnapshot] = useState<ISnapshotResult | null>(null)
  const [status, setStatus] = useState<ISnapshotStatus>('loading')
  const [error, setError] = useState<string | null>(null)

  const [selectedWorkspaceId, setSelectedWorkspaceIdState] = useState<string | null>(null)
  const [selectedPaneId, setSelectedPaneIdState] = useState<string | null>(null)

  const selectedPaneIdRef = useRef<string | null>(null)
  selectedPaneIdRef.current = selectedPaneId

  const selectedWorkspaceIdRef = useRef<string | null>(null)
  selectedWorkspaceIdRef.current = selectedWorkspaceId

  const snapshotRef = useRef<ISnapshotResult | null>(null)
  snapshotRef.current = snapshot

  const isFirstLoadRef = useRef(true)
  const isEventStreamHealthyRef = useRef(false)

  const selectBestPane = useCallback((snap: ISnapshotResult): { paneId: string; workspaceId: string } | null => {
    if (!snap.panes || snap.panes.length === 0) {
      return null
    }

    // 1. Check if current selection is still valid and in selected workspace
    const currentPane = snap.panes.find((p) => p.pane_id === selectedPaneIdRef.current)
    if (currentPane) {
      if (!selectedWorkspaceIdRef.current || currentPane.workspace_id === selectedWorkspaceIdRef.current) {
        return { paneId: currentPane.pane_id, workspaceId: currentPane.workspace_id }
      }
    }

    // 2. If workspace is selected, pick best pane in that workspace
    if (selectedWorkspaceIdRef.current) {
      const bestInWs = selectBestPaneForWorkspace(snap.panes, selectedWorkspaceIdRef.current, snap.focused_pane_id)
      if (bestInWs) {
        return { paneId: bestInWs.pane_id, workspaceId: bestInWs.workspace_id }
      }
    }

    // 3. Initial/global preference: Herdr's authoritative focused workspace/tab/pane chain
    const focusedPane = selectFocusedPaneFromSnapshot(snap)
    if (focusedPane) {
      return { paneId: focusedPane.pane_id, workspaceId: focusedPane.workspace_id }
    }

    // 4. Fall back to a blocked agent when Herdr exposes no focused target
    const blockedPane = snap.panes.find((p) => p.agent_status === 'blocked')
    if (blockedPane) {
      return { paneId: blockedPane.pane_id, workspaceId: blockedPane.workspace_id }
    }

    // 5. First pane overall
    const firstPane = snap.panes[0]
    return { paneId: firstPane.pane_id, workspaceId: firstPane.workspace_id }
  }, [])

  const applySnapshot = useCallback((data: ISnapshotResult) => {
    snapshotRef.current = data
    setSnapshot(data)
    setError(null)

    if (!data.panes || data.panes.length === 0) {
      setStatus('empty')
      return
    }

    setStatus('connected')

    const currentWsId = selectedWorkspaceIdRef.current
    const currentPaneId = selectedPaneIdRef.current
    const currentPane = data.panes.find((p) => p.pane_id === currentPaneId)

    if (currentWsId) {
      // Reconcile: pane must belong to current workspace
      if (!currentPane || currentPane.workspace_id !== currentWsId) {
        const best = selectBestPaneForWorkspace(data.panes, currentWsId, data.focused_pane_id)
        if (best) {
          setSelectedPaneIdState(best.pane_id)
          selectedPaneIdRef.current = best.pane_id
        } else {
          const globalBest = selectBestPane(data)
          if (globalBest) {
            setSelectedWorkspaceIdState(globalBest.workspaceId)
            selectedWorkspaceIdRef.current = globalBest.workspaceId
            setSelectedPaneIdState(globalBest.paneId)
            selectedPaneIdRef.current = globalBest.paneId
          }
        }
      }
    } else {
      const best = selectBestPane(data)
      if (best) {
        setSelectedWorkspaceIdState(best.workspaceId)
        selectedWorkspaceIdRef.current = best.workspaceId
        setSelectedPaneIdState(best.paneId)
        selectedPaneIdRef.current = best.paneId
      }
    }
  }, [selectBestPane])

  const selectWorkspace = useCallback((workspaceId: string) => {
    setSelectedWorkspaceIdState(workspaceId)
    selectedWorkspaceIdRef.current = workspaceId

    const currentPanes = snapshotRef.current?.panes || []
    const focusedPaneId = snapshotRef.current?.focused_pane_id
    const best = selectBestPaneForWorkspace(currentPanes, workspaceId, focusedPaneId)
    if (best) {
      setSelectedPaneIdState(best.pane_id)
      selectedPaneIdRef.current = best.pane_id
    } else {
      setSelectedPaneIdState(null)
      selectedPaneIdRef.current = null
    }
  }, [])

  const selectPane = useCallback((paneId: string, workspaceId?: string) => {
    setSelectedPaneIdState(paneId)
    selectedPaneIdRef.current = paneId

    if (workspaceId) {
      setSelectedWorkspaceIdState(workspaceId)
      selectedWorkspaceIdRef.current = workspaceId
    } else {
      const pane = snapshotRef.current?.panes?.find((p) => p.pane_id === paneId)
      if (pane) {
        setSelectedWorkspaceIdState(pane.workspace_id)
        selectedWorkspaceIdRef.current = pane.workspace_id
      }
    }
  }, [])

  const loadSnapshot = useCallback(async (isPolling = false): Promise<boolean> => {
    try {
      const data = await fetchSnapshot()
      applySnapshot(data)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      if (isFirstLoadRef.current) {
        setStatus('error')
      } else if (isPolling) {
        setStatus('reconnecting')
      }
      return false
    } finally {
      isFirstLoadRef.current = false
    }
  }, [applySnapshot])

  const refreshSnapshot = useCallback(async (): Promise<boolean> => {
    return await loadSnapshot(false)
  }, [loadSnapshot])

  // WebSocket Event Stream connection
  useEffect(() => {
    if (typeof window === 'undefined') return

    let ws: WebSocket | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let backoffMs = 1000
    const maxBackoffMs = 8000
    let isCleanedUp = false

    const connectWs = () => {
      if (isCleanedUp) return

      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsUrl = `${protocol}//${window.location.host}/api/events`
        ws = new WebSocket(wsUrl)

        ws.onopen = () => {
          if (isCleanedUp) {
            ws?.close()
            return
          }
          // Socket-open is not healthy until the backend bridge reports connected.
          isEventStreamHealthyRef.current = false
          backoffMs = 1000
        }

        ws.onmessage = (event) => {
          if (isCleanedUp) return
          const message = parseServerEventMessage(event.data)
          if (!message) return

          if (message.type === 'snapshot') {
            applySnapshot(message.data)
          } else if (message.type === 'status') {
            isEventStreamHealthyRef.current = bridgeStatusIsHealthy(message.status)
            if (!isEventStreamHealthyRef.current) {
              setStatus((current) => (current === 'connected' ? 'reconnecting' : current))
            }
          }
        }

        ws.onclose = () => {
          isEventStreamHealthyRef.current = false
          if (isCleanedUp) return

          setStatus((current) => (current === 'connected' ? 'reconnecting' : current))
          const delay = backoffMs
          backoffMs = Math.min(backoffMs * 1.5, maxBackoffMs)
          reconnectTimeout = setTimeout(connectWs, delay)
        }

        ws.onerror = () => {
          isEventStreamHealthyRef.current = false
        }
      } catch {
        isEventStreamHealthyRef.current = false
        const delay = backoffMs
        backoffMs = Math.min(backoffMs * 1.5, maxBackoffMs)
        reconnectTimeout = setTimeout(connectWs, delay)
      }
    }

    connectWs()

    return () => {
      isCleanedUp = true
      isEventStreamHealthyRef.current = false
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout)
      }
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onclose = null
        ws.onerror = null
        ws.close()
      }
    }
  }, [applySnapshot])

  // HTTP Polling: Bootstrap on mount, and fallback only when WebSocket is not healthy
  useEffect(() => {
    // Initial bootstrap load
    loadSnapshot(false)

    const interval = setInterval(() => {
      // 2s polling stops while event stream is healthy
      if (isEventStreamHealthyRef.current) return
      loadSnapshot(true)
    }, pollIntervalMs)

    return () => clearInterval(interval)
  }, [loadSnapshot, pollIntervalMs])

  const selectedPane = snapshot?.panes?.find((p) => p.pane_id === selectedPaneId) || null

  return {
    snapshot,
    status,
    error,
    selectedWorkspaceId,
    selectedPaneId,
    selectedPane,
    setSelectedWorkspaceId: selectWorkspace,
    setSelectedPaneId: selectPane,
    selectWorkspace,
    refreshSnapshot
  }
}
