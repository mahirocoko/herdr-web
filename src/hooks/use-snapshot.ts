import { useCallback, useEffect, useRef, useState } from 'react'
import { createSnapshotReader } from '@/services/snapshot-reader.ts'
import type { IPane, ISnapshotResult, ISnapshotStatus } from '@/types/herdr.ts'
import {
  reconcileSnapshotSelection,
  selectBestPaneForWorkspace
} from '@/utils/workspace-helpers.ts'

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
  getSnapshot: () => ISnapshotResult | null
}

export const useSnapshot = (pollIntervalMs = 2000): IUseSnapshotReturn => {
  const [snapshot, setSnapshot] = useState<ISnapshotResult | null>(null)
  const [status, setStatus] = useState<ISnapshotStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [selectedWorkspaceId, setSelectedWorkspaceIdState] = useState<
    string | null
  >(null)
  const [selectedPaneId, setSelectedPaneIdState] = useState<string | null>(null)
  const selectedPaneIdRef = useRef<string | null>(null)
  selectedPaneIdRef.current = selectedPaneId
  const selectedWorkspaceIdRef = useRef<string | null>(null)
  selectedWorkspaceIdRef.current = selectedWorkspaceId
  const snapshotRef = useRef<ISnapshotResult | null>(null)
  snapshotRef.current = snapshot
  const readerRef = useRef<ReturnType<typeof createSnapshotReader> | null>(null)

  const applySnapshot = useCallback((data: ISnapshotResult) => {
    snapshotRef.current = data
    setSnapshot(data)
    setError(null)
    if (
      !data.workspaces ||
      data.workspaces.length === 0 ||
      !data.panes ||
      data.panes.length === 0
    ) {
      setSelectedWorkspaceIdState(null)
      selectedWorkspaceIdRef.current = null
      setSelectedPaneIdState(null)
      selectedPaneIdRef.current = null
      setStatus('empty')
      return
    }
    setStatus('connected')
    const nextSelection = reconcileSnapshotSelection(
      data,
      selectedWorkspaceIdRef.current,
      selectedPaneIdRef.current
    )
    setSelectedWorkspaceIdState(nextSelection.workspaceId)
    selectedWorkspaceIdRef.current = nextSelection.workspaceId
    setSelectedPaneIdState(nextSelection.paneId)
    selectedPaneIdRef.current = nextSelection.paneId
  }, [])

  const selectWorkspace = useCallback((workspaceId: string) => {
    setSelectedWorkspaceIdState(workspaceId)
    selectedWorkspaceIdRef.current = workspaceId
    const currentPanes = snapshotRef.current?.panes || []
    const focusedPaneId = snapshotRef.current?.focused_pane_id
    const best = selectBestPaneForWorkspace(
      currentPanes,
      workspaceId,
      focusedPaneId
    )
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

  useEffect(() => {
    if (typeof window === 'undefined') return
    const reader = createSnapshotReader({
      pollIntervalMs,
      onSnapshot: applySnapshot,
      onError: (err) => {
        setError(err instanceof Error ? err.message : String(err))
        setStatus(snapshotRef.current ? 'reconnecting' : 'error')
      },
      onReconnecting: () => {
        setStatus((current) =>
          current === 'connected' ? 'reconnecting' : current
        )
      }
    })
    readerRef.current = reader
    return () => {
      readerRef.current = null
      reader.stop()
    }
  }, [applySnapshot, pollIntervalMs])

  const refreshSnapshot = useCallback(
    (): Promise<boolean> =>
      readerRef.current?.refresh() ?? Promise.resolve(false),
    []
  )
  const getSnapshot = useCallback(
    (): ISnapshotResult | null => snapshotRef.current,
    []
  )
  const selectedPane =
    snapshot?.panes?.find((p) => p.pane_id === selectedPaneId) || null
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
    refreshSnapshot,
    getSnapshot
  }
}
