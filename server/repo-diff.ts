// MIT License - Copyright (c) 2026 devswha
// Listing/comparison/process bounds adapted from dc2f11de server/repo-diff.ts.
// Local authentication, environment isolation and descriptor-only untracked reads.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { validateOwnerAuth, PANE_ID_REGEX } from './security.ts'
import { getHerdrSnapshot } from './herdr-adapter.ts'
import type {
  IRepoDiffFile,
  IRepoDiffFileList,
  IRepoDiffFilePatch,
  IRepoComparison,
  RepoDiffStatus
} from '../src/types/repo-diff.ts'

export interface IRepoDiffOptions {
  ownerLogin?: string
  snapshot?: typeof getHerdrSnapshot
  git?: string
  deadlineMs?: number
  maxListBytes?: number
  maxPatchBytes?: number
  maxFiles?: number
}
class DiffError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}
const fail = (code: string, message: string, status: number): never => {
  throw new DiffError(code, message, status)
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff'
    }
  })
const revision = /^[A-Za-z0-9][A-Za-z0-9._/~^@{}-]{0,199}$/
const safeRevision = (value: string) =>
  revision.test(value) && !value.includes('..')
const safePath = (value: string) =>
  value.length > 0 &&
  Buffer.byteLength(value) <= 4096 &&
  !/[\x00-\x08\x0a-\x1f\x7f\\]/.test(value) &&
  !value.startsWith('/') &&
  !value.split('/').some((p) => p === '..' || p === '.' || p === '')
const flags = [
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--find-renames',
  '--ignore-submodules=all',
  '--src-prefix=a/',
  '--dst-prefix=b/'
]
const status: Record<string, RepoDiffStatus> = {
  A: 'added',
  D: 'deleted',
  M: 'modified',
  R: 'renamed',
  C: 'copied',
  T: 'type_changed',
  U: 'unmerged'
}
const fields = (output: string) => {
  const end = output.lastIndexOf('\0')
  return end < 0 ? [] : output.slice(0, end).split('\0')
}

