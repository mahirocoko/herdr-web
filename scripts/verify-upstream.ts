import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

const pin = 'd918448647e41079c52047ffc96cdaac50ccba32'
const repository = 'https://github.com/devswha/herdr-web-ui'
// Derived independently from this exact pin, stripping only 15 trailing-space lines.
// No notice wording/content change is permitted by the general patch allowlist.
const normalizedNoticesBlob = '81624a95a6808ff5f1182f53b395eb2b20d1247c'
const forkPatchAllowlist = ['scripts/demo-build.ts']
const forkAddedPaths = [
  'AGENTS.md',
  'SOURCE_MANIFEST.json',
  'scripts/preview-build.ts',
]
const generatedDirectories = new Set(['node_modules', '.preview', '_site'])

const safePath = (path: string) => {
  if (
    !path ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    path.includes('\0')
  )
    throw new Error(`Unsafe source path: ${path}`)
  return path
}

// tree must come from the independently pinned Git object, never the manifest.
export const verifyCandidate = (root: string, tree: string) => {
  root = resolve(root)
  if (realpathSync(root) !== root || !lstatSync(root).isDirectory())
    throw new Error('Unsafe candidate root')
  const entries = tree
    .split('\0')
    .filter(Boolean)
    .map((row) => {
      const tab = row.indexOf('\t')
      if (tab < 0) throw new Error('Invalid Git tree')
      const [mode, type, blob] = row.slice(0, tab).split(' ')
      const path = safePath(row.slice(tab + 1))
      if (
        type !== 'blob' ||
        !['100644', '100755'].includes(mode!) ||
        !/^[a-f0-9]{40}$/.test(blob!)
      )
        throw new Error(`Unsupported Git entry: ${path}`)
      const excluded =
        /(^|\/)(AGENTS\.md|CLAUDE\.md)$/.test(path) ||
        path.startsWith('.github/') ||
        path === '.coderabbit.yaml'
      return {
        path,
        mode,
        blob,
        disposition: excluded ? 'excluded' : 'acquired',
      }
    })
  if (!entries.length) throw new Error('Empty pinned Git tree')
  const expected = new Map(entries.map((entry) => [entry.path, entry]))
  if (expected.size !== entries.length) throw new Error('Duplicate Git paths')

  // Inspect the entire source tree before reading any candidate file. Generated
  // output is outside this source audit; it is not evidence of build isolation.
  const files = new Set<string>()
  const walk = (directory: string, prefix = '') => {
    for (const name of readdirSync(directory)) {
      const path = safePath(prefix + name)
      const absolute = join(directory, name)
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) throw new Error(`Symlink source: ${path}`)
      if (!prefix && generatedDirectories.has(name) && stat.isDirectory())
        continue
      if (stat.isDirectory()) walk(absolute, path + '/')
      else if (stat.isFile()) files.add(path)
      else throw new Error(`Non-regular source: ${path}`)
    }
  }
  walk(root)
  for (const path of files) {
    if (forkAddedPaths.includes(path)) continue
    if (expected.get(path)?.disposition !== 'acquired')
      throw new Error(`Unexpected source: ${path}`)
  }
  for (const path of forkAddedPaths)
    if (!files.has(path)) throw new Error(`Missing fork addition: ${path}`)

  const manifest = JSON.parse(
    readFileSync(join(root, 'SOURCE_MANIFEST.json'), 'utf8'),
  )
  const samePaths = (actual: unknown, approved: string[]) =>
    Array.isArray(actual) &&
    actual.length === approved.length &&
    new Set(actual).size === approved.length &&
    actual.every((path) => approved.includes(path))
  if (manifest.pin !== pin || manifest.repository !== repository)
    throw new Error('Manifest repository/pin mismatch')
  if (
    !samePaths(manifest.forkPatchAllowlist, forkPatchAllowlist) ||
    !samePaths(manifest.forkAddedPaths, forkAddedPaths)
  )
    throw new Error('Manifest fork policy mismatch')
  if (
    !Array.isArray(manifest.entries) ||
    manifest.entries.length !== entries.length
  )
    throw new Error('Incomplete manifest inventory')
  const seen = new Set<string>()
  for (const entry of manifest.entries) {
    if (!entry || typeof entry.path !== 'string')
      throw new Error('Invalid manifest entry')
    safePath(entry.path)
    const source = expected.get(entry.path)
    if (
      seen.has(entry.path) ||
      !source ||
      entry.blob !== source.blob ||
      entry.mode !== source.mode ||
      entry.disposition !== source.disposition
    )
      throw new Error(`Manifest inventory mismatch: ${entry.path}`)
    seen.add(entry.path)
  }

  let acquired = 0
  let excluded = 0
  const patched: string[] = []
  for (const entry of entries) {
    if (entry.disposition === 'excluded') {
      excluded++
      continue
    }
    if (!files.has(entry.path)) throw new Error(`Missing source: ${entry.path}`)
    const absolute = join(root, entry.path)
    const data = readFileSync(absolute)
    const blob = createHash('sha1')
      .update(`blob ${data.length}\0`)
      .update(data)
      .digest('hex')
    if (blob !== entry.blob) {
      if (!forkPatchAllowlist.includes(entry.path))
        throw new Error(`Unapproved patch: ${entry.path}`)
      patched.push(entry.path)
    }
    const mode = lstatSync(absolute).mode & 0o111 ? '100755' : '100644'
    if (mode !== entry.mode) throw new Error(`Mode mismatch: ${entry.path}`)
    acquired++
  }
  const requiredNotices = ['LICENSE', 'THIRD_PARTY_NOTICES.md']
  const dependencyPatches = entries.filter(
    (entry) =>
      entry.disposition === 'acquired' && entry.path.startsWith('patches/'),
  )
  for (const path of [
    ...requiredNotices,
    ...dependencyPatches.map((entry) => entry.path),
  ])
    if (!files.has(path)) throw new Error(`Missing required file: ${path}`)
  if (dependencyPatches.length !== 2)
    throw new Error('Expected two pinned dependency patches')
  return {
    pin,
    acquired,
    excluded,
    patched,
    requiredNotices,
    dependencyPatches: dependencyPatches.length,
  }
}

