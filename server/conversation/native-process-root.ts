import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface IProcessRoots {
  pid: number
  start: string
  source: 'kern-procargs2'
  keys: {
    CODEX_HOME: string | null
    CLAUDE_CONFIG_DIR: string | null
    HOME: string | null
    PI_CODING_AGENT_DIR?: string | null
    PI_CODING_AGENT_SESSION_DIR?: string | null
    OMO_CODING_AGENT_DIR?: string | null
    SENPI_CODING_AGENT_DIR?: string | null
  }
}
const sources = {
  roots: fileURLToPath(new URL('./native/process-roots.c', import.meta.url)),
  rollouts: fileURLToPath(
    new URL('./native/codex-rollout-fds.c', import.meta.url)
  )
}
const cacheRoot = fileURLToPath(
  new URL('../../.agent-state/tmp/native-process-root', import.meta.url)
)
const compiling = new Map<
  keyof typeof sources,
  { fingerprint: string; promise: Promise<string> }
>()
const hash = (text: crypto.BinaryLike) =>
  crypto.createHash('sha256').update(text).digest('hex')
const unavailable = () => new Error('Native process-root authority unavailable')
const run = async (argv: string[], max = 16384) => {
  const child = Bun.spawn(argv, {
    env: { PATH: '/usr/bin:/bin', TMPDIR: '/tmp' },
    stdout: 'pipe',
    stderr: 'ignore'
  })
  const timer = setTimeout(() => child.kill(), 10000)
  try {
    const reader = child.stdout.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.length
      if (size > max) {
        child.kill()
        throw unavailable()
      }
      chunks.push(chunk.value)
    }
    if ((await child.exited) !== 0) throw unavailable()
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.concat(chunks)
    )
  } finally {
    clearTimeout(timer)
  }
}
/** Explicit lazy readiness; one compilation promise, source/platform/toolchain keyed. */
const ensureNativeHelperReady = (
  kind: keyof typeof sources
): Promise<string> => {
  const source = sources[kind]
  const sourceBytes = fs.readFileSync(source)
  const fingerprint = hash(sourceBytes)
  const previous = compiling.get(kind)
  if (previous?.fingerprint === fingerprint) return previous.promise
  const promise = (async () => {
    if (process.platform !== 'darwin') throw unavailable()
    const compiler = (await run(['/usr/bin/xcrun', '--find', 'clang'])).trim()
    if (!path.isAbsolute(compiler)) throw unavailable()
    const toolchain = await run([compiler, '--version'])
    const sdk = (await run(['/usr/bin/xcrun', '--show-sdk-path'])).trim()
    if (!path.isAbsolute(sdk)) throw unavailable()
    const key = hash(
      Buffer.concat([
        sourceBytes,
        Buffer.from(process.platform + process.arch + toolchain + sdk)
      ])
    )
    fs.mkdirSync(cacheRoot, { recursive: true, mode: 0o700 })
    if (
      fs.lstatSync(cacheRoot).isSymbolicLink() ||
      !fs.statSync(cacheRoot).isDirectory()
    )
      throw unavailable()
    const binary = path.join(cacheRoot, key)
    if (fs.existsSync(binary)) {
      const stat = fs.lstatSync(binary)
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.uid !== process.getuid?.()
      )
        throw unavailable()
      return binary
    }
    const temporary = path.join(
      cacheRoot,
      `${key}-${crypto.randomBytes(8).toString('hex')}`
    )
    try {
      await run([
        compiler,
        '-isysroot',
        sdk,
        '-std=c11',
        '-Wall',
        '-Wextra',
        '-Werror',
        '-O2',
        source,
        '-o',
        temporary
      ])
      if (hash(fs.readFileSync(source)) !== fingerprint) throw unavailable()
      fs.chmodSync(temporary, 0o700)
      fs.renameSync(temporary, binary)
      return binary
    } finally {
      fs.rmSync(temporary, { force: true })
    }
  })().catch((error) => {
    compiling.delete(kind)
    throw error
  })
  compiling.set(kind, { fingerprint, promise })
  return promise
}
export const ensureNativeProcessRootReady = () =>
  ensureNativeHelperReady('roots')

