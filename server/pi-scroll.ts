import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  resolveFamily,
  type IFamilyResolution
} from './conversation/pi-family-resolver.ts'
import { verifyTargetAgainstSnapshot } from './security.ts'
import type { IPiScrollAction, ISnapshotResult } from './types.ts'
import type { TerminalFitManager } from './terminal-fit.ts'

const unavailable = () => new Error('Pi page-scroll recipe binding unavailable')
// Bounded, no-follow reads used only for server-derived runtime files, never an
// action-supplied path. The native resolver owns the exact session/root selection.
const readBounded = (file: string, root: string, limit: number) => {
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw unavailable()
  let current = path.resolve(root)
  for (const part of ['', ...relative.split('/')]) {
    current = part ? path.join(current, part) : current
    if (fs.lstatSync(current).isSymbolicLink()) throw unavailable()
  }
  const fd = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
  )
  try {
    if (!fs.fstatSync(fd).isFile()) throw unavailable()
    const bytes = Buffer.alloc(limit + 1)
    const size = fs.readSync(fd, bytes, 0, bytes.length, 0)
    return bytes.subarray(0, size)
  } finally {
    fs.closeSync(fd)
  }
}
export const resolvePiScrollRuntime = async (
  paneId: string,
  snapshot: ISnapshotResult
): Promise<
  IFamilyResolution & { pageRecipe?: ReturnType<typeof verifyPiPageRecipe> }
> => {
  const pane = snapshot.panes.find((item) => item.pane_id === paneId)
  if (
    pane?.agent !== 'pi' ||
    pane.agent_session?.agent !== 'pi' ||
    pane.agent_session.kind !== 'path' ||
    pane.agent_session.source !== 'herdr:pi'
  )
    throw unavailable()
  const cwd = pane.foreground_cwd || pane.cwd
  if (!cwd) throw unavailable()
  const resolution = await resolveFamily(
    paneId,
    cwd,
    pane.agent_session.value,
    {},
    (file, root) => {
      const bytes = readBounded(file, root, 16384)
      const end = bytes.indexOf(10)
      if (end < 0 || end > 16384) throw unavailable()
      return JSON.parse(bytes.subarray(0, end).toString('utf8'))
    },
    () => {
      throw unavailable()
    },
    () => {
      throw unavailable()
    }
  )
  if (
    !resolution ||
    resolution.pending ||
    resolution.source !== 'pi-transcript' ||
    resolution.file !== pane.agent_session.value ||
    resolution.runtime?.provider !== 'pi'
  )
    throw unavailable()
  const pageRecipe = verifyPiPageRecipe(resolution.runtime, cwd)
  return Object.assign(resolution, { pageRecipe })
}

