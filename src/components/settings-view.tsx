import { useEffect, useRef } from 'react'
import type { FC } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { IUsePushSubscriptionResult } from '@/hooks/use-push-subscription.ts'

export interface ISettingsViewProps {
  push: IUsePushSubscriptionResult
  onBack: () => void
}

const getLiveStatusAnnouncement = (state: string, error: string | null): string => {
  switch (state) {
    case 'busy':
      return 'Updating push notification status'
    case 'active':
      return 'Push notifications active on this device'
    case 'inactive':
      return 'Push notifications inactive on this device'
    case 'denied':
      return 'Push notifications blocked by browser permission'
    case 'install-required':
      return 'Installation required: add to Home Screen to enable notifications'
    case 'unsupported':
      return 'Web Push is unsupported on this device'
    case 'backend-error':
      return `Push notification error: ${error || 'Backend communication failed'}`
    default:
      return 'Push notifications'
  }
}

const SettingsView: FC<ISettingsViewProps> = ({ push, onBack }) => {
  const { state, error, isReady, isOperationPending, subscribe, unsubscribe, sendTestAlert, refresh } = push
  const headingRef = useRef<HTMLHeadingElement | null>(null)

  // Focus page heading on mount
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  // Escape key returns to main terminal view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBack])

  return (
    <div className="settings-page" role="region" aria-label="Settings View">
      {/* Dedicated concise live status owner for screen readers */}
      <div className="sr-only" role="status" aria-live="polite">
        {getLiveStatusAnnouncement(state, error)}
      </div>

      {/* Calm Settings Top Bar with Back Button */}
      <header className="settings-header">
        <button
          type="button"
          className="settings-header__back-btn"
          onClick={onBack}
          aria-label="Back to terminal"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          <span>Back</span>
        </button>
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="settings-header__title"
          style={{ outline: 'none' }}
        >
          Settings
        </h1>
        <div className="settings-header__spacer" aria-hidden="true" />
      </header>

      {/* Main Single-Column Settings Surface */}
      <div className="settings-view">
        {/* Section Header */}
        <section className="settings-section">
          <div className="settings-section__intro">
            <h2 className="settings-section__heading">Push Notifications</h2>
            <p className="settings-section__subheading">
              Background alerts for agent blockers and completions.
            </p>
          </div>

          <p className="settings-policy-spec">
            Fixed event copy with bounded Space label for the first canonical tab per Space by default (customizable per Tab in the drawer). Click targets the Space. Transitions are evaluated from authoritative snapshots.
          </p>

          <div className="settings-divider" />

          {/* State Specific Blocks */}
          <div className="settings-state-block">
            {/* 1. Unsupported */}
            {state === 'unsupported' && (
              <div className="settings-status-row settings-status-row--unsupported">
                <div className="settings-status-badge settings-status-badge--muted">
                  [ UNSUPPORTED ]
                </div>
                <p className="settings-status-desc">
                  Browser does not support Web Push notifications.
                </p>
              </div>
            )}

            {/* 2. iOS Browser Tab / Install Required */}
            {state === 'install-required' && (
              <div className="settings-status-row settings-status-row--install">
                <div className="settings-status-badge settings-status-badge--amber">
                  [ INSTALL REQUIRED ]
                </div>
                <p className="settings-status-desc">
                  iOS requires Herdr Web on Home Screen to receive notifications.
                </p>
                <div className="settings-guide-box">
                  <span>Tap <strong>Share</strong> in Safari, then select <strong>&quot;Add to Home Screen&quot;</strong>.</span>
                </div>
              </div>
            )}

            {/* 3. Inactive / Ready */}
            {state === 'inactive' && (
              <div className="settings-status-row settings-status-row--inactive">
                <div className="settings-status-badge settings-status-badge--muted">
                  [ INACTIVE ]
                </div>
                <p className="settings-status-desc">
                  Push is not enabled on this device. Browser permission alone does not enable alerts.
                </p>

                <button
                  type="button"
                  className="settings-action-btn settings-action-btn--elevated"
                  onClick={() => void subscribe()}
                  disabled={!isReady}
                >
                  Enable Push Notifications
                </button>

                <span className="settings-note">
                  Requires Tailnet user allowlist authorization.
                </span>
              </div>
            )}

            {/* 4. Active */}
            {state === 'active' && (
              <div className="settings-status-row settings-status-row--active">
                <div className="settings-status-badge settings-status-badge--cyan">
                  <span className="settings-status-badge__dot" aria-hidden="true" />
                  [ ACTIVE ]
                </div>

                <div className="settings-spec-terminal">
                  <div className="settings-spec-item">
                    <span className="settings-spec-label">STATUS</span>
                    <span className="settings-spec-val">Active on this device</span>
                  </div>
                  <div className="settings-spec-item">
                    <span className="settings-spec-label">EVENTS</span>
                    <span className="settings-spec-val">Needs Input · Done</span>
                  </div>
                  <div className="settings-spec-item">
                    <span className="settings-spec-label">SCOPE</span>
                    <span className="settings-spec-val">First Tab / Space</span>
                  </div>
                  <div className="settings-spec-item">
                    <span className="settings-spec-label">REGISTRATION</span>
                    <span className="settings-spec-val">Stored</span>
                  </div>
                </div>

                <div className="settings-actions-group">
                  <button
                    type="button"
                    className="settings-action-btn settings-action-btn--elevated"
                    onClick={() => void sendTestAlert()}
                  >
                    Send Test Alert
                  </button>

                  <button
                    type="button"
                    className="settings-action-btn settings-action-btn--ghost-danger"
                    onClick={() => void unsubscribe()}
                  >
                    Disable Notifications
                  </button>
                </div>
              </div>
            )}

            {/* 5. Denied / Blocked */}
            {state === 'denied' && (
              <div className="settings-status-row settings-status-row--denied">
                <div className="settings-status-badge settings-status-badge--danger">
                  [ BLOCKED ]
                </div>
                <p className="settings-status-desc">
                  Notifications blocked by browser permission. Allow notifications for Herdr in your browser or device settings, then re-check permission.
                </p>
                <button
                  type="button"
                  className="settings-action-btn settings-action-btn--elevated"
                  onClick={() => void refresh()}
                >
                  Re-check Permission
                </button>
              </div>
            )}

            {/* 6. Backend Error */}
            {state === 'backend-error' && (
              <div className="settings-status-row settings-status-row--error">
                <div className="settings-status-badge settings-status-badge--danger">
                  {error && (error.includes('403') || error.toLowerCase().includes('not authorized') || error.toLowerCase().includes('forbidden'))
                    ? '[ NOT AUTHORIZED ]'
                    : error && (error.toLowerCase().includes('not enabled') || error.toLowerCase().includes('disabled') || error.toLowerCase().includes('unavailable'))
                    ? '[ UNAVAILABLE ]'
                    : '[ PUSH ERROR ]'}
                </div>
                <p className="settings-status-desc">
                  {isOperationPending
                    ? 'The browser operation is still pending. Its result may arrive later; reload to inspect the current state.'
                    : `Push setup needs attention: ${error || 'Authorization failed'}`}
                </p>
                <div className="settings-actions-group">
                  {isOperationPending ? (
                    <button
                      type="button"
                      className="settings-action-btn settings-action-btn--elevated"
                      onClick={() => window.location.reload()}
                    >
                      Reload
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="settings-action-btn settings-action-btn--elevated"
                        onClick={() => void refresh()}
                      >
                        Re-check Status
                      </button>
                      {push.hasSubscription && (
                        <button
                          type="button"
                          className="settings-action-btn settings-action-btn--ghost-danger"
                          onClick={() => void unsubscribe()}
                        >
                          Disable Notifications
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Busy / Loading State */}
            {state === 'busy' && (
              <div className="settings-status-row settings-status-row--busy">
                <div className="settings-spinner" aria-hidden="true" />
                <span className="settings-status-desc">Updating push notification status...</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default SettingsView
