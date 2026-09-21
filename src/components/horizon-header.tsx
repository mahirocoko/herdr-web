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
  isGlobalDrawerOpen: boolean
  menuTriggerRef: RefObject<HTMLButtonElement | null>
  onOpenMenu: () => void
  isDrawerOpen: boolean
  drawerTriggerRef: RefObject<HTMLButtonElement | null>
  onOpenDrawer: () => void
}

const HorizonHeader: FC<IHorizonHeaderProps> = ({
  status,
  activeWorkspace,
  activeTab,
  isGlobalDrawerOpen,
  menuTriggerRef,
  onOpenMenu,
  isDrawerOpen,
  drawerTriggerRef,
  onOpenDrawer
}) => {
  return (
    <header className="horizon-header">
      <button
        ref={menuTriggerRef}
        type="button"
        className="horizon-header__menu-trigger"
        onClick={onOpenMenu}
        aria-label={`Application menu, connection ${getConnectionStatusLabel(status)}`}
        aria-haspopup="dialog"
        aria-expanded={isGlobalDrawerOpen}
        aria-controls="global-app-drawer"
      >
        <Menu size={20} className="horizon-header__menu-icon" aria-hidden="true" />
        <span
          className={`status-dot horizon-header__menu-dot ${getStatusDotClass(status)}`}
          aria-hidden="true"
        />
      </button>

      <button
        ref={drawerTriggerRef}
        type="button"
        className="horizon-header__workspace-trigger"
        onClick={onOpenDrawer}
        aria-label="Switch workspace and pane"
        aria-haspopup="dialog"
        aria-expanded={isDrawerOpen}
        aria-controls="workspace-pane-drawer"
      >
        <span className="horizon-header__workspace-label">
          {activeWorkspace ? activeWorkspace.label : 'Select Workspace'}
        </span>
        {activeTab && (
          <span className="horizon-header__tab-label">
            {formatTabLabel(activeTab)}
          </span>
        )}
        <ChevronDown size={14} className="horizon-header__chevron" aria-hidden="true" />
      </button>
    </header>
  )
}

export default HorizonHeader