export const verifyPiPageRecipe = (
  runtime: NonNullable<IFamilyResolution['runtime']>,
  cwd: string,
  whichPi: () => string | null = () => Bun.which('pi')
) => {
  if (
    runtime.provider !== 'pi' ||
    !Number.isSafeInteger(runtime.pid) ||
    runtime.pid < 1 ||
    !/^\d+:\d+$/.test(runtime.start)
  )
    throw unavailable()
  const argvEvidence = runtime.argv.length > 0 ? 'available' : 'unavailable'
  // Missing native argv is explicitly unknown, not evidence of absent overrides.
  // The approved capability is fixed application page events, not a promise of
  // fullscreen/transcript-only semantics under arbitrary local extensions.
  const officialCli =
    /\/@earendil-works\/pi-coding-agent\/dist\/(?:bundle\/)?cli\.js$/
  let cli = runtime.argv.find((arg) => officialCli.test(arg))
  if (!cli && argvEvidence === 'unavailable') {
    const installed = whichPi()
    if (installed) cli = fs.realpathSync(installed)
  }
  if (!cli || !officialCli.test(cli)) throw unavailable()
  const packageRoot = cli.slice(0, cli.lastIndexOf('/dist/'))
  if (
    JSON.parse(
      readBounded(
        path.join(packageRoot, 'package.json'),
        packageRoot,
        65536
      ).toString()
    ).version !== '1.3.0'
  )
    throw unavailable()
  let mode: unknown = 'fullscreen'
  for (const [file, root] of [
    [path.join(runtime.agentDir, 'settings.json'), runtime.agentDir],
    [path.join(cwd, '.pi/settings.json'), cwd]
  ]) {
    try {
      const bytes = readBounded(file, root, 65536)
      if (bytes.length > 65536) throw unavailable()
      const settings = JSON.parse(bytes.toString('utf8'))
      if ('tuiMode' in settings) mode = settings.tuiMode
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  for (let at = 0; at < runtime.argv.length; at++) {
    const arg = runtime.argv[at]
    if (arg === '--tui-mode') mode = runtime.argv[++at]
    if (arg.startsWith('--tui-mode=')) mode = arg.slice(11)
    if (
      arg.startsWith('--mode=') ||
      ['--mode', '--print', '-p', '--help', '--version'].includes(arg)
    )
      throw unavailable()
  }
  if (mode !== 'fullscreen') throw unavailable()
  try {
    const bytes = readBounded(
      path.join(runtime.agentDir, 'keybindings.json'),
      runtime.agentDir,
      65536
    )
    if (bytes.length > 65536) throw unavailable()
    const bindings = JSON.parse(bytes.toString('utf8'))
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings))
      throw unavailable()
    for (const [action, value] of Object.entries(bindings)) {
      const keys = typeof value === 'string' ? [value] : value
      if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string'))
        throw unavailable()
      const normalized = keys.map((key: string) => key.toLowerCase())
      for (const [page, owners] of [
        ['pageup', ['pageUp', 'tui.editor.pageUp', 'tui.altScreen.pageUp']],
        [
          'pagedown',
          ['pageDown', 'tui.editor.pageDown', 'tui.altScreen.pageDown']
        ],
        ['ctrl+end', ['tui.altScreen.bottom']]
      ] as const) {
        const ownsPage = (owners as readonly string[]).includes(action)
        if (
          ownsPage !== normalized.includes(page) &&
          (ownsPage || normalized.includes(page))
        )
          throw unavailable()
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return {
    version: '1.3.0',
    modeEvidence:
      argvEvidence === 'available'
        ? 'settings-and-available-argv'
        : 'settings-default-argv-unavailable',
    argvEvidence,
    semantics: 'fixed-application-page-events'
  }
}

export const executePiScroll = async (
  action: IPiScrollAction,
  deps: {
    manager: TerminalFitManager
    snapshot: () => Promise<ISnapshotResult>
    ready: (target: IPiScrollAction['target']) => Promise<boolean>
    resolve?: typeof resolvePiScrollRuntime
  }
) => {
  let dispatched = false
  try {
    const binding = deps.manager.capturePiScrollProducer({
      ...action.target,
      generation: action.fitGeneration
    })
    if (!binding) throw unavailable()
    const snapshot = await deps.snapshot()
    if (!verifyTargetAgainstSnapshot(snapshot, action.target).ok)
      throw unavailable()
    const resolution: IFamilyResolution = await (
      deps.resolve ?? resolvePiScrollRuntime
    )(action.target.paneId, snapshot)
    if (!(await deps.ready(action.target))) throw unavailable()
    await resolution.validate()
    const post = await deps.snapshot()
    if (!verifyTargetAgainstSnapshot(post, action.target).ok)
      throw unavailable()
    dispatched = true
    const result = await deps.manager.writePiScrollPage(
      binding,
      action.direction
    )
    return {
      ok: result.outcome === 'written',
      status:
        result.outcome === 'written'
          ? 200
          : result.outcome === 'rejected'
            ? 409
            : 502,
      outcome: result.outcome === 'written' ? 'acknowledged' : result.outcome,
      ...(result.outcome === 'unknown'
        ? { error: 'Pi page write outcome unknown; do not retry' }
        : {})
    }
  } catch {
    return {
      ok: false,
      status: dispatched ? 502 : 409,
      outcome: dispatched ? 'unknown' : 'rejected',
      error:
        'Pi application scroll unavailable or binding changed; no automatic retry'
    }
  }
}
