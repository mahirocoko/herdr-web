import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'

describe('public/sw.js: static service worker contract', () => {
  const swPath = path.resolve(import.meta.dir, '../../public/sw.js')
  const content = fs.readFileSync(swPath, 'utf8')

  test('service worker file exists and is non-empty', () => {
    expect(fs.existsSync(swPath)).toBe(true)
    expect(content.length).toBeGreaterThan(100)
  })

  test('registers install and activate events with skipWaiting and claim', () => {
    expect(content).toContain("HERDR_SERVICE_WORKER_VERSION = '2026-09-20-spaces-router-v1'")
    expect(content).toContain("self.addEventListener('install'")
    expect(content).toContain('skipWaiting')
    expect(content).toContain("self.addEventListener('activate'")
    expect(content).toContain('clients.claim')
    expect(content).toContain("self.addEventListener('message'")
    expect(content).toContain("type: 'herdr:service-worker-version'")
  })

  test('handles push events promptly under waitUntil with showNotification', () => {
    expect(content).toContain("self.addEventListener('push'")
    expect(content).toContain('showNotification')
    expect(content).toContain('event.waitUntil')
  })

  test('handles notificationclick event and closes notification', () => {
    expect(content).toContain("self.addEventListener('notificationclick'")
    expect(content).toContain('event.notification.close()')
    expect(content).toContain("type: 'herdr:open-workspace'")
    expect(content).toContain('client.postMessage')
    expect(content).toContain('parseWorkspaceIdFromTag')
    expect(content).toContain('click_target_conflict')
  })

  test('enforces exact root URL or safe space path navigation and rejects arbitrary paths/queries/hashes', () => {
    expect(content).toContain('validateTargetUrl')
    expect(content).toContain('parseCanonicalSpaceUrl')
    expect(content).toContain('parseLegacyWorkspaceUrl')
    expect(content).toContain('isValidWorkspaceId')
    expect(content).toContain('clientUrl.href === targetUrl')
    expect(content).toContain("type: 'herdr:open-workspace'")
    expect(content).toContain('client.navigate(targetUrl)')
    expect(content).toContain('if (navigatedClient')
    expect(content).toContain('self.clients.openWindow(targetUrl)')
    // Must NOT accept arbitrary paths from payload
    expect(content).not.toContain("startsWith('/') && !candidate.startsWith('//')")
  })

  test('derives visible title/body and safe URL without accepting caller-supplied strings', () => {
    // Must NOT fall back to reading raw text from push event payload
    expect(content).not.toContain('event.data.text()')
    expect(content).toContain('Herdr Notification')
    expect(content).toContain('Space: ')
    expect(content).toContain('sanitizeSpaceLabel')
    // Derives fixed titles
    expect(content).toContain("type === 'needs_input'")
    expect(content).toContain("type === 'done'")
    expect(content).toContain("type === 'test'")
    // Never accepts data.title or data.body directly
    expect(content).not.toContain('title = data.title')
    expect(content).not.toContain('body = data.body')
  })

  test('derives replacement tag safely and contains no pane or tab identifiers or acceptance of data.tag', () => {
    // Worker source must NOT contain pane or tab identifiers
    expect(content).not.toContain('pane')
    expect(content).not.toContain('tab')

    // Worker source must NOT accept caller-supplied data.tag
    expect(content).not.toContain('tag = data.tag')
    expect(content).not.toContain('data.tag')

    // Must derive safe replacement tags based on type and workspaceId
    expect(content).toContain('deriveSafeNotificationTag')
    expect(content).toContain("'herdr:test'")
    expect(content).toContain("'herdr:space:' + workspaceId.trim() + ':' + type")
    expect(content).toContain("'herdr:event:' + type")
    expect(content).toContain("'herdr-notification'")
  })
})
