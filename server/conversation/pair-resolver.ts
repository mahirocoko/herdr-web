// MIT License - Copyright (c) 2026 devswha
// Adapted native identity/store selection from codex.ts and claude-store.ts.
// No recency/cwd guessing, credential reads, or arbitrary browser-selected paths.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { executePing, sendRawSocketRequest } from '../herdr-socket.ts'
import {
  selectedProcessRoots,
  selectedCodexRolloutFiles,
  type IProcessRoots
} from './native-process-root.ts'
import type { PairSource } from './pair-parser.ts'
import { isProviderProcess } from './provider-process.ts'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export interface IPairResolverDeps {
  codexRoot?: string
  claudeRoot?: string
  nativeRpc?: (method: string, params: Record<string, unknown>) => Promise<any>
  processRoots?: typeof selectedProcessRoots
  rolloutFiles?: typeof selectedCodexRolloutFiles
}
export interface IPairResolution {
  root: string
  file: string
  session: string
  source: PairSource
  signature: string
  validate: () => Promise<void>
}
const unknown = () => new Error('Exact native session authority unavailable')
const nativeRpc = async (method: string, params: Record<string, unknown>) => {
  await executePing({ timeoutMs: 5000 })
  return sendRawSocketRequest(method, params, {
    timeoutMs: 5000,
    maxBytes: 256 * 1024
  })
}
const matches = isProviderProcess
export const isUserCodexHeader = (row: any) =>
  row?.type === 'session_meta' &&
  UUID.test(row.payload?.id) &&
  (!row.payload.source || typeof row.payload.source === 'string') &&
  row.payload.source !== 'subagent' &&
  (!row.payload.thread_source || row.payload.thread_source === 'user') &&
  !row.payload.agent_role
const enumerate = (root: string, tree: string, depth: number) => {
  const result: string[] = []
  let count = 0
  const walk = (dir: string, left: number) => {
    const stat = fs.lstatSync(dir)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw unknown()
    const handle = fs.opendirSync(dir)
    try {
      for (;;) {
        const entry = handle.readSync()
        if (!entry) break
        if (++count > 32768) throw unknown()
        const file = path.join(dir, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory() && left > 0) walk(file, left - 1)
        else if (entry.isFile() && entry.name.endsWith('.jsonl'))
          result.push(file)
      }
    } finally {
      handle.closeSync()
    }
  }
  if (fs.existsSync(path.join(root, tree))) walk(path.join(root, tree), depth)
  return result
}
export const codexHistoryCandidates = (root: string, id: string) => {
  if (!UUID.test(id)) throw unknown()
  return enumerate(root, 'sessions', 3).filter(
    (file) =>
      path.basename(file).endsWith(`-${id}.jsonl`) ||
      path.basename(file).includes(`-${id}_`)
  )
}