// Never inherit GIT_CONFIG_COUNT, alternate object stores, trace destinations,
// injected config or helper discovery from the process that launched this server.
export const diffGitEnvironment = () => ({
  PATH: '/usr/bin:/bin',
  HOME: '/nonexistent',
  XDG_CONFIG_HOME: '/nonexistent',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_NO_LAZY_FETCH: '1',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_ATTR_NOSYSTEM: '1',
  LC_ALL: 'C'
})
const runGit = async (
  cwd: string,
  args: string[],
  cap: number,
  options: IRepoDiffOptions
): Promise<{ code: number; overflow: boolean; stdout: string }> => {
  // Empty-tree attributes do NOT override common info/attributes. Gate that
  // metadata immediately before each diff spawn. Cooperative same-UID/stable
  // metadata is required; this is not atomic kernel protection against races.
  const attributeArgs: string[] = []
  if (args[0] === 'diff') {
    const format = await runGit(
      cwd,
      ['rev-parse', '--show-object-format'],
      128,
      options
    )
    const algorithm = format.stdout.trim()
    if (format.code !== 0 || !['sha1', 'sha256'].includes(algorithm))
      return fail('git_failed', 'Unsupported repository object format', 500)
    attributeArgs.push(
      `--attr-source=${createHash(algorithm).update('tree 0\0').digest('hex')}`
    )
  }
  if (args[0] === 'diff')
    assertMetadataAttributes(await repositoryDirectories(cwd, options))
  let proc: Bun.Subprocess<'ignore', 'pipe', 'ignore'>
  try {
    proc = Bun.spawn(
      [
        options.git ?? '/usr/bin/git',
        '--no-pager',
        '--no-optional-locks',
        '--literal-pathspecs',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.quotePath=false',
        '-c',
        'color.ui=never',
        '-c',
        'diff.external=',
        '-c',
        'core.attributesFile=/dev/null',
        ...attributeArgs,
        '-C',
        cwd,
        ...args
      ],
      {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'ignore',
        env: diffGitEnvironment()
      }
    )
  } catch {
    return fail('git_unavailable', 'Git could not be started', 503)
  }
  const reader = proc.stdout.getReader(),
    chunks: Uint8Array[] = []
  let timedOut = false,
    overflow = false,
    size = 0
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill('SIGKILL')
    void reader.cancel().catch(() => {})
  }, options.deadlineMs ?? 5000)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > cap) {
        overflow = true
        proc.kill('SIGKILL')
        void reader.cancel().catch(() => {})
        break
      }
      chunks.push(value)
    }
    const code = await proc.exited
    if (timedOut) return fail('git_timeout', 'Git did not answer in time', 504)
    if (!overflow && code === 129 && args[0] === 'diff')
      return fail(
        'git_unsupported',
        'Git cannot safely read changes: --attr-source support is required',
        503
      )
    return { code, overflow, stdout: Buffer.concat(chunks).toString('utf8') }
  } finally {
    clearTimeout(timer)
  }
}
const repositoryDirectories = async (
  cwd: string,
  options: IRepoDiffOptions
) => {
  const locate = async (args: string[]) => {
    const result = await runGit(
      cwd,
      ['rev-parse', '--path-format=absolute', ...args],
      16384,
      options
    )
    if (result.code !== 0 || result.overflow || !result.stdout.trim())
      return fail('git_failed', 'Repository metadata unavailable', 409)
    return result.stdout.replace(/\r?\n$/, '')
  }
  const gitdir = fs.realpathSync(await locate(['--absolute-git-dir']))
  const commonPath = await locate(['--git-common-dir'])
  const common = fs.realpathSync(commonPath)
  const attributes = path.join(common, 'info', 'attributes')
  assertMetadataAttributes({ gitdir, common, attributes })
  const effectiveAttributes = await locate(['--git-path', 'info/attributes'])
  if (effectiveAttributes !== path.join(commonPath, 'info', 'attributes'))
    return fail(
      'attributes-unsupported',
      'Repository metadata attributes are unsupported',
      409
    )
  return { gitdir, common, attributes }
}
const assertMetadataAttributes = (
  dirs: Awaited<ReturnType<typeof repositoryDirectories>>
) => {
  const unsupported = () =>
    fail(
      'attributes-unsupported',
      'Repository metadata attributes are unsupported',
      409
    )
  // lstat observes dangling symlinks too; only ENOENT means truly absent.
  const inspect = (entry: string) => {
    try {
      return fs.lstatSync(entry)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      return unsupported()
    }
  }
  const info = inspect(path.join(dirs.common, 'info'))
  if (!info) return
  if (!info.isDirectory() || (info.mode & 0o500) !== 0o500) return unsupported()
  const attrs = inspect(dirs.attributes)
  if (
    attrs &&
    (!attrs.isFile() || attrs.size !== 0 || (attrs.mode & 0o400) === 0)
  )
    return unsupported()
}
type DiffSnapshot = Awaited<ReturnType<typeof getHerdrSnapshot>>
const paneBinding = (snapshot: DiffSnapshot, paneId: string) => {
  const panes = snapshot.panes.filter((p) => p.pane_id === paneId),
    pane = panes[0]
  if (panes.length !== 1 || !pane)
    return fail('pane_not_found', 'Pane unavailable', 404)
  const cwd = pane.foreground_cwd || pane.cwd
  if (!cwd || !path.isAbsolute(cwd) || !pane.terminal_id)
    return fail('invalid_cwd', 'Pane folder or terminal unavailable', 409)
  const agent = (snapshot.agents || []).find(
    (a) => a && (a.target === paneId || a.pane_id === paneId)
  )
  // Same pane-first, matching-agent fallback precedence as security preflight.
  const session =
    pane.agent_session?.value ??
    pane.agent_session?.id ??
    agent?.agent_session?.value ??
    agent?.agent_session?.id ??
    null
  return { paneId, terminalId: pane.terminal_id, cwd, session }
}
const repositoryIdentity = async (
  binding: ReturnType<typeof paneBinding>,
  root: string,
  comparison: IRepoComparison,
  options: IRepoDiffOptions
) => {
  const dirs = await repositoryDirectories(binding.cwd, options)
  const identify = (entry: string) => {
    const stat = fs.statSync(entry)
    if (!stat.isDirectory())
      return fail(
        'repository_changed',
        'Repository changed; refresh Changes',
        409
      )
    return { path: entry, dev: stat.dev, ino: stat.ino }
  }
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        ...binding,
        root: identify(root),
        gitdir: identify(dirs.gitdir),
        common: identify(dirs.common),
        ...comparison
      })
    )
    .digest('hex')
}
const resolveRevision = async (
  root: string,
  value: string,
  options: IRepoDiffOptions
) => {
  const run = await runGit(
    root,
    [
      'rev-parse',
      '--quiet',
      '--verify',
      '--end-of-options',
      `${value}^{commit}`
    ],
    1024,
    options
  )
  const oid = run.stdout.trim()
  if (run.code !== 0 || run.overflow || !/^[0-9a-f]{40,64}$/.test(oid))
    return fail('revision_not_found', 'No commit by that name', 404)
  return oid
}
const changedFiles = async (
  root: string,
  args: string[],
  scope: string,
  options: IRepoDiffOptions
) => {
  const cap = options.maxListBytes ?? 2 * 1024 * 1024
  const [names, counts, others] = await Promise.all([
    runGit(
      root,
      ['diff', ...flags, '--name-status', '-z', ...args, '--'],
      cap,
      options
    ),
    runGit(
      root,
      ['diff', ...flags, '--numstat', '-z', ...args, '--'],
      cap,
      options
    ),
    scope === 'workspace'
      ? runGit(
          root,
          ['ls-files', '-z', '--others', '--exclude-standard', '--'],
          cap,
          options
        )
      : Promise.resolve({ code: 0, overflow: false, stdout: '' })
  ])
  for (const run of [names, counts, others])
    if (!run.overflow && run.code !== 0)
      return fail('git_failed', 'Git could not compare this repository', 500)
  const stats = new Map<
    string,
    { additions: number | null; deletions: number | null; binary: boolean }
  >()
  const numbers = fields(counts.stdout)
  for (let i = 0; i < numbers.length; i++) {
    const [added, deleted, ...rest] = numbers[i]!.split('\t')
    if (added === undefined || deleted === undefined) break
    let name = rest.join('\t')
    if (name === '') {
      name = numbers[i + 2] ?? ''
      i += 2
    }
    if (!name) break
    const binary = added === '-' || deleted === '-'
    stats.set(name, {
      additions: binary ? null : Number(added),
      deletions: binary ? null : Number(deleted),
      binary
    })
  }
  let omittedPaths = false
  const found = new Map<string, IRepoDiffFile>(),
    named = fields(names.stdout)
  for (let i = 0; i < named.length;) {
    const letter = named[i]![0] ?? '',
      kind = status[letter],
      paired = letter === 'R' || letter === 'C',
      name = named[i + (paired ? 2 : 1)]
    if (!kind || name === undefined) break
    const stat = kind === 'unmerged' ? undefined : stats.get(name)
    const valid = safePath(name) && (!paired || safePath(named[i + 1] ?? ''))
    if (!valid) omittedPaths = true
    if (valid && found.get(name)?.status !== 'unmerged')
      found.set(name, {
        path: name,
        old_path: paired ? named[i + 1]! : null,
        status: kind,
        additions: stat?.additions ?? null,
        deletions: stat?.deletions ?? null,
        binary: stat?.binary ?? null
      })
    i += paired ? 3 : 2
  }
  for (const name of fields(others.stdout)) {
    if (!safePath(name)) omittedPaths = true
    if (safePath(name) && !found.has(name))
      found.set(name, {
        path: name,
        old_path: null,
        status: 'untracked',
        additions: null,
        deletions: null,
        binary: null
      })
  }
  return {
    files: [...found.values()].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    ),
    complete:
      !omittedPaths && !names.overflow && !counts.overflow && !others.overflow
  }
}

