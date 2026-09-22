import type { FC, RefObject } from 'react'
import { ChevronDown, Menu } from 'lucide-react'
import type { ISnapshotStatus, ITab, IWorkspace } from '@/types/herdr.ts'
import { formatTabLabel } from '@/utils/workspace-helpers.ts'
import {
  getConnectionStatusLabel,
  getStatusDotClass
} from '@/utils/connection-status.ts'

export interface IHorizonHeaderProps {
  status: ISnapshotStatus
  activeWorkspace: IWorkspace | null
  activeTab?: ITab | null
  isSpaceDrawerOpen: boolean
  menuTriggerRef: RefObject<HTMLButtonElement | null>
  onOpenSpaces: () => void
  isTabDrawerOpen: boolean
  drawerTriggerRef: RefObject<HTMLButtonElement | null>
  onOpenTabs: () => void
}

const HorizonHeader: FC<IHorizonHeaderProps> = ({
  status,
  activeWorkspace,
  activeTab,
  isSpaceDrawerOpen,
  menuTriggerRef,
  onOpenSpaces,
  isTabDrawerOpen,
  drawerTriggerRef,
  onOpenTabs
}) => {
  return (
    <header className="horizon-header">
      <button
        ref={menuTriggerRef}
        type="button"
        className="horizon-header__menu-trigger"
        onClick={onOpenSpaces}
        aria-label={`Open Spaces, connection ${getConnectionStatusLabel(status)}`}
        aria-haspopup="dialog"
        aria-expanded={isSpaceDrawerOpen}
        aria-controls="space-drawer"
      >
        <Menu size={20} className="horizon-header__menu-icon" aria-hidden="true" />
        <span
          className={`status-dot horizon-header__menu-dot ${getStatusDotClass(status)}`}
          aria-hidden="true"
        />
      </button>

      <div className="horizon-header__context">
        <span className="horizon-header__workspace-label">
          {activeWorkspace ? activeWorkspace.label : 'Select Workspace'}
        </span>
        <button
          ref={drawerTriggerRef}
          type="button"
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
          <ChevronDown size={14} className="horizon-header__chevron" aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}

export default HorizonHeader