/** Separate private FD authority: only canonical native rollout filenames, never other FDs. */
export const selectedCodexRolloutFiles = async (
  pid: number,
  root: string,
  start: string
): Promise<string[]> => {
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !path.isAbsolute(root) ||
    Buffer.byteLength(root) > 4096 ||
    !/^\d+:\d+$/.test(start)
  )
    throw unavailable()
  const binary = await ensureNativeHelperReady('rollouts')
  const value = JSON.parse(
    await run([binary, String(pid), root, start], 256 * 1024)
  )
  if (
    value.pid !== pid ||
    value.start !== start ||
    value.source !== 'native-rollout-fd' ||
    !Array.isArray(value.files) ||
    value.files.length > 64 ||
    Object.keys(value).sort().join(',') !== 'files,pid,source,start'
  )
    throw unavailable()
  for (const file of value.files)
    if (
      typeof file !== 'string' ||
      !file.startsWith(root + path.sep) ||
      file.length > 4096 ||
      !file.endsWith('.jsonl')
    )
      throw unavailable()
  return [...new Set<string>(value.files)]
}
/** Exact session descriptors under one already authorized pi-family session root. */
export const selectedFamilySessionFiles = async (
  pid: number,
  root: string,
  start: string
): Promise<string[]> => {
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !path.isAbsolute(root) ||
    Buffer.byteLength(root) > 4096 ||
    !/^\d+:\d+$/.test(start)
  )
    throw unavailable()
  const binary = await ensureNativeHelperReady('rollouts')
  const canonical = fs.realpathSync(root)
  const value = JSON.parse(
    await run([binary, String(pid), canonical, start, 'family'], 256 * 1024)
  )
  if (
    value.pid !== pid ||
    value.start !== start ||
    value.source !== 'native-rollout-fd' ||
    !Array.isArray(value.files) ||
    value.files.length > 64 ||
    Object.keys(value).sort().join(',') !== 'files,pid,source,start'
  )
    throw unavailable()
  for (const file of value.files)
    if (
      typeof file !== 'string' ||
      !file.startsWith(canonical + path.sep) ||
      file.length > 4096 ||
      !file.endsWith('.jsonl')
    )
      throw unavailable()
  return [
    ...new Set<string>(
      value.files.map((file: string) =>
        path.join(root, path.relative(canonical, file))
      )
    )
  ]
}
/** PRIVATE: callers must supply PID from authenticated canonical native process evidence. */
export const selectedProcessRoots = async (
  pid: number,
  family = false
): Promise<IProcessRoots> => {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw unavailable()
  const binary = await ensureNativeProcessRootReady()
  const value = JSON.parse(
    await run([binary, String(pid), ...(family ? ['family'] : [])])
  ) as IProcessRoots
  if (
    value.pid !== pid ||
    value.source !== 'kern-procargs2' ||
    !/^\d+:\d+$/.test(value.start) ||
    Object.keys(value).sort().join(',') !== 'keys,pid,source,start' ||
    !value.keys ||
    Object.keys(value.keys).sort().join(',') !==
      (family
        ? 'CLAUDE_CONFIG_DIR,CODEX_HOME,HOME,OMO_CODING_AGENT_DIR,PI_CODING_AGENT_DIR,PI_CODING_AGENT_SESSION_DIR,SENPI_CODING_AGENT_DIR'
        : 'CLAUDE_CONFIG_DIR,CODEX_HOME,HOME')
  )
    throw unavailable()
  for (const [key, root] of Object.entries(value.keys))
    if (
      root !== null &&
      (typeof root !== 'string' ||
        (['HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR'].includes(key) &&
          !path.isAbsolute(root)) ||
        !root.length ||
        Buffer.byteLength(root) > 4096 ||
        /[\x00-\x1f\x7f]/.test(root))
    )
      throw unavailable()
  // Never treat an empty/hidden environment as proof of absent overrides.
  if (Object.values(value.keys).every((root) => root === null))
    throw unavailable()
  for (const key of [
    'PI_CODING_AGENT_DIR',
    'PI_CODING_AGENT_SESSION_DIR',
    'OMO_CODING_AGENT_DIR',
    'SENPI_CODING_AGENT_DIR'
  ] as const)
    if (value.keys[key] === null) delete value.keys[key]
  return value
}