// An untracked file is read only through a held regular-file descriptor. Git
// --no-index would reopen a pathname after sniffing, creating a symlink race.
const untrackedPatch = (
  root: string,
  name: string,
  cap: number
): { patch: string | null; unavailable: IRepoDiffFilePatch['unavailable'] } => {
  let fd: number | undefined
  try {
    const target = path.join(root, name),
      canonical = fs.realpathSync(target)
    if (canonical !== target || !canonical.startsWith(root + path.sep))
      return { patch: null, unavailable: 'unsupported' }
    const before = fs.lstatSync(target)
    if (!before.isFile()) return { patch: null, unavailable: 'unsupported' }
    if (before.size > cap) return { patch: null, unavailable: 'too_large' }
    fd = fs.openSync(
      target,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
    )
    const same = (s: fs.Stats) =>
      s.isFile() &&
      s.dev === before.dev &&
      s.ino === before.ino &&
      s.size === before.size &&
      s.mtimeMs === before.mtimeMs &&
      s.ctimeMs === before.ctimeMs
    if (
      !same(fs.fstatSync(fd)) ||
      fs.realpathSync(target) !== canonical ||
      !same(fs.lstatSync(canonical))
    )
      return { patch: null, unavailable: 'unsupported' }
    const bytes = Buffer.alloc(before.size)
    if (
      fs.readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length ||
      !same(fs.fstatSync(fd)) ||
      fs.realpathSync(target) !== canonical ||
      !same(fs.lstatSync(canonical))
    )
      return { patch: null, unavailable: 'unsupported' }
    if (bytes.includes(0)) return { patch: null, unavailable: 'binary' }
    const text = bytes.toString('utf8'),
      lines = text === '' ? [] : text.replace(/\n$/, '').split('\n')
    const quoted = (prefix: string) => JSON.stringify(prefix + name)
    const patchText =
      `diff --git ${quoted('a/')} ${quoted('b/')}\nnew file mode 100644\n--- /dev/null\n+++ ${quoted('b/')}\n` +
      (lines.length
        ? `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => '+' + l).join('\n')}\n${text.endsWith('\n') ? '' : '\\ No newline at end of file\n'}`
        : '')
    return Buffer.byteLength(patchText) > cap
      ? { patch: null, unavailable: 'too_large' }
      : { patch: patchText, unavailable: null }
  } catch {
    return { patch: null, unavailable: 'unsupported' }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

export const handleRepoDiffRequest = async (
  req: Request,
  kind: 'files' | 'file',
  options: IRepoDiffOptions = {}
) => {
  const auth = validateOwnerAuth(
    req,
    req.headers.get('host'),
    req.headers.get('origin'),
    options.ownerLogin,
    { requireOrigin: false }
  )
  if (!auth.allowed)
    return json(
      {
        error: { code: 'unauthorized', message: 'Changes are not authorized' }
      },
      auth.status
    )
  if (req.method !== 'GET')
    return json(
      { error: { code: 'invalid_method', message: 'Method not allowed' } },
      405
    )
  const q = new URL(req.url).searchParams
  const scope = q.get('scope') ?? 'workspace',
    paneId = q.get('pane_id') ?? '',
    base = q.get('base'),
    head = q.get('head'),
    name = q.get('path'),
    oldPath = q.get('old_path'),
    expectedIdentity = q.get('repository_identity')
  const invalid =
    [...q.keys()].some(
      (k) =>
        ![
          'pane_id',
          'scope',
          'base',
          'head',
          ...(kind === 'file'
            ? ['path', 'old_path', 'repository_identity']
            : [])
        ].includes(k) || q.getAll(k).length !== 1
    ) ||
    paneId.length > 128 ||
    !PANE_ID_REGEX.test(paneId) ||
    !['workspace', 'staged', 'commit'].includes(scope) ||
    (scope === 'commit'
      ? !base || !head || !safeRevision(base) || !safeRevision(head)
      : base !== null || head !== null) ||
    (kind === 'file' &&
      (!name ||
        !safePath(name) ||
        (oldPath !== null && !safePath(oldPath)) ||
        !expectedIdentity ||
        !/^[0-9a-f]{64}$/.test(expectedIdentity) ||
        (scope === 'commit' &&
          (!/^[0-9a-f]{40,64}$/.test(base!) ||
            !/^[0-9a-f]{40,64}$/.test(head!)))))
  if (invalid)
    return json(
      { error: { code: 'invalid_query', message: 'Invalid changes request' } },
      400
    )
  try {
    const snapshot = await (options.snapshot ?? getHerdrSnapshot)(3000)
    const binding = paneBinding(snapshot, paneId)
    const { cwd } = binding
    const top = await runGit(
      cwd,
      ['rev-parse', '--show-toplevel'],
      16384,
      options
    )
    if (top.code !== 0 || top.overflow || !top.stdout.trim())
      return fail(
        'not_a_repository',
        'This pane is not in a Git working tree',
        409
      )
    const root = fs.realpathSync(top.stdout.replace(/\r?\n$/, ''))
    const branch = await runGit(
        root,
        ['symbolic-ref', '--quiet', '--short', 'HEAD'],
        16384,
        options
      ),
      current = await runGit(
        root,
        ['rev-parse', '--quiet', '--verify', 'HEAD^{commit}'],
        1024,
        options
      )
    const repository = {
      root,
      branch: branch.code === 0 ? branch.stdout.trim() : null,
      head: current.code === 0 ? current.stdout.trim() : null,
      detached: branch.code !== 0 && current.code === 0,
      unborn: current.code !== 0
    }
    const comparison: IRepoComparison = {
      scope: scope as IRepoComparison['scope'],
      base:
        scope === 'commit' ? await resolveRevision(root, base!, options) : null,
      head:
        scope === 'commit' ? await resolveRevision(root, head!, options) : null
    }
    const args =
      comparison.scope === 'commit'
        ? [comparison.base!, comparison.head!]
        : comparison.scope === 'staged'
          ? ['--cached']
          : []
    const repository_identity = await repositoryIdentity(
      binding,
      root,
      comparison,
      options
    )
    if (kind === 'file' && expectedIdentity !== repository_identity)
      return fail(
        'repository_changed',
        'Repository target changed; refresh Changes',
        409
      )
    const listing = await changedFiles(root, args, scope, options)
    let body: IRepoDiffFileList | IRepoDiffFilePatch
    if (kind === 'files')
      body = {
        repository,
        repository_identity,
        ...comparison,
        files: listing.files.slice(0, options.maxFiles ?? 2000),
        total: listing.complete ? listing.files.length : null,
        truncated:
          !listing.complete ||
          listing.files.length > (options.maxFiles ?? 2000),
        limits: {
          max_files: options.maxFiles ?? 2000,
          max_list_bytes: options.maxListBytes ?? 2 * 1024 * 1024
        }
      }
    else {
      if (!listing.complete)
        return fail(
          'list_too_large',
          'Refresh with a smaller repository comparison',
          413
        )
      const file = listing.files.find((f) => f.path === name)
      if (!file)
        return fail(
          'not_found',
          'Nothing changed at that path; refresh Changes',
          404
        )
      if (oldPath !== null && oldPath !== file.old_path)
        return fail(
          'invalid_path',
          'Rename identity changed; refresh Changes',
          400
        )
      const cap = options.maxPatchBytes ?? 1024 * 1024
      let patch: string | null = null,
        unavailable: IRepoDiffFilePatch['unavailable'] = null
      if (file.status === 'unmerged') unavailable = 'unmerged'
      else if (file.binary) unavailable = 'binary'
      else if (file.status === 'untracked')
        ({ patch, unavailable } = untrackedPatch(root, file.path, cap))
      else {
        const run = await runGit(
          root,
          [
            'diff',
            ...flags,
            '-U3',
            ...args,
            '--',
            ...(file.old_path ? [file.old_path] : []),
            file.path
          ],
          cap,
          options
        )
        if (run.overflow) unavailable = 'too_large'
        else if (run.code !== 0)
          return fail('git_failed', 'Git could not compare that file', 500)
        else if (!run.stdout.startsWith('diff --git '))
          unavailable = 'unsupported'
        else patch = run.stdout
      }
      const described =
        file.status === 'untracked' &&
        (patch !== null || unavailable === 'binary')
          ? { ...file, binary: unavailable === 'binary' }
          : file
      body = {
        repository,
        repository_identity,
        ...comparison,
        file: described,
        patch,
        unavailable,
        truncated: unavailable === 'too_large',
        limits: { max_patch_bytes: cap, context_lines: 3 }
      }
    }
    const post = paneBinding(
      await (options.snapshot ?? getHerdrSnapshot)(3000),
      paneId
    )
    if (
      JSON.stringify(post) !== JSON.stringify(binding) ||
      (await repositoryIdentity(
        post,
        fs.realpathSync(root),
        comparison,
        options
      )) !== repository_identity
    )
      return fail('pane_changed', 'Pane changed; reopen Changes', 409)
    return json(body)
  } catch (error) {
    return error instanceof DiffError
      ? json(
          { error: { code: error.code, message: error.message } },
          error.status
        )
      : json(
          { error: { code: 'unavailable', message: 'Changes unavailable' } },
          502
        )
  }
}
