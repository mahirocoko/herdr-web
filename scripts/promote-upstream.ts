import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  chmodSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import {
  PROMOTION_ADDITIONS,
  PROMOTION_PATCHES,
  PROMOTION_REFERENCES
} from './verify-upstream.ts'

// Historical one-time T195 promotion, not the current cleanup generator.
// Retired distribution owners must not be resurrected by an old promotion receipt.
if (JSON.parse(readFileSync(resolve(import.meta.dir, '../SOURCE_MANIFEST.json'), 'utf8')).promotion?.removals?.length)
  throw new Error('One-time promotion is retired after fork cleanup; use current source owners')
// No daemon, installer, transaction engine or automatic rollback.
const root = resolve(import.meta.dir, '..')
const source = join(root, 'adoption/upstream')
const backup = join(root, '.agent-state/private-backups/t195/source-cutover')
const reference = join(root, '.agent-state/qa/upstream-parity/reference-site')
const flag = JSON.parse(
  readFileSync(
    join(root, '.agent-state/qa/upstream-parity/runtime-scout-ready.json'),
    'utf8'
  )
)
if (
  !flag.ready ||
  !existsSync(
    join(root, '.agent-state/private-backups/t195/20261019-190358/receipt.json')
  )
)
  throw new Error('Required source/ownership backup receipt missing')
const manifest = JSON.parse(
  readFileSync(
    join(
      ['references', 'audit'].includes(process.argv[2] || '') ? root : source,
      'SOURCE_MANIFEST.json'
    ),
    'utf8'
  )
)
if (manifest.pin !== 'd918448647e41079c52047ffc96cdaac50ccba32')
  throw new Error('Unexpected source pin')
const files = (dir: string, prefix = ''): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = prefix + name
    const stat = lstatSync(join(dir, name))
    if (stat.isSymbolicLink())
      throw new Error(`Unexpected symlink in protected inventory: ${path}`)
    return stat.isDirectory() ? files(join(dir, name), path + '/') : [path]
  })
