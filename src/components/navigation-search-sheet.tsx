import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FC } from 'react'
import {
  ChevronRight,
  Columns,
  Layers,
  Search,
  Terminal,
  X,
} from 'lucide-react'
import type { IPane, ITab, IWorkspace } from '@/types/herdr.ts'
import {
  formatTabLabel,
  formatWorkspaceSourceLine,
  isAgentPane,
  selectBestPaneForTab,
  selectBestPaneForWorkspace,
} from '@/utils/workspace-helpers.ts'
import {
  ACTIVITY_LABEL,
  derivePaneActivity,
  deriveSpaceActivity,
  deriveTabActivity,
  getActivityStatusDotClass,
  type KnownActivity,
} from '@/utils/activity-status.ts'
import Button from '@/components/ui/button.tsx'
import Input from '@/components/ui/input.tsx'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet.tsx'

export type SearchItemType = 'space' | 'tab' | 'pane'

export interface INavigationSearchItem {
  id: string
  type: SearchItemType
  title: string
  subtitle: string
  spaceId: string
  spaceLabel: string
  tabId?: string
  paneId?: string
  agentStatus?: string
  activity?: KnownActivity
  isAgent?: boolean
  isCurrent: boolean
}

export interface INavigationSearchSheetProps {
  isOpen: boolean
  workspaces: IWorkspace[]
  tabs: ITab[]
  panes: IPane[]
  selectedWorkspaceId: string | null
  selectedPaneId: string | null
  focusedPaneId?: string | null
  onSelectPane: (paneId: string, workspaceId: string) => void
  onClose: () => void
  triggerRef?: React.RefObject<HTMLButtonElement | null>
}

export interface INavigationTargetResolution {
  paneId: string
  workspaceId: string
}

export const resolveNavigationTarget = (
  item: INavigationSearchItem,
  workspaces: IWorkspace[],
  tabs: ITab[],
  panes: IPane[],
  selectedPaneId?: string | null,
  focusedPaneId?: string | null,
): INavigationTargetResolution | null => {
  if (item.type === 'space') {
    const ws = workspaces.find((w) => w.workspace_id === item.spaceId)
    if (!ws) return null
    const targetPane = selectBestPaneForWorkspace(
      panes,
      item.spaceId,
      focusedPaneId,
    )
    if (!targetPane) return null
    return { paneId: targetPane.pane_id, workspaceId: item.spaceId }
  }

  if (item.type === 'tab') {
    if (!item.tabId) return null
    const tab = tabs.find(
      (t) => t.tab_id === item.tabId && t.workspace_id === item.spaceId,
    )
    if (!tab) return null
    const targetPane = selectBestPaneForTab(
      panes,
      item.tabId,
      item.spaceId,
      selectedPaneId,
      focusedPaneId,
    )
    if (!targetPane) return null
    return { paneId: targetPane.pane_id, workspaceId: item.spaceId }
  }

  if (item.type === 'pane') {
    if (!item.paneId) return null
    const pane = panes.find((p) => p.pane_id === item.paneId)
    if (!pane) return null
    // Reject deleted, reparented, or stale panes
    if (pane.workspace_id !== item.spaceId) return null
    if (item.tabId && pane.tab_id !== item.tabId) return null
    return { paneId: pane.pane_id, workspaceId: pane.workspace_id }
  }

  return null
}

const displayPaneTitle = (pane: IPane): string => {
  return (
    pane.title ||
    pane.terminal_title_stripped ||
    pane.terminal_title ||
    pane.pane_id
  )
}

