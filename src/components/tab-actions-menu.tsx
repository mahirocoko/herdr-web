import { useRef } from 'react'
import type { FC } from 'react'
import { Menu } from '@base-ui/react/menu'
import { AlertTriangle, Ellipsis, Plus, RotateCw, Trash2 } from 'lucide-react'
import type { ITab } from '@/types/herdr.ts'
import type { ILifecycleTicket } from '@/utils/lifecycle-operations.ts'
import Button from '@/components/ui/button.tsx'

export interface ITabActionsMenuProps {
  activeTab?: ITab | null
  isLastTab?: boolean
  lifecycleTicket?: ILifecycleTicket | null
  onNewShellTab?: () => void
  onCloseCurrentTab?: () => void
  onReviewOperation?: () => void
  disabled?: boolean
}

export const TabActionsMenu: FC<ITabActionsMenuProps> = ({
  activeTab,
  isLastTab = false,
  lifecycleTicket,
  onNewShellTab,
  onCloseCurrentTab,
  onReviewOperation,
  disabled = false,
}) => {
  const isFocusHandoffRef = useRef(false)
  const hasLifecycleGate = Boolean(
    lifecycleTicket && lifecycleTicket.phase !== 'rejected',
  )

  const getLifecycleGateReason = (): string | null => {
    if (!lifecycleTicket || lifecycleTicket.phase === 'rejected') return null
    if (lifecycleTicket.phase === 'pending') return 'Operation pending'
    if (lifecycleTicket.phase === 'observed') return 'Operation in progress'
    if (lifecycleTicket.phase === 'unknown') return 'Outcome unknown'
    if (lifecycleTicket.phase === 'reconciliation-failed')
      return 'Reconciliation failed'
    return 'Operation active'
  }

  const lifecycleReason = getLifecycleGateReason()

  // Close is disabled if: no active tab, is last tab in space, or lifecycle gated
  const isCloseDisabled =
    !activeTab || !onCloseCurrentTab || isLastTab || hasLifecycleGate

  const getCloseSubtext = (): string | null => {
    if (!activeTab) return 'No active tab selected'
    if (isLastTab) return 'Last tab in Space (Close Space instead)'
    if (lifecycleReason) return `Gated: ${lifecycleReason}`
    return null
  }

  const closeSubtext = getCloseSubtext()

  return (
    <Menu.Root
      onOpenChange={(open) => {
        if (open) isFocusHandoffRef.current = false
      }}
    >
      <Menu.Trigger
        render={<Button variant="ghost" size="icon" />}
        disabled={disabled}
        className="icon-button header-more-button"
        aria-label="Current tab actions"
        title="Current tab actions"
      >
        <Ellipsis size={18} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={6}
          className="ui-menu__positioner"
        >
          <Menu.Popup
            className="ui-menu__popup"
            finalFocus={() => !isFocusHandoffRef.current}
          >
            <Menu.Item
              className="ui-menu__item"
              disabled={!onNewShellTab || hasLifecycleGate}
              onClick={() => {
                if (!onNewShellTab || hasLifecycleGate) return
                isFocusHandoffRef.current = true
                onNewShellTab()
              }}
              closeOnClick
            >
              <span className="ui-menu__item-icon">
                <Plus size={16} aria-hidden="true" />
              </span>
              <div className="ui-menu__item-content">
                <span className="ui-menu__item-title">New Shell Tab</span>
              </div>
            </Menu.Item>

            <Menu.Item
              className={`ui-menu__item${!isCloseDisabled ? ' ui-menu__item--danger' : ''}`}
              disabled={isCloseDisabled}
              onClick={() => {
                if (!isCloseDisabled) {
                  isFocusHandoffRef.current = true
                  onCloseCurrentTab?.()
                }
              }}
              closeOnClick={!isCloseDisabled}
            >
              <span className="ui-menu__item-icon">
                <Trash2 size={16} aria-hidden="true" />
              </span>
              <div className="ui-menu__item-content">
                <span className="ui-menu__item-title">Close current Tab</span>
                {closeSubtext && (
                  <span className="ui-menu__item-subtext">{closeSubtext}</span>
                )}
              </div>
            </Menu.Item>

            {hasLifecycleGate && onReviewOperation && (
              <>
                <div className="ui-menu__separator" role="separator" />
                <Menu.Item
                  className="ui-menu__item"
                  onClick={() => {
                    isFocusHandoffRef.current = true
                    onReviewOperation()
                  }}
                  closeOnClick
                >
                  <span className="ui-menu__item-icon">
                    {lifecycleTicket?.phase === 'unknown' ? (
                      <AlertTriangle size={16} aria-hidden="true" />
                    ) : (
                      <RotateCw size={16} aria-hidden="true" />
                    )}
                  </span>
                  <div className="ui-menu__item-content">
                    <span className="ui-menu__item-title">
                      Review operation
                    </span>
                    <span className="ui-menu__item-subtext">
                      {lifecycleReason} — inspect status
                    </span>
                  </div>
                </Menu.Item>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

export default TabActionsMenu