export const PROMOTION_REFERENCES = [
  '.github/actions/setup-ci/action.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/pages.yml',
  '.github/workflows/omp-question-compat.yml',
]
export const PROMOTION_PATCHES = [
  'THIRD_PARTY_NOTICES.md',
  'scripts/conventions.test.ts',
  'scripts/pages-gate.test.ts',
  'scripts/ci-setup.test.ts',
  'scripts/install-star.test.ts',
  'scripts/line-endings.test.ts',
  'src/lib/markdownHtml.test.ts',
  '.gitignore',
  'package.json',
  'public/sw.js',
  'server/static.test.ts',
  'server/index.ts',
  'server/conversation.ts',
  'server/conversation-monitor.ts',
  'server/core/terminals.ts',
  'server/pane-routes.ts',
  'shared/protocol.ts',
  'server/core/status.ts',
  'server/core/connections.ts',
  'server/http.ts',
  'server/machine-api.ts',
  'server/machines.ts',
  'scripts/demo-build.ts',
  'scripts/ci-tests.ts',
  'tsconfig.tools.json',
  'index.html',
  'src/App.tsx',
  'src/components/AccessGate.tsx',
  'src/components/FileReader.tsx',
  'src/components/AgentMark.tsx',
  'src/components/AgentMark.test.tsx',
  'src/components/PaneTerminal.tsx',
  'src/components/MachineSidebar.tsx',
  'src/components/SettingsDialog.tsx',
  'src/lib/paletteSettings.ts',
  'src/lib/paletteSettings.test.ts',
  'src/lib/notifications.ts',
  'src/conventions.test.ts',
  'scripts/generate-brand.ts',
  'docs/brand/README.md',
  'public/manifest.webmanifest',
  'public/apple-touch-icon.png',
  'public/favicon.png',
  'public/favicon.ico',
  'public/icons/icon-192.png',
  'public/icons/icon-512.png',
  'public/icons/icon-maskable-192.png',
  'public/icons/icon-maskable-512.png',
  'public/icons/badge-96.png',
]
export const PROMOTION_ADDITIONS = [
  'server/letta.ts',
  'server/letta.test.ts',
  'server/letta-parser.ts',
  'server/letta-parser.test.ts',
  'server/letta-store.ts',
  'server/letta-store.test.ts',
  'server/fork-policy.ts',
  'server/fork-policy.test.ts',
  'scripts/run-local.ts',
  'scripts/run-local.test.ts',
  'scripts/bun-project.sh',
  'scripts/fork-native-check.ts',
  'scripts/preview-build.ts',
  'scripts/acquire-upstream.ts',
  'scripts/verify-upstream.ts',
  'scripts/promote-upstream.ts',
  'scripts/__tests__/verify-upstream.test.ts',
  'scripts/__tests__/upstream-isolation.test.ts',
  'public/favicon.svg',
  'public/icons/letta-webclip.png',
  'src/lib/terminalFitPause.ts',
  'src/lib/terminalFitPause.test.ts',
  'src/components/SettingsDialog.test.tsx',
  'scripts/brand.test.ts',
]
const promotedPath = (path: string) =>
  path === 'LICENSE'
    ? 'UPSTREAM_LICENSE'
    : path.startsWith('README')
      ? `docs/upstream-reference/${path}`
      : path