/** Only filename enumeration; caller fences every selected descriptor and head read. */
export const resolvePair = async (
  paneId: string,
  provider: 'codex' | 'claude',
  reported: string | undefined,
  deps: IPairResolverDeps,
  head: (file: string, root: string) => any,
  metadata: (file: string, root: string) => any
): Promise<IPairResolution> => {
  const rpc = deps.nativeRpc ?? nativeRpc
  const agentInfo = await rpc('agent.get', { target: paneId })
  const agent = agentInfo.agent
  if (agent?.pane_id !== paneId || agent.agent !== provider) throw unknown()
  const processInfo = await rpc('pane.process_info', { pane_id: paneId })
  if (processInfo.process_info?.pane_id !== paneId) throw unknown()
  const processes = (
    processInfo.process_info.foreground_processes ?? []
  ).filter((p: any) => matches(p, provider))
  if (
    !processes.length ||
    processes.length > 16 ||
    (provider === 'claude' && processes.length !== 1)
  )
    throw unknown()
  const process = processes[0]
  const signature = JSON.stringify(process)
  const configured = provider === 'codex' ? deps.codexRoot : deps.claudeRoot
  const evidence: IProcessRoots = await (
    deps.processRoots ?? selectedProcessRoots
  )(process.pid)
  if (evidence.pid !== process.pid || !/^\d+:\d+$/.test(evidence.start))
    throw unknown()
  const root =
    configured ??
    (provider === 'codex'
      ? evidence?.keys.CODEX_HOME
      : evidence?.keys.CLAUDE_CONFIG_DIR) ??
    (evidence?.keys.HOME
      ? path.join(
          evidence.keys.HOME,
          provider === 'codex' ? '.codex' : '.claude'
        )
      : undefined)
  if (!root || !path.isAbsolute(root)) throw unknown()
  const native = agent.agent_session
  let session =
    typeof (native?.value ?? native?.id) === 'string'
      ? (native.value ?? native.id)
      : reported
  const exactPath =
    native?.kind === 'path' && typeof native.value === 'string'
      ? native.value
      : null
  if (
    provider === 'claude' &&
    (!session || !UUID.test(session)) &&
    !exactPath &&
    evidence
  ) {
    const pidRecord = metadata(
      path.join(root, 'sessions', `${process.pid}.json`),
      root
    )
    const seconds = Number(evidence.start.split(':')[0])
    const date = new Date(seconds * 1000)
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ]
    const expected = `${weekdays[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${date.getUTCDate()} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')} ${date.getUTCFullYear()}`
    if (
      pidRecord.pid !== process.pid ||
      pidRecord.kind !== 'interactive' ||
      typeof pidRecord.procStart !== 'string' ||
      pidRecord.procStart.replace(/\s+/g, ' ').trim() !== expected ||
      !UUID.test(pidRecord.sessionId)
    )
      throw unknown()
    session = pidRecord.sessionId
  }
  const fdProofs: { pid: number; roots: IProcessRoots; files: string[] }[] = []
  const readRollouts = deps.rolloutFiles ?? selectedCodexRolloutFiles
  let fdPath: string | undefined
  if (provider === 'codex' && !exactPath) {
    if (deps.nativeRpc && deps.processRoots && !deps.rolloutFiles)
      throw unknown()
    const open = new Set<string>()
    for (const candidate of processes) {
      const roots =
        candidate.pid === process.pid
          ? evidence
          : await (deps.processRoots ?? selectedProcessRoots)(candidate.pid)
      if (roots.pid !== candidate.pid || !/^\d+:\d+$/.test(roots.start))
        throw unknown()
      const candidateRoot =
        configured ??
        roots.keys.CODEX_HOME ??
        (roots.keys.HOME ? path.join(roots.keys.HOME, '.codex') : undefined)
      if (candidateRoot !== root) throw unknown()
      const files = (
        await readRollouts(candidate.pid, root, roots.start)
      ).sort()
      if (files.length > 64) throw unknown()
      fdProofs.push({ pid: candidate.pid, roots, files })
      for (const candidateFile of files)
        if (isUserCodexHeader(head(candidateFile, root)))
          open.add(candidateFile)
    }
    if (open.size > 1) throw unknown()
    if (open.size === 1) fdPath = [...open][0]
    if (!fdPath && processes.length > 1) throw unknown()
  }
  // A bare `resume UUID` argument survives /new in the same process. It is not
  // current-session proof by itself: require native path/FD/agent.get evidence.
  let file: string
  const selectedPath = exactPath ?? fdPath
  if (selectedPath) {
    if (!path.isAbsolute(selectedPath) || !selectedPath.endsWith('.jsonl'))
      throw unknown()
    const relative = path.relative(
      path.join(root, provider === 'codex' ? 'sessions' : 'projects'),
      selectedPath
    )
    if (
      !relative ||
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      (provider === 'claude' && relative.split(path.sep).length !== 2)
    )
      throw unknown()
    file = selectedPath
    if (provider === 'codex') {
      const row = head(file, root)
      if (!isUserCodexHeader(row)) throw unknown()
      session = row.payload.id
    } else {
      session = path.basename(file, '.jsonl')
      if (!UUID.test(session)) throw unknown()
    }
  } else {
    if (!session || !UUID.test(session)) throw unknown()
    const candidates = enumerate(
      root,
      provider === 'claude' ? 'projects' : 'sessions',
      provider === 'claude' ? 1 : 3
    ).filter((candidate) =>
      provider === 'claude'
        ? path.basename(candidate) === `${session}.jsonl`
        : path.basename(candidate).includes(`-${session}`)
    )
    const hits = candidates.filter(
      (candidate) =>
        provider === 'claude' ||
        (isUserCodexHeader(head(candidate, root)) &&
          head(candidate, root).payload?.id === session)
    )
    if (hits.length !== 1) throw unknown()
    file = hits[0]
  }
  if (!fdPath && reported && UUID.test(reported) && reported !== session)
    throw unknown()
  const validate = async () => {
    const current = await rpc('pane.process_info', { pane_id: paneId })
    const currentAgent = await rpc('agent.get', { target: paneId })
    if (
      current.process_info?.pane_id !== paneId ||
      JSON.stringify(
        (current.process_info.foreground_processes ?? []).filter((p: any) =>
          matches(p, provider)
        )
      ) !== JSON.stringify(processes) ||
      JSON.stringify(currentAgent.agent) !== JSON.stringify(agent)
    )
      throw unknown()
    for (const proof of fdProofs) {
      const currentRoots = await (deps.processRoots ?? selectedProcessRoots)(
        proof.pid
      )
      if (
        JSON.stringify(currentRoots) !== JSON.stringify(proof.roots) ||
        JSON.stringify(
          (await readRollouts(proof.pid, root, proof.roots.start)).sort()
        ) !== JSON.stringify(proof.files)
      )
        throw unknown()
    }
    if (evidence) {
      const post = await (deps.processRoots ?? selectedProcessRoots)(
        process.pid
      )
      if (JSON.stringify(post) !== JSON.stringify(evidence)) throw unknown()
    }
  }
  return {
    root,
    file,
    session,
    source: `${provider}-transcript`,
    signature: JSON.stringify({
      process: signature,
      start: evidence?.start,
      native,
      fdProofs: fdProofs.map((proof) => ({
        pid: proof.pid,
        start: proof.roots.start,
        files: proof.files
      }))
    }),
    validate
  }
}
