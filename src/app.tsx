import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FC } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import { usePaneRead } from '@/hooks/use-pane-read.ts'
import { sendAction } from '@/services/api-client.ts'
import HorizonHeader from '@/components/horizon-header.tsx'
import AttentionHorizon from '@/components/attention-horizon.tsx'
import TerminalCanvas from '@/components/terminal-canvas.tsx'
import QuestionView from '@/components/question-view.tsx'
import PanelView from '@/components/panel-view.tsx'
import HistoryView from '@/components/history-view.tsx'
import PaneDrawer from '@/components/pane-drawer.tsx'
import SpaceDrawer from '@/components/space-drawer.tsx'
import SidebarRoster from '@/components/sidebar-roster.tsx'
import { Sheet, SheetContent } from '@/components/ui/sheet.tsx'
import ThumbDeck from '@/components/thumb-deck.tsx'
import PromptComposer from '@/components/prompt-composer.tsx'
import Button from '@/components/ui/button.tsx'
import TabRail from '@/components/tab-rail.tsx'
import NavigationSearchSheet from '@/components/navigation-search-sheet.tsx'
import type { IPickerSheetTab } from '@/components/interaction-picker-sheet.tsx'
import { resolveSurfaceMode, type ISurfaceMode } from '@/utils/surface-mode.ts'
import {
  executeGuardedAction,
  type ActionResultStatus
} from '@/utils/action-orchestrator.ts'
import {
  deriveActionTarget,
  formatActionErrorMessage
} from '@/utils/action-target.ts'
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
import type { IExpectedPaneMode, IWorkspace } from '@/types/herdr.ts'
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
    lifecycle,
    push,
    viewportGeometry,
    drawerTriggerRef,
    menuTriggerRef,
    shouldRestoreMenuFocusRef
  } = useOutletContext<IAppOutletContext>()

  const navigate = useNavigate()
  const [isTabDrawerOpen, setIsTabDrawerOpen] = useState(false)
  const [isSpaceDrawerOpen, setIsSpaceDrawerOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [isSpaceDrawerModalOpen, setIsSpaceDrawerModalOpen] = useState(false)
  const [tabDrawerInitialView, setTabDrawerInitialView] = useState<
    'list' | 'new-tab' | 'close-tab' | 'status'
  >('list')
  const [tabDrawerTargetTabId, setTabDrawerTargetTabId] = useState<
    string | null
  >(null)
  const [spaceDrawerInitialView, setSpaceDrawerInitialView] = useState<
    'list' | 'new-space' | 'close-space'
  >('list')
  const [spaceDrawerTargetWorkspaceId, setSpaceDrawerTargetWorkspaceId] =
    useState<string | null>(null)

  const [isBusy, setIsBusy] = useState(false)
  const isBusyRef = useRef(isBusy)
  isBusyRef.current = isBusy
  const [actionError, setActionError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ISurfaceMode>('stream')
  const viewModeRef = useRef<ISurfaceMode>(viewMode)
  viewModeRef.current = viewMode

  const [controlOwnership, setControlOwnership] =
    useState<ITerminalControlOwnership>('idle')
  const controlOwnershipRef =
    useRef<ITerminalControlOwnership>(controlOwnership)
  controlOwnershipRef.current = controlOwnership

  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [pickerInitialTab, setPickerInitialTab] =
    useState<IPickerSheetTab>('commands')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null)

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

  const startReleasePolling = useCallback(
    (targetPane: string) => {
      stopReleasePolling()
      const currentGen = pollGenerationRef.current
      const controller = new AbortController()
      pollAbortControllerRef.current = controller

      const pollOnce = async () => {
        if (
          currentGen !== pollGenerationRef.current ||
          controller.signal.aborted
        ) {
          return
        }

        let statusResult = null
        let fetchError: unknown = null
        try {
          statusResult = await fetchTerminalControlStatus(
            targetPane,
            controller.signal
          )
        } catch (err) {
          if (
            controller.signal.aborted ||
            currentGen !== pollGenerationRef.current
          ) {
            return
          }
          fetchError = err
        }

        if (
          controller.signal.aborted ||
          currentGen !== pollGenerationRef.current
        ) {
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

        if (
          currentGen === pollGenerationRef.current &&
          !controller.signal.aborted
        ) {
          pollTimerRef.current = setTimeout(pollOnce, 250)
        }
      }

      void pollOnce()
    },
    [stopReleasePolling]
  )

  const handleControlOwnershipChange = useCallback(
    (nextOwnership: ITerminalControlOwnership, explicitPaneId?: string) => {
      const targetPane =
        explicitPaneId || controlPaneIdRef.current || selectedPaneIdRef.current

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
    },
    [startReleasePolling, stopReleasePolling]
  )

  const prevControlPaneIdRef = useRef<string | null>(selectedPaneId)
  const prevControlViewModeRef = useRef<ISurfaceMode>(viewMode)

  useEffect(() => {
    const prevPaneId = prevControlPaneIdRef.current
    prevControlPaneIdRef.current = selectedPaneId
    if (
      shouldReleaseControlOnPaneChange(
        prevPaneId,
        selectedPaneId,
        controlOwnershipRef.current
      )
    ) {
      handleControlOwnershipChange('releasing', prevPaneId || undefined)
    }
  }, [selectedPaneId, handleControlOwnershipChange])

  useEffect(() => {
    const prevView = prevControlViewModeRef.current
    prevControlViewModeRef.current = viewMode
    if (
      shouldReleaseControlOnViewChange(
        prevView,
        viewMode,
        controlOwnershipRef.current
      )
    ) {
      handleControlOwnershipChange('releasing')
    }
  }, [viewMode, handleControlOwnershipChange])

  useEffect(() => {
    return () => {
      stopReleasePolling()
    }
  }, [stopReleasePolling])

  useEffect(() => {
    if (
      status === 'connected' &&
      workspaceId &&
      snapshot?.workspaces.some(
        (workspace) => workspace.workspace_id === workspaceId
      ) &&
      selectedWorkspaceId !== workspaceId
    ) {
      setSelectedWorkspaceId(workspaceId)
    }
  }, [
    snapshot,
    status,
    workspaceId,
    selectedWorkspaceId,
    setSelectedWorkspaceId
  ])

  useEffect(() => {
    if (shouldRestoreMenuFocusRef.current) {
      shouldRestoreMenuFocusRef.current = false
      requestAnimationFrame(() => menuTriggerRef.current?.focus())
    }
  }, [shouldRestoreMenuFocusRef, menuTriggerRef])

  const workspaces = snapshot?.workspaces || []
  const tabs = snapshot?.tabs || []
  const panes = snapshot?.panes || []

  const activeWorkspace =
    workspaces.find((w) => w.workspace_id === workspaceId) || null
  const activeTab = useMemo(() => {
    if (!selectedPane?.tab_id) return null
    return (
      tabs.find(
        (t) =>
          t.tab_id === selectedPane.tab_id &&
          (!workspaceId || t.workspace_id === workspaceId)
      ) || null
    )
  }, [selectedPane?.tab_id, tabs, workspaceId])
  const activeSpaceTabs = useMemo(() => {
    return tabs.filter((t) => t.workspace_id === workspaceId)
  }, [tabs, workspaceId])
  const isLastTabInSpace = activeSpaceTabs.length <= 1
  const blockedPanes = panes.filter((p) => p.agent_status === 'blocked')
  const isSelectedPaneBlocked = selectedPane?.agent_status === 'blocked'

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
    (isAgentPaneForControl
      ? isSelectedPaneBlocked
        ? 'blocked-agent'
        : 'agent'
      : 'shell')
  const canonicalHasAgent =
    canonicalExpectedMode === 'agent' ||
    canonicalExpectedMode === 'blocked-agent'
  const canonicalIsBlocked = canonicalExpectedMode === 'blocked-agent'

  const handleSubmitText = async (
    text: string
  ): Promise<ActionResultStatus> => {
    if (!selectedPaneId || !targetResult.target) {
      if (targetResult.error) {
        setActionError(targetResult.error)
      }
      return 'skipped_busy'
    }
    const actionType =
      targetResult.target.expectedMode === 'agent' ? 'prompt' : 'terminal-input'
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
      setError: (err) =>
        setActionError(err ? formatActionErrorMessage(err) : null)
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
        setError: (err) =>
          setActionError(err ? formatActionErrorMessage(err) : null)
      })
    } catch {
      // Key failure recorded in setActionError by executeGuardedAction
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

  // Resize open mobile -> desktop closes/reconciles modal without trapping desktop or resetting selectedpane
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(min-width: 769px)')
    const handleMediaChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        setIsSpaceDrawerOpen(false)
      }
    }
    if (mql.matches && isSpaceDrawerOpen) {
      setIsSpaceDrawerOpen(false)
    }
    mql.addEventListener?.('change', handleMediaChange)
    return () => mql.removeEventListener?.('change', handleMediaChange)
  }, [isSpaceDrawerOpen])

  const handleOpenSpaceDrawer = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setIsTabDrawerOpen(false)
    setIsSpaceDrawerOpen((prev) => !prev)
  }, [])

  const handleCloseSpaceDrawer = useCallback(() => {
    setIsSpaceDrawerOpen(false)
    setIsSpaceDrawerModalOpen(false)
    setSpaceDrawerInitialView('list')
    setSpaceDrawerTargetWorkspaceId(null)
    requestAnimationFrame(() => menuTriggerRef?.current?.focus())
  }, [menuTriggerRef])

  const handleOpenTabDrawer = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setIsSpaceDrawerOpen(false)
    setTabDrawerInitialView('list')
    setTabDrawerTargetTabId(null)
    setIsTabDrawerOpen(true)
  }, [])

  const handleCloseTabDrawer = useCallback(() => {
    setIsTabDrawerOpen(false)
    setTabDrawerInitialView('list')
    setTabDrawerTargetTabId(null)
    requestAnimationFrame(() => drawerTriggerRef.current?.focus())
  }, [drawerTriggerRef])

  const handleOpenNewTab = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setIsSpaceDrawerOpen(false)
    setTabDrawerInitialView('new-tab')
    setTabDrawerTargetTabId(null)
    setIsTabDrawerOpen(true)
  }, [])

  const handleOpenCloseTab = useCallback((targetTabId: string) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setIsSpaceDrawerOpen(false)
    setTabDrawerInitialView('close-tab')
    setTabDrawerTargetTabId(targetTabId)
    setIsTabDrawerOpen(true)
  }, [])

  const handleOpenLifecycleStatus = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setIsSpaceDrawerOpen(false)
    setTabDrawerInitialView('status')
    setTabDrawerTargetTabId(null)
    setIsTabDrawerOpen(true)
  }, [])

  const handleOpenNewSpace = useCallback(() => {
    setIsSpaceDrawerOpen(false)
    setSpaceDrawerInitialView('new-space')
    setSpaceDrawerTargetWorkspaceId(null)
    setIsSpaceDrawerModalOpen(true)
  }, [])

  const handleOpenCloseSpace = useCallback((targetWorkspace: IWorkspace) => {
    setIsSpaceDrawerOpen(false)
    setSpaceDrawerInitialView('close-space')
    setSpaceDrawerTargetWorkspaceId(targetWorkspace.workspace_id)
    setIsSpaceDrawerModalOpen(true)
  }, [])

  const handleOpenSettings = useCallback(() => {
    setIsSpaceDrawerOpen(false)
    setIsSpaceDrawerModalOpen(false)
    shouldRestoreMenuFocusRef.current = true
    navigate('/settings', { state: { appOwned: true } })
  }, [navigate, shouldRestoreMenuFocusRef])

  const renderSidebarRoster = (isMobile = false) => (
    <SidebarRoster
      workspaces={workspaces}
      tabs={tabs}
      panes={panes}
      selectedWorkspaceId={workspaceId}
      selectedPaneId={selectedPaneId}
      onSelectWorkspace={(wsId) => {
        if (wsId !== workspaceId) {
          navigate('/spaces/' + encodeURIComponent(wsId))
        }
        setSelectedWorkspaceId(wsId)
        if (isMobile) {
          setIsSpaceDrawerOpen(false)
        }
      }}
      onSelectPane={(pId, wsId) => {
        if (wsId && wsId !== workspaceId) {
          navigate('/spaces/' + encodeURIComponent(wsId))
        }
        setSelectedPaneId(pId, wsId)
        if (isMobile) {
          setIsSpaceDrawerOpen(false)
        }
      }}
      onOpenNewSpace={handleOpenNewSpace}
      onOpenCloseSpace={handleOpenCloseSpace}
      onOpenNewTab={handleOpenNewTab}
      pushState={push.state}
      onOpenSettings={() => {
        if (isMobile) setIsSpaceDrawerOpen(false)
        handleOpenSettings()
      }}
      status={status}
      blockedPanes={blockedPanes}
      onJumpToPane={(pId, wsId) => {
        handleJumpToPane(pId, wsId)
        if (isMobile) setIsSpaceDrawerOpen(false)
      }}
      hasLifecycleGate={Boolean(
        lifecycle.ticket && lifecycle.ticket.phase !== 'rejected'
      )}
    />
  )

  const appStyle = viewportGeometry
    ? {
        height: `${viewportGeometry.height}px`,
        transform:
          viewportGeometry.offsetTop > 0
            ? `translateY(${viewportGeometry.offsetTop}px)`
            : undefined
      }
    : undefined

  // Fail-closed view when Space is not found in an authoritative snapshot
  if (status !== 'loading' && snapshot && !activeWorkspace) {
    return (
      <div
        className="app herdr-app"
        style={appStyle}
        data-keyboard-open={
          viewportGeometry?.isKeyboardOpen ? 'true' : undefined
        }
      >
        <div className="system-banner system-banner--error" role="alert">
          <span>Space "{workspaceId}" not found in the active session.</span>
        </div>
        <div className="herdr-empty-canvas">
          <Button
            type="button"
            className="system-banner__retry"
            onClick={() => navigate('/', { replace: true })}
          >
            Return to Active Space
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`app herdr-app${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
      style={appStyle}
      data-keyboard-open={viewportGeometry?.isKeyboardOpen ? 'true' : undefined}
    >
      {/* Source-Style Single Zoned Context Header */}
      <HorizonHeader
        status={status}
        activeWorkspace={activeWorkspace}
        activeTab={activeTab}
        selectedPane={selectedPane}
        isSpaceDrawerOpen={isSpaceDrawerOpen}
        menuTriggerRef={menuTriggerRef}
        onOpenSpaces={handleOpenSpaceDrawer}
        isTabDrawerOpen={isTabDrawerOpen}
        drawerTriggerRef={drawerTriggerRef}
        onOpenTabs={handleOpenTabDrawer}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
        onOpenSearch={() => setIsSearchOpen(true)}
        onNewShellTab={handleOpenNewTab}
        onCloseCurrentTab={() => {
          if (activeTab) {
            handleOpenCloseTab(activeTab.tab_id)
          }
        }}
        onReviewOperation={handleOpenLifecycleStatus}
        isLastTab={isLastTabInSpace}
        lifecycleTicket={lifecycle.ticket}
        viewMode={viewMode}
        onSelectMode={setViewMode}
        isBlocked={isSelectedPaneBlocked}
        isLoading={isCurrentSurfaceLoading}
        onRefresh={handleRefreshCurrentSurface}
      />

      {/* Main Body: Persistent Desktop Sidebar + Pane Column */}
      <div className="app-body">
        {/* Left Column: Persistent Desktop Sidebar (nonmodal, hidden on mobile via CSS) */}
        <aside
          className={`sidebar desktop-sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}
          aria-label="Spaces and Panes"
        >
          {renderSidebarRoster(false)}
        </aside>

        {/* Right Column: Pane Column with Viewport and Footer */}
        <div className="pane-column">
          {/* Horizontal Space Native Tab Rail below Header */}
          <TabRail
            tabs={tabs}
            panes={panes}
            activeWorkspaceId={workspaceId}
            selectedPaneId={selectedPaneId}
            focusedPaneId={snapshot?.focused_pane_id}
            onSelectPane={(pId, wsId) => {
              if (wsId && wsId !== workspaceId) {
                navigate('/spaces/' + encodeURIComponent(wsId))
              }
              setSelectedPaneId(pId, wsId)
            }}
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
              <Button
                variant="outline"
                size="sm"
                className="system-banner__retry"
                onClick={() => refreshSnapshot()}
              >
                Retry
              </Button>
            </div>
          )}

          {status === 'empty' && (
            <div className="system-banner system-banner--empty">
              <span>No active Herdr workspaces or panes discovered.</span>
            </div>
          )}

          {/* Core Viewport: Active Surface Panel (No second stacked header!) */}
          <main className="terminal-host herdr-main">
            {!selectedPaneId ? (
              <div className="herdr-empty-canvas">
                <span>
                  {status === 'loading'
                    ? 'Loading Herdr session...'
                    : 'No pane selected'}
                </span>
              </div>
            ) : (
              <div className="surface-viewport-container">
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
                      aria-label="Live Terminal"
                    >
                      <TerminalCanvas
                        key={selectedPaneId}
                        paneId={selectedPaneId}
                        terminalId={selectedPane?.terminal_id}
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

          {/* Footer Controls: Prompt Composer first, then Thumb Deck */}
          <footer className="herdr-footer">
            {controlOwnership !== 'idle' ? (
              <div
                className="terminal-control-footer-notice"
                role="status"
                aria-live="polite"
              >
                <span className="terminal-control-footer-notice__text">
                  {getTerminalControlFooterNotice(controlOwnership)}
                </span>
              </div>
            ) : (
              <>
                <PromptComposer
                  paneId={selectedPaneId}
                  terminalId={selectedPane?.terminal_id}
                  workspaceId={workspaceId}
                  agentName={selectedPane?.display_agent || selectedPane?.agent}
                  isBlocked={canonicalIsBlocked}
                  hasAgent={canonicalHasAgent}
                  expectedMode={canonicalExpectedMode}
                  isBusy={isBusy}
                  isControlActive={controlOwnership !== 'idle'}
                  hasValidTarget={Boolean(targetResult.target)}
                  error={actionError || targetResult.error}
                  onSubmitText={handleSubmitText}
                  onSendKeys={handleSendKeys}
                  isPickerOpen={isPickerOpen}
                  onPickerOpenChange={(open) => {
                    if (open) {
                      setPickerInitialTab('commands')
                    }
                    setIsPickerOpen(open)
                  }}
                  pickerInitialTab={pickerInitialTab}
                />

                <ThumbDeck
                  paneId={selectedPaneId}
                  isBusy={isBusy || !targetResult.target}
                  workspaceId={workspaceId}
                  onSendKeys={handleSendKeys}
                  onOpenManage={() => {
                    setPickerInitialTab('rail')
                    setIsPickerOpen(true)
                  }}
                />
              </>
            )}
          </footer>
        </div>
      </div>

      {/* Mobile Navigation Drawer Sheet (Base UI Drawer Sheet) */}
      <Sheet
        side="left"
        open={isSpaceDrawerOpen}
        onOpenChange={setIsSpaceDrawerOpen}
      >
        <SheetContent
          id="workspace-drawer"
          side="left"
          className="sidebar mobile-sidebar-sheet"
          aria-label="Workspace Navigation"
          finalFocus={menuTriggerRef}
        >
          {renderSidebarRoster(true)}
        </SheetContent>
      </Sheet>

      {/* Modal Drawer Sheet for Space Lifecycle Actions (New Space, Close Space, Status) */}
      <SpaceDrawer
        isOpen={isSpaceDrawerModalOpen}
        status={status}
        pushState={push.state}
        workspaces={workspaces}
        tabs={tabs}
        panes={panes}
        selectedWorkspaceId={workspaceId}
        onSelectWorkspace={(wsId) => {
          if (wsId !== workspaceId) {
            navigate('/spaces/' + encodeURIComponent(wsId))
          }
        }}
        onOpenSettings={handleOpenSettings}
        onClose={handleCloseSpaceDrawer}
        onRefreshSnapshot={refreshSnapshot}
        lifecycle={lifecycle}
        initialView={spaceDrawerInitialView}
        initialTargetWorkspaceId={spaceDrawerTargetWorkspaceId}
      />

      {/* Active-Space Tab and Pane Switcher Sheet */}
      <PaneDrawer
        isOpen={isTabDrawerOpen}
        workspaces={workspaces}
        tabs={tabs}
        panes={panes}
        selectedWorkspaceId={workspaceId}
        selectedPaneId={selectedPaneId}
        onSelectPane={(pId, wsId) => {
          if (wsId && wsId !== workspaceId) {
            navigate('/spaces/' + encodeURIComponent(wsId))
          }
          setSelectedPaneId(pId, wsId)
        }}
        onClose={handleCloseTabDrawer}
        onRefreshSnapshot={refreshSnapshot}
        lifecycle={lifecycle}
        initialView={tabDrawerInitialView}
        initialTargetTabId={tabDrawerTargetTabId}
      />

      {/* Navigation Search Sheet (Search Spaces, Tabs, Panes across snapshot) */}
      <NavigationSearchSheet
        isOpen={isSearchOpen}
        workspaces={workspaces}
        tabs={tabs}
        panes={panes}
        selectedWorkspaceId={workspaceId}
        selectedPaneId={selectedPaneId}
        focusedPaneId={snapshot?.focused_pane_id}
        onSelectPane={(pId, wsId) => {
          if (wsId && wsId !== workspaceId) {
            navigate('/spaces/' + encodeURIComponent(wsId))
          }
          setSelectedPaneId(pId, wsId)
        }}
        onClose={() => setIsSearchOpen(false)}
        triggerRef={searchTriggerRef}
      />
    </div>
  )
}

export default SpaceDashboard
