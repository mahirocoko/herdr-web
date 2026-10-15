import { test, expect } from 'bun:test'
import { readFixture } from '../../browser/read-fixture.ts'
import { readFileSync } from 'node:fs'

test('smoke fixture rejects every write, native/control endpoint and unknown read', () => {
  const paths = [
    '/api/action',
    '/api/terminal/control',
    '/api/push/subscriptions',
    '/api/held/read',
    '/api/unknown',
    '/api/snapshot'
  ]
  for (const path of paths) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect(readFixture(method, path)).toBeUndefined()
  }
  for (const path of paths.slice(0, -1))
    expect(readFixture('GET', path)).toBeUndefined()
  expect(readFixture('GET', '/api/snapshot')).toBeDefined()
})

test('browser smoke owns closed network routes and avoids Bun test discovery', () => {
  const source = readFileSync(
    new URL('../../browser/reading.browser.ts', import.meta.url),
    'utf8'
  )
  expect(source).toContain("await context.route('**/*'")
  expect(source).toContain("await context.routeWebSocket('**/*'")
  expect(source).not.toContain('socket.connectToServer(')
  expect(source).not.toContain('route.fetch(')
  expect(source).toContain("getByRole('searchbox'")
  expect(source).toContain("name: 'Open settings'")
  expect(source).not.toContain("name: 'Open push notification settings'")
  expect(source).toContain("message.type() === 'warning'")
  expect(source).toContain('} finally {')
  expect(source).toContain("testInfo.attach('smoke-safety-diagnostics'")
  expect(source).toMatch(/expect\s*\.soft\(violations/)
  expect(source).toMatch(/expect\s*\.soft\(errors/)
  expect(source).toContain('await context.addInitScript(')
  expect(source).toContain('Promise<ServiceWorkerRegistration>')
  expect(source).toContain("'NotAllowedError'")
  expect(source).toMatch(/\.soft\(\s*blockedRegistrations/)
  expect(source).toContain("scriptURL: '/sw.js'")
  const config = readFileSync(
    new URL('../../browser/playwright.config.ts', import.meta.url),
    'utf8'
  )
  expect(config).toContain("testMatch: '**/*.browser.ts'")
  expect(config).toContain('workers: 1')
  expect(config).toContain("serviceWorkers: 'block'")
})