const hash = (path: string) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
const privateCopy = (from: string, to: string) => {
  if (!existsSync(from)) return
  cpSync(from, to, {
    recursive: true,
    preserveTimestamps: true,
    errorOnExist: true,
    force: false
  })
  const secure = (path: string) => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink())
      throw new Error(
        'Private backup contains a symlink; no target permissions changed'
      )
    chmodSync(path, stat.isDirectory() ? 0o700 : 0o600)
    if (stat.isDirectory())
      for (const entry of readdirSync(path)) secure(join(path, entry))
  }
  secure(to)
}
if (process.argv[2] === 'audit') {
  const original = join(homedir(), '.config/herdr-web')
  const saved = join(backup, 'legacy-private-config')
  const inventory = files(saved)
  if (
    JSON.stringify(inventory.sort()) !== JSON.stringify(files(original).sort())
  )
    throw new Error('Legacy private config inventory changed')
  for (const path of inventory)
    if (hash(join(saved, path)) !== hash(join(original, path)))
      throw new Error('Legacy private config bytes changed')
  for (const kind of ['build', 'dist']) {
    const copy = join(backup, kind),
      frozen = join(backup, `frozen-${kind}`)
    if (existsSync(copy))
      for (const path of files(copy))
        if (hash(join(copy, path)) !== hash(join(frozen, path)))
          throw new Error('Frozen legacy static output changed')
  }
  const runtime = join(root, '.agent-state/runtime/upstream-v10700')
  const current = JSON.parse(readFileSync(join(runtime, 'vapid.json'), 'utf8'))
  const old = JSON.parse(
    readFileSync(join(original, 'push-config.json'), 'utf8')
  )
  if (
    current.publicKey !== old.publicKey ||
    current.privateKey !== old.privateKey
  )
    throw new Error('Push identity differs from preserved legacy key')
  const result = {
    privateConfigFiles: inventory.length,
    privateConfigByteEqual: true,
    privateConfigHasNoSymlinks: true,
    frozenLegacyStaticByteEqual: true,
    frozenLegacyGraphExists: existsSync(join(backup, 'frozen-node_modules')),
    samePushIdentity: true,
    sourceStateMode: lstatSync(runtime).mode & 0o777,
    sourceVapidMode: lstatSync(join(runtime, 'vapid.json')).mode & 0o777,
    browserProfileInspectedOrChanged: false,
    keyMaterialPrinted: false
  }
  writeFileSync(
    join(root, '.agent-state/qa/upstream-parity/protected-state-audit.json'),
    JSON.stringify(result, null, 2),
    { mode: 0o600 }
  )
  console.log(JSON.stringify(result))
} else if (process.argv[2] === 'references') {
  const git = join(root, '.agent-state/learn/devswha/herdr-web-ui/origin')
  for (const path of PROMOTION_REFERENCES) {
    const target = join(root, 'docs/upstream-reference/automation', path)
    mkdirSync(dirname(target), { recursive: true })
    const data = execFileSync('git', [
      '-C',
      git,
      'show',
      `${manifest.pin}:${path}`
    ])
    if (existsSync(target)) {
      if (!readFileSync(target).equals(data))
        throw new Error(
          `Inert reference was edited; refusing overwrite: ${path}`
        )
    } else writeFileSync(target, data, { mode: 0o644 })
  }
  manifest.promotion = {
    ...manifest.promotion,
    patches: PROMOTION_PATCHES,
    additions: PROMOTION_ADDITIONS,
    references: PROMOTION_REFERENCES
  }
  writeFileSync(
    join(root, 'SOURCE_MANIFEST.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  )
  console.log(
    JSON.stringify({
      inertAutomationReferences: PROMOTION_REFERENCES.length,
      activatedUpstreamWorkflows: 0
    })
  )
} else if (process.argv[2] === 'backup') {
  if (existsSync(backup) || existsSync(reference))
    throw new Error(
      'Backup/reference already exists; inspect instead of overwriting'
    )
  mkdirSync(backup, { recursive: true, mode: 0o700 })
  mkdirSync(reference, { recursive: true, mode: 0o700 })
  privateCopy(
    join(homedir(), '.config/herdr-web'),
    join(backup, 'legacy-private-config')
  )
  for (const path of ['build', 'dist'])
    privateCopy(join(root, path), join(backup, path))
  cpSync(join(source, '.preview'), reference, {
    recursive: true,
    preserveTimestamps: true
  })
  const preview = files(join(source, '.preview'))
  for (const path of preview)
    if (hash(join(source, '.preview', path)) !== hash(join(reference, path)))
      throw new Error('Reference copy mismatch')
  const protectedPaths = ['.agent-state/image-uploads', '.herdr', '.letta'].map(
    (path) => ({
      path,
      preservedInPlace: true,
      exists: existsSync(join(root, path))
    })
  )
  writeFileSync(
    join(backup, 'receipt.json'),
    JSON.stringify(
      {
        pin: manifest.pin,
        privateConfigCopied: existsSync(join(backup, 'legacy-private-config')),
        previewFiles: preview.length,
        protectedPaths,
        legacy: flag.legacy,
        nativePane: 'w7Q:p1S',
        nativeTab: 'w7Q:t1P',
        legacyPort: 8787,
        referencePort: 8793
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  console.log(
    JSON.stringify({
      backupReady: true,
      previewFiles: preview.length,
      credentialsPrinted: false
    })
  )
} else if (process.argv[2] === 'promote') {
  if (!existsSync(join(backup, 'receipt.json')))
    throw new Error('Protected backup must precede cutover')
  const listeners = Bun.spawnSync(
    ['lsof', '-nP', '-iTCP:8787', '-sTCP:LISTEN'],
    { stdout: 'pipe', stderr: 'ignore' }
  )
  if (listeners.exitCode === 0)
    throw new Error('Stop the verified legacy listener before promotion')
  const history = join(root, 'docs/history/legacy')
  mkdirSync(history, { recursive: true })
  for (const path of ['AGENTS.md', 'README.md', 'THIRD_PARTY_NOTICES.md'])
    cpSync(join(root, path), join(history, path))
  for (const path of readdirSync(join(root, 'docs'))) {
    if (['upstream-parity.md', 'history'].includes(path)) continue
    renameSync(join(root, 'docs', path), join(history, path))
  }
  const retired = [
    'app',
    'src',
    'server',
    'public',
    'browser',
    'react-router.config.ts',
    'tsconfig.node.json',
    'scripts/init-push.ts',
    'scripts/sync-herdr-schema.ts',
    'scripts/check-coverage.ts',
    'scripts/__tests__/browser-fixture.test.ts',
    'scripts/__tests__/init-push.test.ts',
    'scripts/__tests__/sync-herdr-schema.test.ts'
  ]
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], {
    encoding: 'utf8'
  })
    .split('\0')
    .filter(Boolean)
  manifest.retiredLegacyPaths = tracked.filter((path) =>
    retired.some((prefix) => path === prefix || path.startsWith(prefix + '/'))
  )
  for (const path of retired)
    rmSync(join(root, path), { recursive: true, force: true })
  for (const path of ['node_modules', 'build', 'dist', '.react-router'])
    if (existsSync(join(root, path)))
      renameSync(
        join(root, path),
        join(backup, `frozen-${path.replace(/^\./, '')}`)
      )
  const mapped = (path: string) =>
    path === 'LICENSE'
      ? 'UPSTREAM_LICENSE'
      : path.startsWith('README')
        ? `docs/upstream-reference/${path}`
        : path
  for (const entry of manifest.entries) {
    if (entry.disposition !== 'acquired' || entry.path === '.gitignore')
      continue
    const target = join(root, mapped(entry.path))
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(source, entry.path), target, { preserveTimestamps: true })
  }
  for (const path of [
    'server/fork-policy.ts',
    'server/fork-policy.test.ts',
    'scripts/run-local.ts',
    'scripts/fork-native-check.ts',
    'scripts/preview-build.ts'
  ])
    cpSync(join(source, path), join(root, path))
  renameSync(join(source, 'node_modules'), join(root, 'node_modules'))
  if (existsSync(join(source, 'dist')))
    renameSync(join(source, 'dist'), join(root, 'dist'))
  manifest.promotion = {
    patches: PROMOTION_PATCHES,
    additions: PROMOTION_ADDITIONS,
    license: 'UPSTREAM_LICENSE',
    readmes: 'docs/upstream-reference'
  }
  writeFileSync(
    join(root, 'SOURCE_MANIFEST.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  )
  rmSync(source, { recursive: true })
  rmSync(join(root, 'adoption'), { recursive: true })
  console.log(
    JSON.stringify({
      promoted: true,
      acquired: manifest.entries.filter(
        (e: { disposition: string }) => e.disposition === 'acquired'
      ).length,
      retiredLegacyFiles: manifest.retiredLegacyPaths.length,
      frozenLegacyGraph: true
    })
  )
} else
  throw new Error(
    'Use backup or promote; stop/launch are separate verified foreground operations'
  )