export const verifyPromoted = (root: string, tree: string) => {
  root = resolve(root)
  if (realpathSync(root) !== root || !lstatSync(root).isDirectory())
    throw new Error('Unsafe promoted root')
  const manifestPath = join(root, 'SOURCE_MANIFEST.json')
  const manifestStat = lstatSync(manifestPath)
  if (
    !manifestStat.isFile() ||
    manifestStat.isSymbolicLink() ||
    realpathSync(manifestPath) !== manifestPath
  )
    throw new Error('Unsafe promoted manifest')
  const manifest = JSON.parse(
    readFileSync(join(root, 'SOURCE_MANIFEST.json'), 'utf8'),
  )
  if (manifest.pin !== pin || manifest.repository !== repository)
    throw new Error('Promoted source pin mismatch')
  const same = (actual: unknown, expected: string[]) =>
    Array.isArray(actual) &&
    actual.length === expected.length &&
    new Set(actual).size === expected.length &&
    actual.every((value) => expected.includes(value))
  if (
    !same(manifest.promotion?.patches, PROMOTION_PATCHES) ||
    !same(manifest.promotion?.additions, PROMOTION_ADDITIONS) ||
    !same(manifest.promotion?.references, PROMOTION_REFERENCES)
  )
    throw new Error('Promoted fork policy mismatch')
  const expected = new Map<string, { blob: string; mode: string }>()
  const entries = tree
    .split('\0')
    .filter(Boolean)
    .map((row) => {
      const [meta, path] = row.split('\t')
      const [mode, type, blob] = meta!.split(' ')
      if (
        type !== 'blob' ||
        !['100644', '100755'].includes(mode!) ||
        !/^[a-f0-9]{40}$/.test(blob!)
      )
        throw new Error('Unsupported pinned source entry')
      safePath(path!)
      const excluded =
        /(^|\/)(AGENTS\.md|CLAUDE\.md)$/.test(path!) ||
        path!.startsWith('.github/') ||
        path === '.coderabbit.yaml'
      return {
        path: path!,
        mode: mode!,
        blob: blob!,
        disposition: excluded ? 'excluded' : 'acquired',
      }
    })
  if (
    !entries.length ||
    new Set(entries.map((entry) => entry.path)).size !== entries.length
  )
    throw new Error('Empty/duplicate pinned source inventory')
  if (
    !Array.isArray(manifest.entries) ||
    manifest.entries.length !== entries.length
  )
    throw new Error('Incomplete promoted manifest')
  const declared = new Map(
    manifest.entries.map((entry: { path: string }) => [entry.path, entry]),
  )
  if (declared.size !== entries.length)
    throw new Error('Duplicate promoted manifest inventory')
  const patched: string[] = []
  for (const entry of entries) {
    const actual = declared.get(entry.path) as typeof entry | undefined
    if (
      !actual ||
      actual.blob !== entry.blob ||
      actual.mode !== entry.mode ||
      actual.disposition !== entry.disposition
    )
      throw new Error(`Promoted manifest mismatch: ${entry.path}`)
    if (
      entry.disposition === 'excluded' &&
      (entry.path.startsWith('.github/') ||
        entry.path === '.coderabbit.yaml') &&
      entry.path !== '.github/workflows/ci.yml' &&
      lstatSync(join(root, entry.path), { throwIfNoEntry: false })
    )
      throw new Error(
        `Excluded upstream automation was activated: ${entry.path}`,
      )
    const inert =
      entry.disposition === 'excluded' &&
      PROMOTION_REFERENCES.includes(entry.path)
    if (entry.disposition === 'excluded' && !inert) continue
    const path = inert
      ? `docs/upstream-reference/automation/${entry.path}`
      : promotedPath(entry.path)
    if (!inert) expected.set(path, entry)
    const absolute = join(root, path)
    const stat = lstatSync(absolute)
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      realpathSync(absolute) !== absolute
    )
      throw new Error(`Unsafe promoted source: ${path}`)
    const data = readFileSync(absolute)
    const blob = createHash('sha1')
      .update(`blob ${data.length}\0`)
      .update(data)
      .digest('hex')
    if (blob !== entry.blob) {
      const noticeWithoutLetta = data
        .toString()
        .replace(
          "## Letta provider mark\n\nThe unmodified `public/icons/letta-webclip.png` is Letta's organization logo downloaded from https://www.letta.com/assets/images/webclip.png on 2026-10-19, as identified by the official site's organization metadata. SHA-256: `19564f266ec4e5628ecafc936cfe2ba0f8633e4959feded7ddf4000abf6c6508`. It is used solely to identify the Letta integration, not this fork's application brand. Letta retains its trademark and image rights; no open-source image license or endorsement is claimed. Original pixels, square background and full geometry are retained.\n\n",
          '',
        )
      const preservedNoticeBlob = createHash('sha1')
        .update(`blob ${Buffer.byteLength(noticeWithoutLetta)}\0`)
        .update(noticeWithoutLetta)
        .digest('hex')
      if (
        entry.path === 'THIRD_PARTY_NOTICES.md' &&
        preservedNoticeBlob !== normalizedNoticesBlob
      )
        throw new Error('Unapproved license notice change')
      if (inert || !PROMOTION_PATCHES.includes(entry.path))
        throw new Error(`Unapproved promoted source patch: ${entry.path}`)
      if (
        [
          'src/App.tsx',
          'src/components/AccessGate.tsx',
          'src/components/FileReader.tsx',
          'src/lib/notifications.ts',
        ].includes(entry.path)
      ) {
        const original = data
          .toString()
          .replaceAll('?v=mahiro1', '?v=ram1')
          .replaceAll(
            'Herdr <span className="brand-sub">Web</span>',
            'herdr <span className="brand-sub">web ui</span>',
          )
          .replace(
            'const APP_TITLE = "Herdr Web";',
            'const APP_TITLE = "herdr web ui";',
          )
          .replace(
            '`${selectedTitle} · Herdr Web`',
            '`${selectedTitle} · herdr`',
          )
          .replace(' · Herdr Web`', ' · herdr web ui`')
        const bytes = Buffer.from(original)
        const restored = createHash('sha1')
          .update(`blob ${bytes.length}\0`)
          .update(bytes)
          .digest('hex')
        if (restored !== entry.blob)
          throw new Error(`Non-brand runtime source change: ${entry.path}`)
      }
      patched.push(entry.path)
    }
    if ((stat.mode & 0o111 ? '100755' : '100644') !== entry.mode)
      throw new Error(`Promoted source mode mismatch: ${path}`)
  }
  const walk = (directory: string, prefix: string) => {
    for (const name of readdirSync(directory)) {
      const path = prefix + name
      const stat = lstatSync(join(root, path))
      if (stat.isSymbolicLink())
        throw new Error(`Promoted source symlink: ${path}`)
      if (stat.isDirectory()) walk(join(root, path), path + '/')
      else if (!expected.has(path) && !PROMOTION_ADDITIONS.includes(path))
        throw new Error(`Unexpected promoted code: ${path}`)
    }
  }
  for (const dir of ['server', 'src', 'shared', 'public', 'scripts'])
    walk(join(root, dir), dir + '/')
  for (const path of PROMOTION_ADDITIONS)
    if (!lstatSync(join(root, path)).isFile())
      throw new Error(`Missing fork owner: ${path}`)
  for (const path of [
    'app',
    'adoption/upstream',
    'react-router.config.ts',
    'tsconfig.node.json',
    'browser',
    'server/herdr-adapter.ts',
  ]) {
    try {
      lstatSync(join(root, path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    throw new Error(`Retired application still present: ${path}`)
  }
  return {
    pin,
    acquired: expected.size,
    excluded: entries.length - expected.size,
    patched,
    sourceUiByteEqual: !patched.some((path) => path.startsWith('src/')),
    dependencyPatches: [...expected.keys()].filter((path) =>
      path.startsWith('patches/'),
    ).length,
  }
}

export const verifyUpstream = (
  root = resolve(import.meta.dir, '..'),
  reference = resolve(
    import.meta.dir,
    '../.agent-state/learn/devswha/herdr-web-ui/origin',
  ),
) => {
  const tree = execFileSync(
    'git',
    ['-C', reference, 'ls-tree', '-rz', '--full-tree', pin],
    { maxBuffer: 256 * 1024 * 1024 },
  ).toString()
  return verifyPromoted(root, tree)
}

if (import.meta.main)
  console.log(
    JSON.stringify(verifyUpstream(undefined, process.argv[2]), null, 2),
  )
