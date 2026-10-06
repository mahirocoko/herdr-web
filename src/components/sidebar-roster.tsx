import { useRef, useEffect } from 'react'
import type { FC } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Layers,
  Plus,
  Terminal,
  Trash2,
} from 'lucide-react'
import Button from '@/components/ui/button.tsx'
import type { IPane, ISnapshotStatus, ITab, IWorkspace } from '@/types/herdr.ts'
import {
  formatTabLabel,
  formatWorkspaceAriaLabel,
  formatWorkspaceSourceLine,
  isAgentPane,
} from '@/utils/workspace-helpers.ts'
import {
  getConnectionStatusLabel,
  getStatusDotClass,
} from '@/utils/connection-status.ts'
import {
  ACTIVITY_LABEL,
  derivePaneActivity,
  deriveSpaceActivity,
  deriveTabActivity,
  getActivityStatusDotClass,
} from '@/utils/activity-status.ts'
import './ui/recipes.css'

export interface ISidebarRosterProps {
  workspaces: IWorkspace[]
  tabs: ITab[]
  panes: IPane[]
  selectedWorkspaceId: string | null
  selectedPaneId: string | null
  onSelectWorkspace: (workspaceId: string) => void
  onSelectPane: (paneId: string, workspaceId?: string) => void
  onOpenNewSpace: () => void
  onOpenCloseSpace?: (workspace: IWorkspace) => void
  onOpenNewTab?: () => void
  pushState?: string
  onOpenSettings: () => void
  status: ISnapshotStatus
  blockedPanes: IPane[]
  onJumpToPane: (paneId: string, workspaceId: string) => void
  hasLifecycleGate?: boolean
}

