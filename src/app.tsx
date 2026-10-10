import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FC } from 'react'
import { useNavigate, useOutletContext } from 'react-router'
import { usePaneRead } from '@/hooks/use-pane-read.ts'
import { useInteractivePrompt } from '@/hooks/use-interactive-prompt.ts'
import { PromptCard } from '@/components/prompt-card.tsx'
import {
  answerFromText,
  answerHint,
  answerRefusal,
  needsConfirmation
} from '@/utils/prompt-answer.ts'
import type { PromptAnswerIntent } from '@/types/interactive-prompt.ts'
import { sendAction } from '@/services/api-client.ts'
import HorizonHeader from '@/components/horizon-header.tsx'
import AttentionHorizon from '@/components/attention-horizon.tsx'
import TerminalCanvas from '@/components/terminal-canvas.tsx'
import QuestionView from '@/components/question-view.tsx'
import PanelView from '@/components/panel-view.tsx'
import ChatView from '@/components/chat-view.tsx'
import ChatControls from '@/components/chat-controls.tsx'
import PaneDrawer from '@/components/pane-drawer.tsx'
import SpaceDrawer from '@/components/space-drawer.tsx'
import SidebarRoster from '@/components/sidebar-roster.tsx'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet.tsx'
import ThumbDeck from '@/components/thumb-deck.tsx'
import PromptComposer from '@/components/prompt-composer.tsx'
import Button from '@/components/ui/button.tsx'
import TabRail from '@/components/tab-rail.tsx'
import NavigationSearchSheet from '@/components/navigation-search-sheet.tsx'
import type { IPickerSheetTab } from '@/components/interaction-picker-sheet.tsx'
import {
  getDefaultSurfaceMode,
  resolveSurfaceMode,
  type ISurfaceMode
} from '@/utils/surface-mode.ts'
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
  const [isChatKeysOpen, setIsChatKeysOpen] = useState(false)
  const isBusyRef = useRef(isBusy)
  isBusyRef.current = isBusy
  const [actionError, setActionError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ISurfaceMode>(() =>
    getDefaultSurfaceMode(isAgentPane(selectedPane, snapshot?.agents))
  )
  useEffect(() => setIsChatKeysOpen(false), [selectedPaneId, viewMode])
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
    // Do not consume the selection transition before its pane metadata arrives.
    if (!selectedPane || selectedPane.pane_id !== selectedPaneId) return
    const paneChanged = selectedPaneId !== prevPaneIdRef.current
    const wasBlocked = prevBlockedRef.current

    const nextMode = resolveSurfaceMode({
      currentMode: viewMode,
      isBlocked: isSelectedPaneBlocked,
      wasBlocked,
      paneChanged,
      isAgent: isAgentPane(selectedPane, snapshot?.agents)
    })

    if (nextMode !== viewMode) {
      setViewMode(nextMode)
    }

    prevPaneIdRef.current = selectedPaneId
    prevBlockedRef.current = isSelectedPaneBlocked
  }, [
    selectedPaneId,
    selectedPane,
    snapshot?.agents,
    isSelectedPaneBlocked,
    viewMode
  ])

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

  const isAgentPaneForControl = isAgentPane(selectedPane, snapshot?.agents)

  const refetchActiveSurface = async () => {
    if (viewMode === 'question') {
      await refetchQuestion()
    } else if (viewMode === 'panel') {
      await refetchPanel()
    }
  }

  const targetResult = deriveActionTarget(selectedPane, snapshot?.agents)
  const currentActionTargetRef = useRef(targetResult.target)
  currentActionTargetRef.current = targetResult.target
  const interactive = useInteractivePrompt(
    targetResult.target ?? undefined,
    viewMode === 'chat' && isAgentPaneForControl
  )
  const [composerDraft, setComposerDraft] = useState('')
  const [chatSend, setChatSend] = useState<{
    paneId: string
    revision: number
  } | null>(null)
  const markChatSend = () => {
    if (viewMode === 'chat' && selectedPaneId)
      setChatSend((previous) => ({
        paneId: selectedPaneId,
        revision: (previous?.revision ?? 0) + 1
      }))
  }
  const [typedPromptAnswer, setTypedPromptAnswer] = useState<{
    id: string
    answer: PromptAnswerIntent
    draft: string
  } | null>(null)
  useEffect(() => {
    setTypedPromptAnswer(null)
  }, [selectedPaneId, interactive.prompt?.id])
  const answerInteractivePrompt = async (answer: PromptAnswerIntent) => {
    if (isBusyRef.current)
      return {
        ok: false,
        outcome: 'rejected' as const,
        error: 'Another input is in flight.'
      }
    isBusyRef.current = true
    setIsBusy(true)
    try {
      markChatSend()
      return await interactive.answer(answer)
    } finally {
      isBusyRef.current = false
      setIsBusy(false)
    }
  }
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
    if (
      viewMode === 'chat' &&
      canonicalHasAgent &&
      (!interactive.ready || interactive.unknown)
    ) {
      setActionError(
        interactive.unknown
          ? 'Answer outcome is unknown. Inspect Terminal, then re-read the prompt before sending.'
          : (interactive.error ??
              'Wait for the current prompt read before sending.')
      )
      throw new Error(
        interactive.unknown
          ? 'Answer outcome unknown; inspect and re-read before sending.'
          : 'Current prompt evidence is not ready.'
      )
    }
    if (viewMode === 'chat' && interactive.error)
      throw new Error(interactive.error)
    if (viewMode === 'chat' && interactive.prompt) {
      const answer = answerFromText(interactive.prompt, text)
      if (!answer) {
        const refusal = answerRefusal(interactive.prompt)
        setActionError(refusal)
        throw new Error(refusal)
      }
      if (needsConfirmation(interactive.prompt, answer)) {
        setTypedPromptAnswer({ id: interactive.prompt.id, answer, draft: text })
        return 'skipped_busy' // Inert until this occurrence's explicit Confirm.
      }
      const result = await answerInteractivePrompt(answer)
      if (!result.ok) {
        setActionError(
          result.error ?? 'Answer outcome unknown; inspect the terminal.'
        )
        throw new Error(result.error ?? 'Interactive answer failed')
      }
      void interactive.refresh()
      return 'acknowledged'
    }
    const actionType =
      targetResult.target.expectedMode === 'agent' ? 'prompt' : 'terminal-input'
    const operationId = crypto.randomUUID()

    return executeGuardedAction({
      action: () => {
        markChatSend()
        return sendAction({
          type: actionType,
          operationId,
          target: targetResult.target!,
          text
        })
      },
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

  const handleSendKeys = async (keys: string[], reportFailure = false) => {
    if (!selectedPaneId || !targetResult.target) {
      if (targetResult.error) {
        setActionError(targetResult.error)
      }
      return
    }
    const operationId = crypto.randomUUID()
    const actionTarget = targetResult.target
    try {
      return await executeGuardedAction({
        action: () =>
          sendAction({
            type: 'keys',
            operationId,
            target: actionTarget,
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
        setError: (err) => {
          const current = currentActionTargetRef.current
          if (
            current?.paneId === actionTarget.paneId &&
            current?.terminalId === actionTarget.terminalId &&
            current?.agentSessionId === actionTarget.agentSessionId
          )
            setActionError(err ? formatActionErrorMessage(err) : null)
        }
      })
    } catch (error) {
      // Key failure recorded in setActionError by executeGuardedAction
      if (reportFailure) throw error
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
        : false

  const handleRefreshCurrentSurface =
    viewMode === 'question'
      ? refetchQuestion
      : viewMode === 'panel'
        ? refetchPanel
        : undefined

  // Resize open mobile -> desktop closes/reconciles modal without trapping desktop or resetting selectedpane
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(min-width: 769px)')
    const compactLandscape = window.matchMedia(
      '(max-width: 1023px) and (max-height: 500px) and (orientation: landscape)'
    )
    const handleMediaChange = () => {
      if (mql.matches && !compactLandscape.matches) {
        setIsSpaceDrawerOpen(false)
      }
    }
    handleMediaChange()
    mql.addEventListener?.('change', handleMediaChange)
    compactLandscape.addEventListener?.('change', handleMediaChange)
    return () => {
      mql.removeEventListener?.('change', handleMediaChange)
      compactLandscape.removeEventListener?.('change', handleMediaChange)
    }
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
      onSelectWorkspace={(wsId) => {
        if (wsId !== workspaceId) {
          navigate('/spaces/' + encodeURIComponent(wsId))
        }
        setSelectedWorkspaceId(wsId)
        if (isMobile) {
          setIsSpaceDrawerOpen(false)
        }
      }}
      onOpenNewSpace={handleOpenNewSpace}
      onOpenCloseSpace={handleOpenCloseSpace}
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

                  {viewMode === 'chat' && (
                    <ChatView
                      paneId={selectedPaneId}
                      sendRevision={
                        chatSend?.paneId === selectedPaneId
                          ? chatSend.revision
                          : 0
                      }
                      agentName={
                        selectedPane?.agent || selectedPane?.display_agent
                      }
                      agentStatus={selectedPane?.agent_status}
                      connected={status === 'connected'}
                      isAgent={isAgentPane(selectedPane, snapshot?.agents)}
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

          {/* Composer, contextual Chat controls and Terminal key rail */}
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
                {viewMode === 'chat' && interactive.error && (
                  <p role="status">{interactive.error}</p>
                )}
                {viewMode === 'chat' && interactive.prompt && (
                  <PromptCard
                    paneId={selectedPaneId!}
                    prompt={interactive.prompt}
                    answerPrompt={answerInteractivePrompt}
                    isUnknown={interactive.unknown}
                    typedAnswer={
                      typedPromptAnswer?.id === interactive.prompt.id
                        ? typedPromptAnswer.answer
                        : null
                    }
                    onTypedAnswerDone={() => setTypedPromptAnswer(null)}
                    onPromptChanged={() => {
                      void interactive.refresh()
                    }}
                    onAnswered={(focus) => {
                      if (
                        typedPromptAnswer &&
                        composerDraft === typedPromptAnswer.draft
                      )
                        setComposerDraft('')
                      setTypedPromptAnswer(null)
                      void interactive.refresh()
                      void refreshSnapshot()
                      if (focus)
                        document
                          .querySelector<HTMLTextAreaElement>(
                            '.prompt-composer textarea'
                          )
                          ?.focus()
                    }}
                  />
                )}
                {viewMode === 'chat' &&
                  canonicalHasAgent &&
                  !interactive.ready &&
                  !interactive.prompt && (
                    <div className="chat-inline-state" role="status">
                      <span>
                        {interactive.unknown
                          ? 'Answer outcome unknown. Inspect Terminal before re-reading.'
                          : (interactive.error ?? 'Reading current prompt…')}
                      </span>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          void interactive.refresh()
                        }}
                      >
                        Re-read prompt
                      </Button>
                    </div>
                  )}
                <PromptComposer
                  contextControls={
                    viewMode === 'chat' ? (
                      <ChatControls
                        key={`${selectedPaneId}:${selectedPane?.terminal_id}:${targetResult.target?.agentSessionId ?? ''}`}
                        working={
                          canonicalHasAgent &&
                          selectedPane?.agent_status === 'working'
                        }
                        nativeStatus={selectedPane?.agent_status}
                        observation={snapshot}
                        disabled={
                          isBusy ||
                          !targetResult.target ||
                          controlOwnership !== 'idle'
                        }
                        requestStop={() => handleSendKeys(['ctrl+c'], true)}
                        onMore={() => {
                          setIsChatKeysOpen(true)
                        }}
                      />
                    ) : undefined
                  }
                  draftText={composerDraft}
                  onDraftChange={setComposerDraft}
                  promptPlaceholder={
                    viewMode === 'chat'
                      ? interactive.prompt
                        ? answerHint(interactive.prompt)
                        : (interactive.suggestion ?? undefined)
                      : undefined
                  }
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
                  isPromptEvidenceReady={
                    !(
                      viewMode === 'chat' &&
                      canonicalHasAgent &&
                      !interactive.ready
                    )
                  }
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

                {viewMode !== 'chat' && (
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
                )}
              </>
            )}
          </footer>
        </div>
      </div>

      {/* Mobile Navigation Drawer Sheet (Base UI Drawer Sheet) */}
      <Sheet
        side="bottom"
        open={isChatKeysOpen}
        onOpenChange={setIsChatKeysOpen}
      >
        <SheetContent side="bottom" aria-label="Chat keyboard controls">
          <SheetHeader>
            <SheetTitle>Keyboard controls</SheetTitle>
          </SheetHeader>
          <ThumbDeck
            paneId={selectedPaneId}
            isBusy={isBusy || !targetResult.target}
            workspaceId={workspaceId}
            onSendKeys={handleSendKeys}
            onOpenManage={() => {
              setIsChatKeysOpen(false)
              setPickerInitialTab('rail')
              setIsPickerOpen(true)
            }}
          />
        </SheetContent>
      </Sheet>
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
