import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FC } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { IPane, ITab } from '@/types/herdr.ts'
import {
  formatTabLabel,
  selectBestPaneForTab,
} from '@/utils/workspace-helpers.ts'
import {
  ACTIVITY_LABEL,
  deriveTabActivity,
  getActivityStatusDotClass,
} from '@/utils/activity-status.ts'
import Button from '@/components/ui/button.tsx'

export interface ITabRailProps {
  tabs: ITab[]
  panes: IPane[]
  activeWorkspaceId: string
  selectedPaneId: string | null
  focusedPaneId?: string | null
  onSelectPane: (paneId: string, workspaceId: string) => void
}

export const TabRail: FC<ITabRailProps> = ({
  tabs,
  panes,
  activeWorkspaceId,
  selectedPaneId,
  focusedPaneId,
  onSelectPane,
}) => {
  const currentTabs = [...tabs]
    .filter((t) => t.workspace_id === activeWorkspaceId)
    .sort((a, b) => a.number - b.number)

  const currentPane = panes.find((p) => p.pane_id === selectedPaneId)
  const selectedTabId = currentPane?.tab_id ?? null

  const isTabEmpty = useCallback(
    (tab: ITab) => {
      return (
        panes.filter(
          (p) =>
            p.tab_id === tab.tab_id && p.workspace_id === activeWorkspaceId,
        ).length === 0
      )
    },
    [panes, activeWorkspaceId],
  )

  const enabledIndices = useMemo(() => {
    return currentTabs
      .map((t, idx) => (!isTabEmpty(t) ? idx : -1))
      .filter((idx) => idx !== -1)
  }, [currentTabs, isTabEmpty])

  const [focusedTabId, setFocusedTabId] = useState<string | null>(null)

  // Derive effective focus target by identity through snapshot updates/reorders
  const effectiveFocusTabId = useMemo(() => {
    if (
      focusedTabId &&
      currentTabs.some((t) => t.tab_id === focusedTabId && !isTabEmpty(t))
    ) {
      return focusedTabId
    }
    if (
      selectedTabId &&
      currentTabs.some((t) => t.tab_id === selectedTabId && !isTabEmpty(t))
    ) {
      return selectedTabId
    }
    if (enabledIndices.length > 0) {
      return currentTabs[enabledIndices[0]]?.tab_id ?? null
    }
    return null
  }, [focusedTabId, selectedTabId, currentTabs, isTabEmpty, enabledIndices])

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const tabButtonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const checkScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    setCanScrollLeft(scrollLeft > 2)
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 2)
  }, [])

  // Observe both container and track for width/content changes
  useEffect(() => {
    const container = scrollContainerRef.current
    const track = trackRef.current
    if (!container) return
    checkScroll()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => checkScroll())
      observer.observe(container)
      if (track) observer.observe(track)
      return () => observer.disconnect()
    }
  }, [checkScroll, currentTabs])

  // Scroll active tab into view in rail without page jump, respecting reduced motion
  useEffect(() => {
    const activeIdx = currentTabs.findIndex((t) => t.tab_id === selectedTabId)
    if (activeIdx >= 0) {
      const activeEl = tabButtonRefs.current[activeIdx]
      if (activeEl) {
        const prefersReducedMotion =
          typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        activeEl.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
        })
      }
    }
  }, [selectedTabId, currentTabs])

  const handleScrollLeft = () => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    scrollContainerRef.current?.scrollBy({
      left: -140,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    })
  }

  const handleScrollRight = () => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    scrollContainerRef.current?.scrollBy({
      left: 140,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    })
  }

  const handleTabClick = (tab: ITab) => {
    if (isTabEmpty(tab)) return
    const targetPane = selectBestPaneForTab(
      panes,
      tab.tab_id,
      activeWorkspaceId,
      selectedPaneId,
      focusedPaneId,
    )
    if (targetPane) {
      setFocusedTabId(tab.tab_id)
      onSelectPane(targetPane.pane_id, activeWorkspaceId)
    }
  }

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (e.nativeEvent.isComposing) return
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return

    // If no enabled tabs exist, do not intercept or attempt focus
    if (enabledIndices.length === 0) return

    const currentPos = enabledIndices.indexOf(index)
    let nextIndex: number | null = null

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      if (currentPos === -1) {
        nextIndex = enabledIndices[0]
      } else {
        nextIndex = enabledIndices[(currentPos + 1) % enabledIndices.length]
      }
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (currentPos === -1) {
        nextIndex = enabledIndices[enabledIndices.length - 1]
      } else {
        nextIndex =
          enabledIndices[
            (currentPos - 1 + enabledIndices.length) % enabledIndices.length
          ]
      }
    } else if (e.key === 'Home') {
      e.preventDefault()
      nextIndex = enabledIndices[0]
    } else if (e.key === 'End') {
      e.preventDefault()
      nextIndex = enabledIndices[enabledIndices.length - 1]
    }

    if (nextIndex !== null) {
      const nextTab = currentTabs[nextIndex]
      const btn = tabButtonRefs.current[nextIndex]
      if (btn && nextTab) {
        setFocusedTabId(nextTab.tab_id)
        btn.focus()
        // Focus only on arrow navigation; activation happens via Enter/Space (click)
      }
    }
  }

  if (currentTabs.length === 0) {
    return null
  }

  return (
    <nav className="tab-rail" role="navigation" aria-label="Space tabs">
      {canScrollLeft && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="tab-rail__scroll-btn tab-rail__scroll-btn--left"
          onClick={handleScrollLeft}
          aria-label="Scroll tabs left"
          tabIndex={-1}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </Button>
      )}

      <div
        ref={scrollContainerRef}
        className="tab-rail__scroll"
        onScroll={checkScroll}
      >
        <div ref={trackRef} className="tab-rail__track">
          {currentTabs.map((tab, idx) => {
            const isSelected = tab.tab_id === selectedTabId
            const tabPanes = panes.filter(
              (p) =>
                p.tab_id === tab.tab_id && p.workspace_id === activeWorkspaceId,
            )
            const isEmpty = tabPanes.length === 0
            const labelText = tab.label?.trim()
              ? tab.label.trim()
              : `Tab ${tab.number}`
            const tabActivity = deriveTabActivity(
              panes,
              activeWorkspaceId,
              tab.tab_id,
            )
            const fullAccessibleLabel = isEmpty
              ? `${formatTabLabel(tab)}, empty tab`
              : `${formatTabLabel(tab)}, Activity: ${ACTIVITY_LABEL[tabActivity]} (Native attention: ${tab.agent_status || 'unknown'})`

            const isFocusTarget =
              !isEmpty &&
              (effectiveFocusTabId
                ? tab.tab_id === effectiveFocusTabId
                : enabledIndices.length > 0 && idx === enabledIndices[0])

            return (
              <button
                key={tab.tab_id}
                ref={(el) => {
                  tabButtonRefs.current[idx] = el
                }}
                type="button"
                className={`tab-rail__item${isSelected ? ' is-active' : ''}${isEmpty ? ' is-empty' : ''}`}
                onClick={() => handleTabClick(tab)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                disabled={isEmpty}
                tabIndex={isFocusTarget ? 0 : -1}
                aria-current={isSelected ? 'page' : undefined}
                aria-label={fullAccessibleLabel}
                title={fullAccessibleLabel}
              >
                <span
                  className={`space-status-dot ${getActivityStatusDotClass(tabActivity)}`}
                  aria-hidden="true"
                />
                <span className="tab-rail__item-label">{labelText}</span>
              </button>
            )
          })}
        </div>
      </div>

      {canScrollRight && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="tab-rail__scroll-btn tab-rail__scroll-btn--right"
          onClick={handleScrollRight}
          aria-label="Scroll tabs right"
          tabIndex={-1}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </Button>
      )}
    </nav>
  )
}

export default TabRail