const formatCount = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? '' : 's'}`

export const displayPaneTitle = (pane: IPane): string => {
  return (
    pane.title ||
    pane.terminal_title_stripped ||
    pane.terminal_title ||
    pane.pane_id
  )
}

export const SidebarRoster: FC<ISidebarRosterProps> = ({
  workspaces,
  tabs,
  panes,
  selectedWorkspaceId,
  selectedPaneId,
  onSelectWorkspace,
  onSelectPane,
  onOpenNewSpace,
  onOpenCloseSpace,
  onOpenNewTab,
  pushState,
  onOpenSettings,
  status,
  blockedPanes,
  onJumpToPane,
  hasLifecycleGate = false,
}) => {
  const activeWorkspaceRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!selectedWorkspaceId) return
    const frame = requestAnimationFrame(() => {
      activeWorkspaceRef.current?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedWorkspaceId])

  const activeTabs = tabs
    .filter((t) => t.workspace_id === selectedWorkspaceId)
    .sort((a, b) => a.number - b.number)

  return (
    <div
      className="sidebar-roster"
      role="navigation"
      aria-label="Spaces and Panes Navigation"
    >
      {/* Needs Attention / Blocked Panes Strip */}
      {blockedPanes.length > 0 && (
        <div
          className="sidebar-needs-attention"
          role="region"
          aria-label="Needs attention"
        >
          <div className="sidebar-needs-attention__header">
            <span className="sidebar-needs-attention__title">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>Needs input</span>
            </span>
            <span className="sidebar-needs-attention__count">
              {blockedPanes.length}
            </span>
          </div>
          <ul className="sidebar-needs-attention__list">
            {blockedPanes.map((pane) => (
              <li key={pane.pane_id}>
                <button
                  type="button"
                  className="sidebar-needs-attention__item"
                  onClick={() => onJumpToPane(pane.pane_id, pane.workspace_id)}
                  title={`Jump to ${pane.pane_id}`}
                >
                  <span
                    className="sidebar-needs-attention__item-dot"
                    aria-hidden="true"
                  />
                  <span className="sidebar-needs-attention__item-title">
                    {displayPaneTitle(pane)}
                  </span>
                  <span className="badge badge-blocked">INPUT</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Spaces List Section */}
      <div className="sidebar-section">
        <div className="sidebar-section__header">
          <span className="sidebar-section__title">Spaces</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="sidebar-section__add-btn"
            onClick={onOpenNewSpace}
            disabled={hasLifecycleGate}
            title="New Space"
            aria-label="New Space"
          >
            <Plus size={16} aria-hidden="true" />
          </Button>
        </div>

        <ul
          className="space-drawer-list sidebar-workspace-list"
          aria-label="Herdr Spaces"
        >
          {workspaces.map((workspace) => {
            const isSelected = workspace.workspace_id === selectedWorkspaceId
            const label = workspace.label || `Space ${workspace.number}`
            const metadata = `${formatCount(workspace.tab_count, 'Tab')} · ${formatCount(workspace.pane_count, 'pane')}`
            const sourceLine = formatWorkspaceSourceLine(workspace)
            const spaceActivity = deriveSpaceActivity(
              panes,
              workspace.workspace_id,
              tabs,
            )
            const ariaLabel = formatWorkspaceAriaLabel(
              workspace,
              label,
              metadata,
              spaceActivity,
            )

            return (
              <li
                key={workspace.workspace_id}
                className={`space-drawer-list__item sidebar-workspace-item${isSelected ? ' is-selected' : ''}`}
              >
                <div className="sidebar-workspace-row">
                  <Button
                    ref={isSelected ? activeWorkspaceRef : undefined}
                    type="button"
                    variant="ghost"
                    className={`space-drawer-item ${isSelected ? 'space-drawer-item--selected' : ''}`}
                    onClick={() => onSelectWorkspace(workspace.workspace_id)}
                    aria-current={isSelected ? 'page' : undefined}
                    aria-label={ariaLabel}
                    title={`${label} · Activity: ${ACTIVITY_LABEL[spaceActivity]} (Native attention: ${workspace.agent_status || 'unknown'})`}
                  >
                    <span
                      className={`space-status-dot ${getActivityStatusDotClass(spaceActivity)}`}
                      aria-hidden="true"
                    />
                    <span className="space-drawer-item__content">
                      <span className="space-drawer-item__label">{label}</span>
                      {sourceLine && (
                        <span className="space-drawer-item__source">
                          {sourceLine}
                        </span>
                      )}
                      <span className="space-drawer-item__meta">
                        {metadata}
                      </span>
                    </span>
                    {isSelected && (
                      <Check
                        size={16}
                        className="space-drawer-item__check"
                        aria-hidden="true"
                      />
                    )}
                  </Button>

                  {isSelected && onOpenCloseSpace && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="sidebar-workspace-close-btn"
                      onClick={() => onOpenCloseSpace(workspace)}
                      disabled={hasLifecycleGate}
                      title={`Close ${label}`}
                      aria-label={`Close ${label}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </Button>
                  )}
                </div>

                {/* Nested Active Space Tabs & Panes */}
                {isSelected && (
                  <div
                    className="sidebar-workspace-tabs"
                    role="group"
                    aria-label={`Tabs in ${label}`}
                  >
                    <div className="sidebar-workspace-tabs__header">
                      <span className="sidebar-workspace-tabs__title">
                        Tabs & Panes
                      </span>
                      {onOpenNewTab && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="sidebar-workspace-tabs__new-btn"
                          onClick={onOpenNewTab}
                          disabled={hasLifecycleGate}
                          title="New Shell Tab"
                          aria-label="New Shell Tab"
                        >
                          <Plus size={14} aria-hidden="true" />
                          <span>Tab</span>
                        </Button>
                      )}
                    </div>

                    <ul className="sidebar-tabs-list">
                      {activeTabs.map((tab) => {
                        const tabPanes = panes.filter(
                          (p) => p.tab_id === tab.tab_id,
                        )
                        const hasSelectedPane = tabPanes.some(
                          (p) => p.pane_id === selectedPaneId,
                        )

                        const tabActivity = deriveTabActivity(
                          panes,
                          workspace.workspace_id,
                          tab.tab_id,
                        )

                        return (
                          <li
                            key={tab.tab_id}
                            className={`sidebar-tab-item${hasSelectedPane ? ' is-active-tab' : ''}`}
                          >
                            <div className="sidebar-tab-header">
                              <span className="sidebar-tab-title">
                                {formatTabLabel(tab)}
                              </span>
                              <span
                                className={`space-status-dot ${getActivityStatusDotClass(tabActivity)}`}
                                aria-label={`Tab activity: ${ACTIVITY_LABEL[tabActivity]} (Native attention: ${tab.agent_status || 'unknown'})`}
                                title={`Activity: ${ACTIVITY_LABEL[tabActivity]} (Native attention: ${tab.agent_status || 'unknown'})`}
                              />
                            </div>

                            <ul className="sidebar-panes-list">
                              {tabPanes.map((pane) => {
                                const isPaneSelected =
                                  pane.pane_id === selectedPaneId
                                const hasAgent = isAgentPane(pane)
                                const paneActivity = derivePaneActivity(pane)

                                return (
                                  <li key={pane.pane_id}>
                                    <button
                                      type="button"
                                      className={`sidebar-pane-item${isPaneSelected ? ' is-selected' : ''}`}
                                      onClick={() =>
                                        onSelectPane(
                                          pane.pane_id,
                                          workspace.workspace_id,
                                        )
                                      }
                                      aria-current={
                                        isPaneSelected ? 'true' : undefined
                                      }
                                      title={`${pane.pane_id} — ${displayPaneTitle(pane)}`}
                                    >
                                      <span
                                        className="sidebar-pane-icon"
                                        aria-hidden="true"
                                      >
                                        {hasAgent ? (
                                          <Layers size={14} />
                                        ) : (
                                          <Terminal size={14} />
                                        )}
                                      </span>
                                      <span className="sidebar-pane-content">
                                        <span className="sidebar-pane-title">
                                          {displayPaneTitle(pane)}
                                        </span>
                                        {pane.cwd && (
                                          <span className="sidebar-pane-cwd">
                                            {pane.cwd}
                                          </span>
                                        )}
                                      </span>
                                      <span
                                        className="pane-status-indicator"
                                        title={`Activity: ${ACTIVITY_LABEL[paneActivity]} (Native effective: ${pane.agent_status || 'unknown'})`}
                                      >
                                        <span
                                          className={`space-status-dot ${getActivityStatusDotClass(paneActivity)}`}
                                          aria-hidden="true"
                                        />
                                        <span
                                          className={`pane-status-word pane-status-word--${paneActivity}`}
                                        >
                                          {ACTIVITY_LABEL[paneActivity]}
                                        </span>
                                      </span>
                                    </button>
                                  </li>
                                )
                              })}
                            </ul>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </li>
            )
          })}
          {workspaces.length === 0 && (
            <li className="space-drawer-empty">No active Spaces</li>
          )}
        </ul>
      </div>

      {/* Sidebar Footer */}
      <div className="sidebar-roster-footer">
        <div
          className="space-drawer-connection"
          role="status"
          aria-live="polite"
          aria-label={`Connection status: ${getConnectionStatusLabel(status)}`}
        >
          <span className="space-drawer-footer__label">Connection</span>
          <span className="space-drawer-footer__value">
            <span
              className={`status-dot ${getStatusDotClass(status)}`}
              aria-hidden="true"
            />
            {getConnectionStatusLabel(status)}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="space-drawer-settings"
          onClick={onOpenSettings}
          aria-label="Open push notification settings"
        >
          <span>Push Notifications</span>
          <span className="space-drawer-settings__status">
            <span>{pushState === 'active' ? 'Active' : 'Off'}</span>
            <ChevronRight size={16} aria-hidden="true" />
          </span>
        </Button>
      </div>
    </div>
  )
}

export default SidebarRoster
