import { useCallback, useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import { usePaneRead } from '@/hooks/use-pane-read.ts'
import { sendAction } from '@/services/api-client.ts'
import HorizonHeader from '@/components/horizon-header.tsx'
import AttentionHorizon from '@/components/attention-horizon.tsx'
import SurfaceHeader from '@/components/surface-header.tsx'
import TerminalCanvas from '@/components/terminal-canvas.tsx'
import QuestionView from '@/components/question-view.tsx'
import PanelView from '@/components/panel-view.tsx'
import HistoryView from '@/components/history-view.tsx'
import PaneDrawer from '@/components/pane-drawer.tsx'
import GlobalDrawer from '@/components/global-drawer.tsx'
import ThumbDeck from '@/components/thumb-deck.tsx'
import PromptComposer from '@/components/prompt-composer.tsx'
import { resolveSurfaceMode, type ISurfaceMode } from '@/utils/surface-mode.ts'
import { executeGuardedAction, type ActionResultStatus } from '@/utils/action-orchestrator.ts'
import { deriveActionTarget, formatActionErrorMessage } from '@/utils/action-target.ts'
import { isAgentPane } from '@/utils/workspace-helpers.ts'
import {
  type ITerminalControlOwnership,
  evaluateControlStatusResponse,
  getTerminalControlFooterNotice,
  isLateControlOwnershipCallback,
  shouldReleaseControlOnPaneChange,
  shouldReleaseControlOnViewChange
} from '@/utils/terminal-control-ownership.ts'
import { fetchTerminalControlStatus } from '@/services/api-client.ts'
import type { IExpectedPaneMode } from '@/types/herdr.ts'
import type { IAppOutletContext } from '../app/root.tsx'
import '@/app.css'

export interface ISpaceDashboardProps {
  workspaceId: string
}

export const SpaceDashboard: FC<ISpaceDashboardProps> = ({ workspaceId }) => {
  const {
    snapshot,
    status,
    snapshotError,
    selectedWorkspaceId,
    selectedPaneId,
    selectedPane,
    setSelectedWorkspaceId,
    setSelectedPaneId,
    refreshSnapshot,
    push,
    viewportGeometry,
    drawerTriggerRef,
    menuTriggerRef,
    shouldRestoreMenuFocusRef
  } = useOutletContext<IAppOutletContext>()

  const navigate = useNavigate()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isGlobalDrawerOpen, setIsGlobalDrawerOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const isBusyRef = useRef(isBusy)
  isBusyRef.current = isBusy
  const [actionError, setActionError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ISurfaceMode>('panel')
  const viewModeRef = useRef<ISurfaceMode>(viewMode)
  viewModeRef.current = viewMode

  const [controlOwnership, setControlOwnership] = useState<ITerminalControlOwnership>('idle')
  const controlOwnershipRef = useRef<ITerminalControlOwnership>(controlOwnership)
  controlOwnershipRef.current = controlOwnership

  const selectedPaneIdRef = useRef<string | null>(selectedPaneId)
  selectedPaneIdRef.current = selectedPaneId

  const controlPaneIdRef = useRef<string | null>(null)
  const pollGenerationRef = useRef<number>(0)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollAbortControllerRef = useRef<AbortController | null>(null)

  const stopReleasePolling = useCallback(() => {
    pollGenerationRef.current++
    if (pollAbortControllerRef.current) {
      pollAbortControllerRef.current.abort()
      pollAbortControllerRef.current = null
    }
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const startReleasePolling = useCallback((targetPane: string) => {
    stopReleasePolling()
    const currentGen = pollGenerationRef.current
    const controller = new AbortController()
    pollAbortControllerRef.current = controller

    const pollOnce = async () => {
      if (currentGen !== pollGenerationRef.current || controller.signal.aborted) {
        return
      }

      let statusResult = null
      let fetchError: unknown = null
      try {
        statusResult = await fetchTerminalControlStatus(targetPane, controller.signal)
      } catch (err) {
        if (controller.signal.aborted || currentGen !== pollGenerationRef.current) {
          return
        }
        fetchError = err
      }

      if (controller.signal.aborted || currentGen !== pollGenerationRef.current) {
        return
      }

      const step = evaluateControlStatusResponse({
        currentGeneration: currentGen,
        activeGeneration: pollGenerationRef.current,
        targetPaneId: targetPane,
        statusResult,
        fetchError
      })

      if (step.action === 'ignore_stale') {
        return
      }

      if (step.action === 'transition_to_idle') {
        stopReleasePolling()
        controlPaneIdRef.current = null
        setControlOwnership('idle')
        return
      }

      // remain_releasing: poll again serially with bounded interval (250ms)
      if (currentGen === pollGenerationRef.current && !controller.signal.aborted) {
        pollTimerRef.current = setTimeout(pollOnce, 250)
      }
    }

    void pollOnce()
  }, [stopReleasePolling])

  const handleControlOwnershipChange = useCallback((nextOwnership: ITerminalControlOwnership, explicitPaneId?: string) => {
    const targetPane = explicitPaneId || controlPaneIdRef.current || selectedPaneIdRef.current

    if (nextOwnership === 'engaging' || nextOwnership === 'active') {
      const isLate = isLateControlOwnershipCallback({
        nextOwnership,
        notifiedPaneId: explicitPaneId || controlPaneIdRef.current,
        currentSelectedPaneId: selectedPaneIdRef.current,
        currentViewMode: viewModeRef.current
      })

      if (isLate) {
        if (targetPane) {
          controlPaneIdRef.current = targetPane
          setControlOwnership('releasing')
          startReleasePolling(targetPane)
        } else {
          stopReleasePolling()
          controlPaneIdRef.current = null
          setControlOwnership('idle')
        }
        return
      }

      stopReleasePolling()
      if (targetPane) {
        controlPaneIdRef.current = targetPane
      }
      setControlOwnership(nextOwnership)
      return
    }

    if (nextOwnership === 'releasing') {
      if (!targetPane) {
        stopReleasePolling()
        controlPaneIdRef.current = null
        setControlOwnership('idle')
        return
      }
      controlPaneIdRef.current = targetPane
      setControlOwnership('releasing')
      startReleasePolling(targetPane)
      return
    }

    if (nextOwnership === 'idle') {
      stopReleasePolling()
      controlPaneIdRef.current = null
      setControlOwnership('idle')
    }
  }, [startReleasePolling, stopReleasePolling])

  // Track previous pane and surface mode for bounded parent navigation fallback
  const prevControlPaneIdRef = useRef<string | null>(selectedPaneId)
  const prevControlViewModeRef = useRef<ISurfaceMode>(viewMode)

  // Reset control mode on actual pane switch (fallback for parent navigation)
  useEffect(() => {
    const prevPaneId = prevControlPaneIdRef.current
    prevControlPaneIdRef.current = selectedPaneId
    if (shouldReleaseControlOnPaneChange(prevPaneId, selectedPaneId, controlOwnershipRef.current)) {
      handleControlOwnershipChange('releasing', prevPaneId || undefined)
    }
  }, [selectedPaneId, handleControlOwnershipChange])

  // Reset control mode if surface actually changes away from stream (fallback for parent navigation)
  useEffect(() => {
    const prevView = prevControlViewModeRef.current
    prevControlViewModeRef.current = viewMode
    if (shouldReleaseControlOnViewChange(prevView, viewMode, controlOwnershipRef.current)) {
      handleControlOwnershipChange('releasing')
    }
  }, [viewMode, handleControlOwnershipChange])

  // Clean up release polling on unmount
  useEffect(() => {
    return () => {
      stopReleasePolling()
    }
  }, [stopReleasePolling])

  // Synchronize route workspaceId with selectedWorkspaceId
  useEffect(() => {
    if (workspaceId && selectedWorkspaceId !== workspaceId) {
      setSelectedWorkspaceId(workspaceId)
    }
  }, [workspaceId, selectedWorkspaceId, setSelectedWorkspaceId])

  // Intentional focus restoration when returning from settings
  useEffect(() => {
    if (shouldRestoreMenuFocusRef.current) {
      shouldRestoreMenuFocusRef.current = false
      requestAnimationFrame(() => menuTriggerRef.current?.focus())
    }
  }, [shouldRestoreMenuFocusRef, menuTriggerRef])

  const workspaces = snapshot?.workspaces || []
  const tabs = snapshot?.tabs || []
  const panes = snapshot?.panes || []

  const activeWorkspace = workspaces.find((w) => w.workspace_id === workspaceId) || null
  const activeTab = tabs.find((t) => t.tab_id === selectedPane?.tab_id) || null
  const blockedPanes = panes.filter((p) => p.agent_status === 'blocked')
  const isSelectedPaneBlocked = selectedPane?.agent_status === 'blocked'

  // Manage surface mode transitions
  const prevBlockedRef = useRef<boolean>(false)
  const prevPaneIdRef = useRef<string | null>(null)

  useEffect(() => {
    const paneChanged = selectedPaneId !== prevPaneIdRef.current
    const wasBlocked = prevBlockedRef.current

    const nextMode = resolveSurfaceMode({
      currentMode: viewMode,
      isBlocked: isSelectedPaneBlocked,
      wasBlocked,
      paneChanged
    })

    if (nextMode !== viewMode) {
      setViewMode(nextMode)
    }

    prevPaneIdRef.current = selectedPaneId
    prevBlockedRef.current = isSelectedPaneBlocked
  }, [selectedPaneId, isSelectedPaneBlocked, viewMode])

  // Question view reads complete detection snapshot
  const {
    content: questionContent,
    isLoading: isQuestionLoading,
    error: questionError,
    refetch: refetchQuestion
  } = usePaneRead({
    paneId: selectedPaneId,
    source: 'detection',
    isEnabled: isSelectedPaneBlocked || viewMode === 'question',
    pollIntervalMs: isSelectedPaneBlocked && viewMode === 'question' ? 2000 : 0
  })

  // Panel view reads complete current source snapshot
  const {
    content: panelContent,
    isLoading: isPanelLoading,
    error: panelError,
    refetch: refetchPanel
  } = usePaneRead({
    paneId: selectedPaneId,
    source: 'visible',
    isEnabled: viewMode === 'panel',
    pollIntervalMs: viewMode === 'panel' ? 1000 : 0
  })

  // History view reads bounded recent-unwrapped 1000 lines
  const {
    content: historyContent,
    isLoading: isHistoryLoading,
    error: historyError,
    refetch: refetchHistory
  } = usePaneRead({
    paneId: selectedPaneId,
    source: 'recent-unwrapped',
    lines: 1000,
    isEnabled: viewMode === 'history',
    pollIntervalMs: viewMode === 'history' ? 2000 : 0
  })

  const isAgentPaneForControl = isAgentPane(selectedPane, snapshot?.agents)

  const refetchActiveSurface = async () => {
    if (viewMode === 'question') {
      await refetchQuestion()
    } else if (viewMode === 'panel') {
      await refetchPanel()
    } else if (viewMode === 'history') {
      await refetchHistory()
    }
  }

  const targetResult = deriveActionTarget(selectedPane, snapshot?.agents)
  const canonicalExpectedMode: IExpectedPaneMode =
    targetResult.target?.expectedMode ??
    (isAgentPaneForControl ? (isSelectedPaneBlocked ? 'blocked-agent' : 'agent') : 'shell')
  const canonicalHasAgent = canonicalExpectedMode === 'agent' || canonicalExpectedMode === 'blocked-agent'
  const canonicalIsBlocked = canonicalExpectedMode === 'blocked-agent'

  const handleSubmitText = async (text: string): Promise<ActionResultStatus> => {
    if (!selectedPaneId || !targetResult.target) {
      if (targetResult.error) {
        setActionError(targetResult.error)
      }
      return 'skipped_busy'
    }
    const actionType = targetResult.target.expectedMode === 'agent' ? 'prompt' : 'terminal-input'
    const operationId = crypto.randomUUID()

    return executeGuardedAction({
      action: () =>
        sendAction({
          type: actionType,
          operationId,
          target: targetResult.target!,
          text
        }),
      onSuccessRefresh: () => {
        void Promise.allSettled([refreshSnapshot(), refetchActiveSurface()])
      },
      getIsBusy: () => isBusyRef.current,
      setIsBusy: (busy) => {
        isBusyRef.current = busy
        setIsBusy(busy)
      },
      setError: (err) => setActionError(err ? formatActionErrorMessage(err) : null)
    })
  }

  const handleSendKeys = async (keys: string[]) => {
    if (!selectedPaneId || !targetResult.target) {
      if (targetResult.error) {
        setActionError(targetResult.error)
      }
      return
    }
    const operationId = crypto.randomUUID()
    try {
      await executeGuardedAction({
        action: () =>
          sendAction({
            type: 'keys',
            operationId,
            target: targetResult.target!,
            keys
          }),
        onSuccessRefresh: () => {
          void Promise.allSettled([refreshSnapshot(), refetchActiveSurface()])
        },
        getIsBusy: () => isBusyRef.current,
        setIsBusy: (busy) => {
          isBusyRef.current = busy
          setIsBusy(busy)
        },
        setError: (err) => setActionError(err ? formatActionErrorMessage(err) : null)
      })
    } catch {
      // Key failure is recorded in setActionError by executeGuardedAction; suppress unhandled rejection for keys
    }
  }

  const handleJumpToPane = (paneId: string, wsId: string) => {
    if (wsId !== workspaceId) {
      navigate('/spaces/' + encodeURIComponent(wsId))
    }
    setSelectedPaneId(paneId, wsId)
  }

  const isCurrentSurfaceLoading =
    viewMode === 'question'
      ? isQuestionLoading
      : viewMode === 'panel'
        ? isPanelLoading
        : viewMode === 'history'
          ? isHistoryLoading
          : false

  const handleRefreshCurrentSurface =
    viewMode === 'question'
      ? refetchQuestion
      : viewMode === 'panel'
        ? refetchPanel
        : viewMode === 'history'
          ? refetchHistory
          : undefined

  const handleOpenGlobalDrawer = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setIsDrawerOpen(false)
    setIsGlobalDrawerOpen(true)
  }

  const handleCloseGlobalDrawer = () => {
    setIsGlobalDrawerOpen(false)
    requestAnimationFrame(() => menuTriggerRef?.current?.focus())
  }

  const handleOpenDrawer = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setIsGlobalDrawerOpen(false)
    setIsDrawerOpen(true)
  }

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false)
    requestAnimationFrame(() => drawerTriggerRef.current?.focus())
  }

  const handleOpenSettings = () => {
    setIsGlobalDrawerOpen(false)
    shouldRestoreMenuFocusRef.current = true
    navigate('/settings', { state: { appOwned: true } })
  }

  const appStyle = viewportGeometry
    ? {
        height: `${viewportGeometry.height}px`,
        transform: viewportGeometry.offsetTop > 0
          ? `translateY(${viewportGeometry.offsetTop}px)`
          : undefined
      }
    : undefined

  // Fail-closed view when Space is not found in an authoritative snapshot
  if (status !== 'loading' && snapshot && !activeWorkspace) {
    return (
      <div
        className="herdr-app"
        style={appStyle}
        data-keyboard-open={viewportGeometry?.isKeyboardOpen ? 'true' : undefined}
      >
        <div className="system-banner system-banner--error" role="alert">
          <span>Space "{workspaceId}" not found in the active session.</span>
        </div>
        <div className="herdr-empty-canvas">
          <button
            type="button"
            className="system-banner__retry"
            onClick={() => navigate('/', { replace: true })}
          >
            Return to Active Space
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="herdr-app"
      style={appStyle}
      data-keyboard-open={viewportGeometry?.isKeyboardOpen ? 'true' : undefined}
    >
      {/* Horizon Header */}
      <HorizonHeader
        status={status}
        activeWorkspace={activeWorkspace}
        activeTab={activeTab}
        isGlobalDrawerOpen={isGlobalDrawerOpen}
        menuTriggerRef={menuTriggerRef}
        onOpenMenu={handleOpenGlobalDrawer}
        isDrawerOpen={isDrawerOpen}
        drawerTriggerRef={drawerTriggerRef}
        onOpenDrawer={handleOpenDrawer}
      />

      {/* Attention Horizon Alert */}
      <AttentionHorizon
        blockedPanes={blockedPanes}
        currentWorkspaceId={workspaceId}
        workspaces={workspaces}
        tabs={tabs}
        onJumpToPane={handleJumpToPane}
        fallbackFocusRef={drawerTriggerRef}
      />

      {/* Connection / Snapshot Error Banner */}
      {status === 'error' && snapshotError && (
        <div className="system-banner system-banner--error" role="alert">
          <span>Failed to connect to Herdr daemon: {snapshotError}</span>
          <button type="button" className="system-banner__retry" onClick={() => refreshSnapshot()}>
            Retry
          </button>
        </div>
      )}

      {status === 'empty' && (
        <div className="system-banner system-banner--empty">
          <span>No active Herdr workspaces or panes discovered.</span>
        </div>
      )}

      {/* Core Viewport: Unified Surface Switcher + Active Surface Panel */}
      <main className="herdr-main">
        {!selectedPaneId ? (
          <div className="herdr-empty-canvas">
            <span>{status === 'loading' ? 'Loading Herdr session...' : 'No pane selected'}</span>
          </div>
        ) : (
          <div className="surface-viewport-container">
            <SurfaceHeader
              mode={viewMode}
              onSelectMode={setViewMode}
              isBlocked={isSelectedPaneBlocked}
              isLoading={isCurrentSurfaceLoading}
              onRefresh={handleRefreshCurrentSurface}
            />

            <div className="surface-viewport-body">
              {viewMode === 'question' && (
                <QuestionView
                  paneId={selectedPaneId}
                  content={questionContent}
                  isLoading={isQuestionLoading}
                  error={questionError}
                  onRefresh={refetchQuestion}
                />
              )}

              {viewMode === 'panel' && (
                <PanelView
                  paneId={selectedPaneId}
                  content={panelContent}
                  isLoading={isPanelLoading}
                  error={panelError}
                  onRefresh={refetchPanel}
                  onSwitchToStream={() => setViewMode('stream')}
                />
              )}

              {viewMode === 'history' && (
                <HistoryView
                  paneId={selectedPaneId}
                  content={historyContent}
                  isLoading={isHistoryLoading}
                  error={historyError}
                  onRefresh={refetchHistory}
                  onSwitchToStream={() => setViewMode('stream')}
                />
              )}

              {viewMode === 'stream' && (
                <div
                  className="terminal-viewport-container"
                  id="surface-panel-stream"
                  role="region"
                  aria-label="Stream Observer Viewport"
                >
                  <TerminalCanvas
                    paneId={selectedPaneId}
                    isAgentPane={isAgentPaneForControl}
                    cols={80}
                    rows={24}
                    onControlOwnershipChange={handleControlOwnershipChange}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer Controls: Prompt Composer first, then Thumb Deck (unavailable during Control) */}
      <footer className="herdr-footer">
        {controlOwnership !== 'idle' ? (
          <div className="terminal-control-footer-notice" role="status" aria-live="polite">
            <span className="terminal-control-footer-notice__text">
              {getTerminalControlFooterNotice(controlOwnership)}
            </span>
          </div>
        ) : (
          <>
            <PromptComposer
              paneId={selectedPaneId}
              terminalId={selectedPane?.terminal_id}
              agentName={selectedPane?.display_agent || selectedPane?.agent}
              isBlocked={canonicalIsBlocked}
              hasAgent={canonicalHasAgent}
              expectedMode={canonicalExpectedMode}
              isBusy={isBusy}
              isControlActive={controlOwnership !== 'idle'}
              hasValidTarget={Boolean(targetResult.target)}
              error={actionError || targetResult.error}
              onSubmitText={handleSubmitText}
            />

            <ThumbDeck
              paneId={selectedPaneId}
              isBusy={isBusy || !targetResult.target}
              onSendKeys={handleSendKeys}
            />
          </>
        )}
      </footer>

      {/* Global App Menu Drawer */}
      <GlobalDrawer
        isOpen={isGlobalDrawerOpen}
        status={status}
        pushState={push.state}
        onOpenSettings={handleOpenSettings}
        onClose={handleCloseGlobalDrawer}
      />

      {/* Pane and Workspace Switcher Drawer */}
      <PaneDrawer
        isOpen={isDrawerOpen}
        workspaces={workspaces}
        tabs={tabs}
        panes={panes}
        selectedWorkspaceId={workspaceId}
        selectedPaneId={selectedPaneId}
        onSelectWorkspace={(wsId) => {
          if (wsId !== workspaceId) {
            navigate('/spaces/' + encodeURIComponent(wsId))
          }
        }}
        onSelectPane={(pId, wsId) => {
          if (wsId && wsId !== workspaceId) {
            navigate('/spaces/' + encodeURIComponent(wsId))
          }
          setSelectedPaneId(pId, wsId)
        }}
        onClose={handleCloseDrawer}
        onRefreshSnapshot={refreshSnapshot}
      />
    </div>
  )
}

export default SpaceDashboard