export const NavigationSearchSheet: FC<INavigationSearchSheetProps> = ({
  isOpen,
  workspaces,
  tabs,
  panes,
  selectedWorkspaceId,
  selectedPaneId,
  focusedPaneId,
  onSelectPane,
  onClose,
  triggerRef,
}) => {
  const [query, setQuery] = useState('')
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const prevQueryRef = useRef(query)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Reset query and highlighted target on open
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setHighlightedId(null)
      prevQueryRef.current = ''
      const frame = requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [isOpen])

  // Build searchable items from current snapshot
  const currentPane = panes.find((p) => p.pane_id === selectedPaneId)
  const activeTabId = currentPane?.tab_id

  const allItems: INavigationSearchItem[] = useMemo(() => {
    const items: INavigationSearchItem[] = []

    // 1. Spaces
    for (const ws of workspaces) {
      const spaceLabel = ws.label || `Space ${ws.number}`
      const src = formatWorkspaceSourceLine(ws)
      const meta = `${ws.tab_count} tabs · ${ws.pane_count} panes${src ? ` · ${src}` : ''}`
      const spaceActivity = deriveSpaceActivity(panes, ws.workspace_id, tabs)
      items.push({
        id: `space_${ws.workspace_id}`,
        type: 'space',
        title: spaceLabel,
        subtitle: meta,
        spaceId: ws.workspace_id,
        spaceLabel,
        agentStatus: ws.agent_status,
        activity: spaceActivity,
        isCurrent: ws.workspace_id === selectedWorkspaceId,
      })
    }

    // 2. Tabs
    const sortedTabs = [...tabs].sort((a, b) => a.number - b.number)
    for (const t of sortedTabs) {
      const ws = workspaces.find((w) => w.workspace_id === t.workspace_id)
      const spaceLabel = ws ? ws.label || `Space ${ws.number}` : 'Unknown Space'
      const tabTitle = formatTabLabel(t)
      const tabPanes = panes.filter((p) => p.tab_id === t.tab_id)
      const meta = `In ${spaceLabel} · ${tabPanes.length} ${tabPanes.length === 1 ? 'pane' : 'panes'}`
      const tabActivity = deriveTabActivity(panes, t.workspace_id, t.tab_id)
      items.push({
        id: `tab_${t.tab_id}`,
        type: 'tab',
        title: tabTitle,
        subtitle: meta,
        spaceId: t.workspace_id,
        spaceLabel,
        tabId: t.tab_id,
        agentStatus: t.agent_status,
        activity: tabActivity,
        isCurrent: t.tab_id === activeTabId,
      })
    }

    // 3. Panes
    for (const p of panes) {
      const ws = workspaces.find((w) => w.workspace_id === p.workspace_id)
      const tab = tabs.find((t) => t.tab_id === p.tab_id)
      const spaceLabel = ws ? ws.label || `Space ${ws.number}` : 'Unknown Space'
      const tabLabel = tab ? formatTabLabel(tab) : 'Tab'
      const paneTitle = displayPaneTitle(p)
      const cwdPart = p.cwd ? ` · ${p.cwd}` : ''
      const subtitle = `In ${spaceLabel} › ${tabLabel}${cwdPart}`
      const isAgent = isAgentPane(p)
      const paneActivity = derivePaneActivity(p)

      items.push({
        id: `pane_${p.pane_id}`,
        type: 'pane',
        title: paneTitle,
        subtitle,
        spaceId: p.workspace_id,
        spaceLabel,
        tabId: p.tab_id,
        paneId: p.pane_id,
        agentStatus: p.agent_status,
        activity: paneActivity,
        isAgent,
        isCurrent: p.pane_id === selectedPaneId,
      })
    }

    return items
  }, [
    workspaces,
    tabs,
    panes,
    selectedWorkspaceId,
    selectedPaneId,
    activeTabId,
  ])

  // Filter items by query
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      // Empty query: prioritize items in current space, then other spaces
      const currentSpaceItems = allItems.filter(
        (i) => i.spaceId === selectedWorkspaceId,
      )
      const otherSpaceItems = allItems.filter(
        (i) => i.spaceId !== selectedWorkspaceId && i.type === 'space',
      )
      return [...currentSpaceItems, ...otherSpaceItems]
    }

    return allItems.filter((item) => {
      if (item.title.toLowerCase().includes(q)) return true
      if (item.subtitle.toLowerCase().includes(q)) return true
      if (item.spaceLabel.toLowerCase().includes(q)) return true
      if (item.paneId && item.paneId.toLowerCase().includes(q)) return true
      if (item.tabId && item.tabId.toLowerCase().includes(q)) return true
      return false
    })
  }, [allItems, query, selectedWorkspaceId])

  // Pure predicate to check if item resolves to a valid, live target in current snapshot
  const isItemSelectable = useCallback(
    (item: INavigationSearchItem) => {
      return (
        resolveNavigationTarget(
          item,
          workspaces,
          tabs,
          panes,
          selectedPaneId,
          focusedPaneId,
        ) !== null
      )
    },
    [workspaces, tabs, panes, selectedPaneId, focusedPaneId],
  )

  // Track selectable items
  const selectableItems = useMemo(() => {
    return filteredItems.filter((i) => isItemSelectable(i))
  }, [filteredItems, isItemSelectable])

  // When query changes (user typed), set highlightedId to first selectable item
  useEffect(() => {
    if (query !== prevQueryRef.current) {
      prevQueryRef.current = query
      setHighlightedId(selectableItems[0]?.id ?? null)
    }
  }, [query, selectableItems])

  // When filtered items change without query change (snapshot poll/reorder/removal):
  // Keep highlight keyed to item identity. If removed, clear highlightedId so Enter does not activate an unexpected neighbor!
  useEffect(() => {
    if (!highlightedId) return
    const stillPresentAndSelectable = selectableItems.some(
      (i) => i.id === highlightedId,
    )
    if (!stillPresentAndSelectable) {
      setHighlightedId(null)
    }
  }, [selectableItems, highlightedId])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!highlightedId) return
    const highlightedIdx = filteredItems.findIndex(
      (i) => i.id === highlightedId,
    )
    if (highlightedIdx >= 0) {
      const el = itemRefs.current[highlightedIdx]
      if (el) {
        el.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [highlightedId, filteredItems])

  const handleDismiss = useCallback(() => {
    onClose()
    requestAnimationFrame(() => {
      triggerRef?.current?.focus()
    })
  }, [onClose, triggerRef])

  const handleSelectItem = useCallback(
    (item: INavigationSearchItem) => {
      const target = resolveNavigationTarget(
        item,
        workspaces,
        tabs,
        panes,
        selectedPaneId,
        focusedPaneId,
      )
      if (!target) {
        // Truthful feedback: do not close sheet on stale/empty targets
        return
      }
      onSelectPane(target.paneId, target.workspaceId)
      handleDismiss()
    },
    [
      workspaces,
      tabs,
      panes,
      selectedPaneId,
      focusedPaneId,
      onSelectPane,
      handleDismiss,
    ],
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Honor IME composition, keyCode 229, and dead keys
    if (
      e.nativeEvent.isComposing ||
      e.keyCode === 229 ||
      e.key === 'Dead' ||
      e.isDefaultPrevented()
    ) {
      return
    }

    // Do not intercept when modifier keys are pressed
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) {
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (selectableItems.length === 0) return
      const currentPos = selectableItems.findIndex(
        (i) => i.id === highlightedId,
      )
      if (currentPos === -1) {
        setHighlightedId(selectableItems[0].id)
      } else {
        setHighlightedId(
          selectableItems[(currentPos + 1) % selectableItems.length].id,
        )
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (selectableItems.length === 0) return
      const currentPos = selectableItems.findIndex(
        (i) => i.id === highlightedId,
      )
      if (currentPos === -1) {
        setHighlightedId(selectableItems[selectableItems.length - 1].id)
      } else {
        setHighlightedId(
          selectableItems[
            (currentPos - 1 + selectableItems.length) % selectableItems.length
          ].id,
        )
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedId) {
        const targetItem = filteredItems.find((i) => i.id === highlightedId)
        if (targetItem && isItemSelectable(targetItem)) {
          handleSelectItem(targetItem)
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleDismiss()
    }
  }

  // Group items by category for clear presentation
  const groupedSections = useMemo(() => {
    if (!query.trim()) {
      const currentSpace = workspaces.find(
        (w) => w.workspace_id === selectedWorkspaceId,
      )
      const currentSpaceLabel = currentSpace
        ? currentSpace.label || `Space ${currentSpace.number}`
        : 'Current Space'

      const currentItems = filteredItems.filter(
        (i) => i.spaceId === selectedWorkspaceId,
      )
      const otherSpaces = filteredItems.filter(
        (i) => i.spaceId !== selectedWorkspaceId && i.type === 'space',
      )

      const sections: { title: string; items: INavigationSearchItem[] }[] = []
      if (currentItems.length > 0) {
        sections.push({
          title: `Current Space: ${currentSpaceLabel}`,
          items: currentItems,
        })
      }
      if (otherSpaces.length > 0) {
        sections.push({
          title: 'Other Spaces',
          items: otherSpaces,
        })
      }
      return sections
    }

    const spaces = filteredItems.filter((i) => i.type === 'space')
    const tabItems = filteredItems.filter((i) => i.type === 'tab')
    const paneItems = filteredItems.filter((i) => i.type === 'pane')

    const sections: { title: string; items: INavigationSearchItem[] }[] = []
    if (spaces.length > 0) {
      sections.push({ title: `Spaces (${spaces.length})`, items: spaces })
    }
    if (tabItems.length > 0) {
      sections.push({ title: `Tabs (${tabItems.length})`, items: tabItems })
    }
    if (paneItems.length > 0) {
      sections.push({ title: `Panes (${paneItems.length})`, items: paneItems })
    }
    return sections
  }, [query, filteredItems, workspaces, selectedWorkspaceId])

  let flatIndex = 0

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleDismiss()
      }}
    >
      <SheetContent
        id="navigation-search-sheet"
        side="bottom"
        className="drawer-sheet navigation-search-sheet"
        aria-label="Navigation search"
        finalFocus={triggerRef}
      >

        <SheetHeader className="drawer-sheet__header">
          <SheetTitle className="drawer-sheet__title">
            Search Spaces, Tabs &amp; Panes
          </SheetTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="drawer-sheet__close-btn"
            onClick={handleDismiss}
            aria-label="Close search"
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </SheetHeader>

        {/* Search Input Bar */}
        <div className="navigation-search-bar">
          <Search
            size={16}
            className="navigation-search-bar__icon"
            aria-hidden="true"
          />
          <Input
            ref={inputRef}
            type="text"
            className="navigation-search-bar__input"
            placeholder="Search by Space, Tab, or Pane title/path..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Search spaces, tabs, and panes"
            aria-controls="navigation-search-results"
          />
        </div>

        {/* Polite live region for screen-reader announcement of highlighted target */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {highlightedId
            ? (() => {
                const item = filteredItems.find((i) => i.id === highlightedId)
                return item
                  ? `${item.title}, ${item.type}, in ${item.spaceLabel}`
                  : ''
              })()
            : ''}
        </div>

        {/* Results List */}
        <div
          id="navigation-search-results"
          ref={listRef}
          className="navigation-search-results"
          role="region"
          aria-label="Search results"
        >
          {filteredItems.length === 0 ? (
            <div className="navigation-search-empty" role="status">
              <span>No spaces, tabs, or panes match &quot;{query}&quot;</span>
            </div>
          ) : (
            groupedSections.map((sec) => (
              <div key={sec.title} className="navigation-search-group">
                <div className="navigation-search-group__title">
                  {sec.title}
                </div>
                <div className="navigation-search-group__list">
                  {sec.items.map((item) => {
                    const currentIndex = flatIndex++
                    const isSelectable = isItemSelectable(item)
                    const isHighlighted = item.id === highlightedId
                    const displaySubtitle = isSelectable
                      ? item.subtitle
                      : `${item.subtitle} · Empty (no panes)`
                    const statusSummary = `Activity: ${ACTIVITY_LABEL[item.activity || 'unknown']} (Native ${item.type === 'pane' ? 'effective state' : 'attention'}: ${item.agentStatus || 'unknown'})`

                    return (
                      <Button
                        key={item.id}
                        ref={(el) => {
                          itemRefs.current[currentIndex] = el
                        }}
                        type="button"
                        variant="ghost"
                        className={`navigation-search-item${isHighlighted ? ' is-highlighted' : ''}${item.isCurrent ? ' is-current' : ''}${!isSelectable ? ' is-disabled' : ''}`}
                        disabled={!isSelectable}
                        aria-disabled={!isSelectable}
                        onClick={() => {
                          if (isSelectable) handleSelectItem(item)
                        }}
                        onMouseEnter={() => {
                          if (isSelectable) setHighlightedId(item.id)
                        }}
                        aria-label={`Select ${item.title}, ${item.type}, ${displaySubtitle}, ${statusSummary}`}
                        title={`${item.title} (${displaySubtitle}) · ${statusSummary}`}
                      >
                        <span
                          className="navigation-search-item__icon"
                          aria-hidden="true"
                        >
                          {item.type === 'space' && <Layers size={16} />}
                          {item.type === 'tab' && <Columns size={16} />}
                          {item.type === 'pane' &&
                            (item.isAgent ? (
                              <Layers size={16} />
                            ) : (
                              <Terminal size={16} />
                            ))}
                        </span>

                        <span className="navigation-search-item__content">
                          <span className="navigation-search-item__title">
                            {item.title}
                          </span>
                          <span className="navigation-search-item__subtitle">
                            {displaySubtitle}
                          </span>
                        </span>

                        <span className="navigation-search-item__meta">
                          {item.activity && (
                            <span
                              className={`space-status-dot ${getActivityStatusDotClass(item.activity)}`}
                              aria-hidden="true"
                              title={statusSummary}
                            />
                          )}
                          <span className="navigation-search-item__badge">
                            {item.type.toUpperCase()}
                          </span>
                          {item.isCurrent && (
                            <span className="navigation-search-item__badge navigation-search-item__badge--current">
                              CURRENT
                            </span>
                          )}
                          <ChevronRight
                            size={14}
                            className="navigation-search-item__chevron"
                            aria-hidden="true"
                          />
                        </span>
                      </Button>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default NavigationSearchSheet
