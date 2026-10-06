import type { FC, RefObject } from 'react'
import {
  ChevronDown,
  Columns,
  Ellipsis,
  HelpCircle,
  History,
  Layers,
  Loader2,
  Menu,
  PanelLeft,
  RotateCw,
  Search,
  Terminal,
  X,
} from 'lucide-react'
import type { IPane, ISnapshotStatus, ITab, IWorkspace } from '@/types/herdr.ts'
import { formatTabLabel, isAgentPane } from '@/utils/workspace-helpers.ts'
import Button from '@/components/ui/button.tsx'
import {
  getConnectionStatusLabel,
  getStatusDotClass,
} from '@/utils/connection-status.ts'
import {
  getAvailableSurfaceModes,
  type ISurfaceMode,
} from '@/utils/surface-mode.ts'

export interface IHorizonHeaderProps {
  status: ISnapshotStatus
  activeWorkspace: IWorkspace | null
  activeTab?: ITab | null
  selectedPane?: IPane | null
  isSpaceDrawerOpen: boolean
  menuTriggerRef?: RefObject<HTMLButtonElement | null>
  onOpenSpaces: () => void
  isTabDrawerOpen: boolean
  drawerTriggerRef?: RefObject<HTMLButtonElement | null>
  onOpenTabs: () => void
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  onOpenSearch?: () => void
  onOpenPalette?: () => void
  onOpenSettings?: () => void
  viewMode?: ISurfaceMode
  onSelectMode?: (mode: ISurfaceMode) => void
  isBlocked?: boolean
  isLoading?: boolean
  onRefresh?: () => void
}

const MODE_LABELS: Record<ISurfaceMode, string> = {
  question: 'Question',
  panel: 'Panel',
  history: 'History',
  stream: 'Stream',
}

const MODE_ICONS: Record<ISurfaceMode, typeof Terminal> = {
  question: HelpCircle,
  panel: Columns,
  history: History,
  stream: Terminal,
}

const displayPaneTitle = (pane?: IPane | null): string => {
  if (!pane) return ''
  return (
    pane.title ||
    pane.terminal_title_stripped ||
    pane.terminal_title ||
    pane.pane_id
  )
}

const cwdBasename = (cwd?: string | null): string => {
  if (!cwd) return ''
  const parts = cwd.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || cwd
}

