import { expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { copyPreviewRootAssets, preparePreviewHtml } from '../preview-build.ts'

test.skipIf(!existsSync(join(import.meta.dir, '../../.git')))(
  'Git checkouts track exact source filename casing even on macOS',
  () => {
    const result = spawnSync(
      'git',
      [
        'ls-files',
        '--error-unmatch',
        '--',
        'src/App.tsx',
        'src/components/Markdown.tsx'
      ],
      { cwd: join(import.meta.dir, '../..'), encoding: 'utf8' }
    )
    expect(result.status).toBe(0)
    expect(result.stdout.trim().split('\n')).toEqual([
      'src/App.tsx',
      'src/components/Markdown.tsx'
    ])
  }
)

test('supported ignore flag preserves legacy discovery and excludes native candidate tests', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'herdr-discovery-'))
  try {
    mkdirSync(join(cwd, 'adoption/upstream'), { recursive: true })
    writeFileSync(
      join(cwd, 'legacy.test.ts'),
      "import { test, expect } from 'bun:test'; test('legacy sentinel', () => expect(1).toBe(1))"
    )
    writeFileSync(
      join(cwd, 'adoption/upstream/native.integration.test.ts'),
      "throw new Error('NATIVE CANDIDATE WAS DISCOVERED')"
    )
    const result = spawnSync(
      process.execPath,
      ['test', '--path-ignore-patterns=adoption/upstream'],
      { cwd, encoding: 'utf8' }
    )
    expect(result.status).toBe(0)
    expect(result.stderr).toContain('1 pass')
    expect(result.stderr).not.toContain('NATIVE CANDIDATE WAS DISCOVERED')
    const root = join(import.meta.dir, '../..')
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts.test).toContain('scripts/ci-tests.ts unit')
    expect(pkg.scripts['test:native']).toContain('scripts/fork-native-check.ts')
    for (const command of [
      pkg.scripts.start,
      pkg.scripts.server,
      pkg.scripts.dev
    ]) {
      expect(command).toContain('scripts/run-local.ts')
      expect(command).not.toContain('server/managed.ts')
      expect(command).not.toContain('server/index.ts')
    }
    expect(readFileSync(join(root, 'scripts/ci-tests.ts'), 'utf8')).toContain(
      'HERDR_TEST_MODE: suite'
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('preview uses upstream transport-before-module sequence and removes install manifest', () => {
  const html = preparePreviewHtml(
    '<head><link rel="manifest" href="/manifest.json"><script type="module" src="/assets/app.js"></script></head>'
  )
  expect(html).not.toContain('rel="manifest"')
  expect(html).toContain('name="robots" content="noindex"')
  expect(html).toContain('src="./assets/app.js"')
  expect(html.indexOf('src="./demo-transport.js"')).toBeLessThan(
    html.indexOf('<script type="module"')
  )
  expect(() => preparePreviewHtml('<head></head>')).toThrow('no module')
  expect(() => preparePreviewHtml('')).toThrow('no head')
})

test('preview retains source origin-level icons as well as nested app assets', () => {
  const out = mkdtempSync(join(tmpdir(), 'herdr-preview-assets-'))
  const source = join(import.meta.dir, '../../public')
  try {
    copyPreviewRootAssets(out)
    for (const path of ['favicon.ico', 'favicon.png', 'icons/icon-192.png'])
      expect(readFileSync(join(out, path))).toEqual(
        readFileSync(join(source, path))
      )
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('fork CI separates unit and explicitly dispatched shell-native proof without upstream installers', () => {
  const root = join(import.meta.dir, '../..')
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  expect(ci).toContain('bun-version: 1.4.2')
  expect(ci).toContain('Source unit suite only (no native preload)')
  expect(ci).toContain('include-hidden-files: true')
  expect(ci).toContain('.ci/unit.log')
  expect(ci).toContain('.ci/unit-summary.json')
  const block = ci.match(/run: \|\n([\s\S]*?)      - name: Fetch fixed source/)
  expect(block).not.toBeNull()
  const cwd = mkdtempSync(join(tmpdir(), 'herdr-ci-failure-'))
  try {
    mkdirSync(join(cwd, 'bin'))
    writeFileSync(
      join(cwd, 'bin/bun'),
      '#!/bin/sh\necho "intentional unit failure sentinel"\nexit 7\n',
      { mode: 0o700 }
    )
    const result = spawnSync('/bin/bash', ['-e', '-c', block![1]!], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${join(cwd, 'bin')}:/usr/bin:/bin` }
    })
    expect(result.status).toBe(7)
    expect(result.stdout).toContain('intentional unit failure sentinel')
    expect(readFileSync(join(cwd, '.ci/unit.log'), 'utf8')).toContain(
      'intentional unit failure sentinel'
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
  expect(ci).toContain(
    "github.event_name == 'workflow_dispatch' && inputs.native_shell_fixture"
  )
  expect(ci).toContain('run test:native')
  expect(ci).not.toContain('run check integration')
  expect(ci).not.toContain('devswha/herdr/releases')
})

test('cutover does not clear legacy storage or unrelated service-worker caches', () => {
  const root = join(import.meta.dir, '../..')
  const worker = readFileSync(join(root, 'public/sw.js'), 'utf8')
  expect(worker).toContain('name.startsWith("herdr-web-ui-")')
  const persistence = [
    'src/lib/composerDraft.ts',
    'src/lib/pendingMessages.ts',
    'src/lib/messageQueue.ts',
    'src/lib/settings.ts'
  ]
    .map((path) => readFileSync(join(root, path), 'utf8'))
    .join('\n')
  for (const key of [
    'herdr-web:prompt-drafts:v1',
    'herdr-web:held-queue:v1',
    'herdr-web:push-events:v1',
    'herdr-web:unread-notify:v1',
    'herdr-web:operation-pending:v1',
    'herdr-web:pending-compose:v1'
  ])
    expect(persistence).not.toContain(key)
  expect(persistence).not.toContain('localStorage.clear(')
})
