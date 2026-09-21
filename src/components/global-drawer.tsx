import { useEffect, useRef } from 'react'
import type { FC } from 'react'
import { ChevronRight, X } from 'lucide-react'
import type { ISnapshotStatus } from '@/types/herdr.ts'
import {
  getConnectionStatusLabel,
  getStatusDotClass
} from '@/utils/connection-status.ts'

export { getConnectionStatusLabel, getStatusDotClass }

export interface IGlobalDrawerProps {
  isOpen: boolean
  status: ISnapshotStatus
  pushState?: string
  onOpenSettings: () => void
  onClose: () => void
}

export const getNextFocusIndex = (
  currentIndex: number,
  totalCount: number,
  isShift: boolean
): number => {
  if (totalCount <= 0) return -1
  if (totalCount === 1) return 0
  if (currentIndex === -1) {
    return isShift ? totalCount - 1 : 0
  }
  if (isShift) {
    return (currentIndex - 1 + totalCount) % totalCount
  }
  return (currentIndex + 1) % totalCount
}

const GlobalDrawer: FC<IGlobalDrawerProps> = ({
  isOpen,
  status,
  pushState,
  onOpenSettings,
  onClose
}) => {
  const drawerRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }

      if (e.key === 'Tab') {
        const drawerEl = drawerRef.current
        if (!drawerEl) return

        const focusables = Array.from(
          drawerEl.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null || el === closeButtonRef.current)

        if (focusables.length === 0) {
          e.preventDefault()
          return
        }

        const activeIdx = focusables.indexOf(document.activeElement as HTMLElement)
        const nextIdx = getNextFocusIndex(activeIdx, focusables.length, e.shiftKey)
        if (nextIdx >= 0 && nextIdx < focusables.length) {
          e.preventDefault()
          focusables[nextIdx].focus()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="global-drawer-overlay" onClick={onClose} role="presentation">
      <div
        id="global-app-drawer"
        ref={drawerRef}
        className="global-drawer-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Application Menu"
      >
        <div className="global-drawer-header">
          <span className="global-drawer-title">Herdr</span>
          <button
            ref={closeButtonRef}
            type="button"
            className="global-drawer-close-btn"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="global-drawer-body">
          {/* Passive connection status row */}
          <div
            className="global-drawer-row global-drawer-row--status"
            role="status"
            aria-live="polite"
            aria-label={`Connection status: ${getConnectionStatusLabel(status)}`}
          >
            <span className="global-drawer-row__label">Connection</span>
            <span className="global-drawer-row__status">
              <span className={`status-dot ${getStatusDotClass(status)}`} aria-hidden="true" />
              <span className="global-drawer-row__status-text">{getConnectionStatusLabel(status)}</span>
            </span>
          </div>

          {/* Push notifications navigation row */}
          <button
            type="button"
            className="drawer-footer-row global-drawer-row--action"
            onClick={() => {
              onClose()
              onOpenSettings()
            }}
            aria-label="Open push notification settings"
          >
            <span className="drawer-footer-row__label">Push Notifications</span>
            <span className="drawer-footer-row__status">
              {pushState === 'active' ? (
                <span className="drawer-footer-badge drawer-footer-badge--active">
                  <span className="drawer-footer-badge__dot" aria-hidden="true" />
                  [ Active ]
                </span>
              ) : (
                <span className="drawer-footer-badge drawer-footer-badge--off">
                  [ Off ]
                </span>
              )}
              <ChevronRight size={16} className="drawer-footer-row__chevron" aria-hidden="true" />
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

export default GlobalDrawer