const HorizonHeader: FC<IHorizonHeaderProps> = ({
  status,
  activeWorkspace,
  activeTab,
  selectedPane,
  isSpaceDrawerOpen,
  menuTriggerRef,
  onOpenSpaces,
  isTabDrawerOpen,
  drawerTriggerRef,
  onOpenTabs,
  sidebarCollapsed = false,
  onToggleSidebar,
  onOpenSearch,
  onOpenPalette,
  onOpenSettings,
  viewMode,
  onSelectMode,
  isBlocked = false,
  isLoading = false,
  onRefresh,
}) => {
  const availableModes = getAvailableSurfaceModes(isBlocked)

  return (
    <header className="app-header horizon-header is-zoned">
      {/* .header-side: mobile drawer toggle or desktop sidebar collapse & palette */}
      <div className="header-side">
        <Button
          ref={menuTriggerRef}
          variant="ghost"
          size="icon"
          className="icon-button drawer-toggle"
          onClick={onOpenSpaces}
          aria-label={
            isSpaceDrawerOpen
              ? 'Close workspace list'
              : `Open Spaces, connection ${getConnectionStatusLabel(status)}`
          }
          aria-haspopup="dialog"
          aria-expanded={isSpaceDrawerOpen}
          aria-controls="workspace-drawer"
        >
          {isSpaceDrawerOpen ? (
            <X size={18} aria-hidden="true" />
          ) : (
            <Menu size={20} aria-hidden="true" />
          )}
          <span
            className={`status-dot horizon-header__menu-dot ${getStatusDotClass(status)}`}
            aria-hidden="true"
          />
        </Button>

        {onToggleSidebar && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="icon-button header-desktop-only sidebar-toggle"
            onClick={onToggleSidebar}
            aria-label={
              sidebarCollapsed ? 'Show workspace list' : 'Hide workspace list'
            }
            aria-pressed={!sidebarCollapsed}
            title="Toggle sidebar"
          >
            <PanelLeft size={18} aria-hidden="true" />
          </Button>
        )}

        {(onOpenSearch || onOpenPalette) && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="icon-button palette-button"
            onClick={onOpenSearch || onOpenPalette}
            aria-label="Search navigation"
            title="Search navigation"
          >
            <Search size={18} aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* Context Zone: Icon + Title + Breadcrumbs */}
      <div className="context">
        <div className="context-title">
          <span className="agent-mark-holder" aria-hidden="true">
            {isAgentPane(selectedPane) ? (
              <Layers size={18} />
            ) : (
              <Terminal size={18} />
            )}
          </span>
          <span className="context-title-text header-mobile-only">
            Mahiro Code
          </span>
          <span className="context-title-text header-desktop-only">
            {displayPaneTitle(selectedPane) ||
              (activeWorkspace ? activeWorkspace.label : 'Select Workspace')}
          </span>
        </div>

        <div className="context-sub header-desktop-only">
          <span className="horizon-header__workspace-label">
            {activeWorkspace ? activeWorkspace.label : 'Select Workspace'}
          </span>
          <span className="context-sep" aria-hidden="true">
            ›
          </span>
          <Button
            ref={drawerTriggerRef}
            variant="ghost"
            className="horizon-header__tab-trigger"
            onClick={onOpenTabs}
            aria-label="Open Tabs and Panes"
            aria-haspopup="dialog"
            aria-expanded={isTabDrawerOpen}
            aria-controls="tab-pane-drawer"
          >
            <span className="horizon-header__tab-label">
              {activeTab ? formatTabLabel(activeTab) : 'Select Tab'}
            </span>
            <ChevronDown
              size={14}
              className="horizon-header__chevron"
              aria-hidden="true"
            />
          </Button>
          {selectedPane?.cwd && (
            <>
              <span className="context-sep" aria-hidden="true">
                ›
              </span>
              <span className="context-folder" title={selectedPane.cwd}>
                {cwdBasename(selectedPane.cwd)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Segmented Lens/View Switcher */}
      {viewMode && onSelectMode && (
        <div
          className="segmented view-switch"
          role="group"
          aria-label="Surface Modes"
        >
          {availableModes.map((m) => {
            const isActive = viewMode === m
            const Icon = MODE_ICONS[m]
            return (
              <button
                key={m}
                type="button"
                id={`surface-tab-${m}`}
                aria-pressed={isActive}
                className={isActive ? 'is-active' : ''}
                onClick={() => onSelectMode(m)}
                title={MODE_LABELS[m]}
                aria-label={MODE_LABELS[m]}
              >
                <Icon size={15} aria-hidden="true" />
                <span className="header-desktop-only">{MODE_LABELS[m]}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Refresh Action for Panel / History / Question */}
      {viewMode && viewMode !== 'stream' && onRefresh && (
        <Button
          variant="ghost"
          size="icon"
          className="icon-button surface-header__refresh-btn"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label={
            isLoading
              ? `Refreshing ${MODE_LABELS[viewMode]}...`
              : `Refresh ${MODE_LABELS[viewMode]}`
          }
          title={
            isLoading
              ? `Refreshing ${MODE_LABELS[viewMode]}...`
              : `Refresh ${MODE_LABELS[viewMode]}`
          }
        >
          {isLoading ? (
            <Loader2 size={14} className="spin" aria-hidden="true" />
          ) : (
            <RotateCw size={14} aria-hidden="true" />
          )}
        </Button>
      )}

      {/* Header Meta: Connection Chip + More Menu */}
      <div className="header-meta">
        <span
          className={`conn ${status === 'connected' ? 'conn-live' : 'conn-reconnecting'}`}
          role="status"
          title={`Connection status: ${getConnectionStatusLabel(status)}`}
        >
          <span
            className={`conn-dot ${getStatusDotClass(status)}`}
            aria-hidden="true"
          />
          <span className="conn-text">{getConnectionStatusLabel(status)}</span>
        </span>

        {status === 'error' && (
          <span className="pill pill-offline">offline</span>
        )}

        <div className="header-more">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="icon-button header-more-button"
            onClick={onOpenSettings || onOpenTabs}
            aria-label="More actions"
            title="More actions"
          >
            <Ellipsis size={18} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </header>
  )
}

export default HorizonHeader
