import { test, expect } from '@playwright/test'
import { readFixture, snapshot } from './read-fixture.ts'
import { CHAT_POSITION_STORAGE_KEY } from '../src/utils/chat-scroll-memory.ts'

test('draft, Find focus, Settings navigation and reading Clear stay browser-local', async ({
  context,
  page,
  baseURL
}, testInfo) => {
  const violations: string[] = []
  const errors: string[] = []
  const blockedRegistrations: unknown[] = []
  // Test-owned rejection, not SW simulation: block real registration without invoking
  // Playwright's warning-producing shim. This smoke does not test Service Workers.
  await context.exposeBinding(
    '__herdrSmokeRegistration',
    (_source, registration: unknown) => {
      blockedRegistrations.push(registration)
    }
  )
  await context.addInitScript(() => {
    if (!('serviceWorker' in navigator)) return
    Object.defineProperty(navigator.serviceWorker, 'register', {
      value: async (
        scriptURL: string | URL,
        options?: RegistrationOptions
      ): Promise<ServiceWorkerRegistration> => {
        await (
          window as unknown as {
            __herdrSmokeRegistration: (registration: unknown) => Promise<void>
          }
        ).__herdrSmokeRegistration({ scriptURL: String(scriptURL), options })
        throw new DOMException(
          'Registration intentionally denied by read-only smoke fixture',
          'NotAllowedError'
        )
      }
    })
  })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      errors.push(`${message.type()}: ${message.text()}`)
  })
  // Installed BEFORE navigation; no API route can ever continue to the real server.
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== baseURL || request.method() !== 'GET') {
      violations.push(`${request.method()} ${url.pathname}`)
      await route.abort()
      return
    }
    if (url.pathname.startsWith('/api/')) {
      const data = readFixture(request.method(), url.pathname)
      if (data === undefined) {
        violations.push(`Unknown API read ${url.pathname}`)
        await route.abort()
      } else await route.fulfill({ json: data })
      return
    }
    // Only app documents and immutable build assets may reach the static owner.
    if (
      [
        '/',
        '/settings',
        '/spaces/smoke-space',
        '/favicon.svg',
        '/manifest.webmanifest',
        '/sw.js'
      ].includes(url.pathname) ||
      /^\/(assets|fonts|icons)\//.test(url.pathname)
    )
      await route.continue()
    else {
      violations.push(`Unknown resource ${url.pathname}`)
      await route.abort()
    }
  })
  await context.routeWebSocket('**/*', (socket) => {
    const url = new URL(socket.url())
    if (url.host !== new URL(baseURL!).host || url.pathname !== '/api/events') {
      violations.push(`Forbidden socket ${url.pathname}`)
      socket.close()
      return
    }
    // No connectToServer(): native sockets are never opened.
    socket.send(JSON.stringify({ type: 'snapshot', data: snapshot }))
    socket.onMessage((message) => {
      if (String(message) !== '{"type":"events.ping"}')
        violations.push('Unexpected socket message')
      socket.send(JSON.stringify({ type: 'snapshot', data: snapshot }))
    })
  })
  try {
    await page.goto('/')
    const draft = page.getByRole('textbox', { name: /^Text input for/ })
    await expect(draft).toBeEnabled()
    await draft.fill('Inert draft retained through Settings')
    await page
      .getByRole('button', { name: 'Find in Chat', exact: true })
      .click()
    const find = page.getByRole('searchbox', {
      name: 'Find in Chat',
      exact: true
    })
    await expect(find).toBeFocused()
    await find.fill('Smoke needle')
    await page.getByRole('button', { name: 'Next match', exact: true }).click()
    await find.press('Escape')
    await expect(
      page.getByRole('button', { name: 'Find in Chat', exact: true })
    ).toBeFocused()
    await expect
      .poll(() =>
        page.evaluate(
          (key) => localStorage.getItem(key),
          CHAT_POSITION_STORAGE_KEY
        )
      )
      .not.toBeNull()
    // Desktop has a persistent SidebarRoster; mobile opens that same roster in a sheet.
    if (
      await page.evaluate(
        () =>
          matchMedia(
            '(max-width: 768px), (max-width: 1023px) and (max-height: 500px) and (orientation: landscape)'
          ).matches
      )
    )
      await page.getByRole('button', { name: /^Open Spaces/ }).click()
    await page
      .getByRole('button', { name: 'Open settings', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true })
    ).toBeFocused()
    await page
      .getByRole('button', {
        name: 'Delete saved reading positions',
        exact: true
      })
      .click()
    await expect
      .poll(() =>
        page.evaluate(
          (key) => localStorage.getItem(key),
          CHAT_POSITION_STORAGE_KEY
        )
      )
      .toBeNull()
    await page
      .getByRole('button', { name: 'Back to terminal', exact: true })
      .click()
    await expect(draft).toHaveValue('Inert draft retained through Settings')
  } finally {
    // Close while routes remain installed; no polling request can leak during teardown.
    // Soft gates keep the original locator failure AND record each safety failure.
    try {
      await context.close()
    } finally {
      await testInfo.attach('smoke-safety-diagnostics', {
        body: JSON.stringify(
          {
            violations,
            pageIssues: errors,
            blockedRegistrations,
            browserDebug: process.env.DEBUG ?? null
          },
          null,
          2
        ),
        contentType: 'application/json'
      })
      expect
        .soft(violations, 'No forbidden API/native network traffic')
        .toEqual([])
      expect
        .soft(
          blockedRegistrations,
          'Exactly one test-owned registration rejection; no Service Worker proof'
        )
        .toEqual([
          {
            scriptURL: '/sw.js',
            options: { scope: '/', updateViaCache: 'none' }
          }
        ])
      expect
        .soft(errors, 'No page errors, console errors or warnings')
        .toEqual([])
    }
  }
})
