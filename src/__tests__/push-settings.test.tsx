import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import SettingsView from '../components/settings-view.tsx'
import type { IUsePushSubscriptionResult } from '../hooks/use-push-subscription.ts'
import { describePushSubscribeError } from '../utils/push-browser-error.ts'

const renderSettings = (overrides: Partial<IUsePushSubscriptionResult>) => {
  const noop = async () => {}
  return renderToStaticMarkup(<SettingsView onBack={() => {}} push={{
    state: 'inactive', error: null, isReady: true, hasSubscription: false,
    isOperationPending: false, subscribe: noop, unsubscribe: noop,
    sendTestAlert: noop, refresh: noop, ...overrides
  }} />)
}

describe('Push Settings device and recovery copy', () => {
  test('click wording states the target without claiming verified Space switching', () => {
    const html = renderSettings({})
    expect(html).toContain('Click targets the Space.')
    expect(html).not.toContain('Click opens the Space.')
  })
  test('inactive copy distinguishes this device from browser permission', () => {
    const html = renderSettings({})
    expect(html).toContain('inactive on this device')
    expect(html).toContain('Push is not enabled on this device. Browser permission alone does not enable alerts.')
    expect(html).not.toContain('[ ACTIVE ]')
  })

  test('active copy scopes enrollment to this device', () => {
    expect(renderSettings({ state: 'active', hasSubscription: true })).toContain('Active on this device')
  })

  test('denied copy works across platforms', () => {
    const html = renderSettings({ state: 'denied' })
    expect(html).toContain('browser or device settings')
    expect(html).not.toContain('iOS Settings')
  })

  test('provider failure renders safe guidance and an inspection action', () => {
    const error = describePushSubscribeError('Push failed', new DOMException('private-endpoint', 'AbortError'), 'Android Chrome/140')
    const html = renderSettings({ state: 'backend-error', error })
    expect(html).toContain('Google Play services')
    expect(html).toContain('Re-check Status')
    expect(html).not.toContain('private-endpoint')
    expect(html).not.toContain('Enable Push Notifications')
  })

  test('pending operation still offers only reload', () => {
    const html = renderSettings({ state: 'backend-error', isOperationPending: true })
    expect(html).toContain('Reload')
    expect(html).not.toContain('Re-check Status')
    expect(html).not.toContain('Enable Push Notifications')
  })
})
