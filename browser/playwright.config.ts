import { defineConfig } from '@playwright/test'

const ci = process.env.CI === 'true'
const baseURL = ci ? 'http://127.0.0.1:8791' : 'http://127.0.0.1:8787'
const executablePath =
  process.env.CHROME_PATH ||
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : undefined)
if (!ci && !executablePath)
  throw new Error(
    'Set CHROME_PATH to an installed Chrome; local browser downloads are not allowed'
  )

export default defineConfig({
  testDir: '.',
  // Intentionally neither *.test.* nor *.spec.*: Bun unit discovery stays unchanged.
  testMatch: '**/*.browser.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: 'list',
  outputDir: '../.agent-state/qa/t3-workflow-improvements/browser-results',
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 800 },
    launchOptions: ci ? {} : { executablePath }
  },
  webServer: ci
    ? {
        command: 'bun browser/serve-fixture.ts',
        cwd: '..',
        url: baseURL,
        reuseExistingServer: false,
        timeout: 10000
      }
    : undefined
})
