// MIT License - Copyright (c) 2026 devswha
// Exact-only adaptation of omo.ts, pi.ts, gjc-runtime.ts and conversation.ts (5979118).
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { executePing, sendRawSocketRequest } from '../herdr-socket.ts'
import {
  selectedProcessRoots,
  selectedFamilySessionFiles
} from './native-process-root.ts'
import { familyContributions } from './pi-family-parser.ts'
import type { IPane } from '../types.ts'
import type { IPairResolverDeps } from './pair-resolver.ts'
import type { FamilySource } from './pi-family-parser.ts'
export type FamilyProvider = 'omp' | 'omo' | 'gjc' | 'pi'
export interface IFamilyDeps extends IPairResolverDeps {
  familyRoots?: Partial<Record<FamilyProvider, string>>
  familyFiles?: typeof selectedFamilySessionFiles
  familyScreen?: (paneId: string) => Promise<string>
}
export interface IFamilyResolution {
  root: string
  file: string
  session: string
  source: FamilySource
  signature: string
  pending?: boolean
  validate: () => Promise<void>
}
const prospective = (file: string, root: string) => {
  const relative = path.relative(root, file)
  if (
    !relative ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !file.endsWith('.jsonl')
  )
    throw unavailable()
  let current = path.resolve(root),
    missing = false
  if (
    !fs.lstatSync(current).isDirectory() ||
    fs.lstatSync(current).isSymbolicLink()
  )
    throw unavailable()
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    try {
      const stat = fs.lstatSync(current)
      if (
        missing ||
        stat.isSymbolicLink() ||
        (!stat.isDirectory() && current !== file)
      )
        throw unavailable()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      missing = true
    }
  }
  return missing
}
// Exact source status-line framing; a title quoted in assistant prose is not status.
export const gjcStatusTitle = (screen: string): string | null | undefined => {
  const lines = screen.split(/\r?\n/)
  let at = lines.length - 1
  while (at >= 0 && !lines[at].trim()) at--
  if (at < 0 || !/^\s*\u2570\u2500/.test(lines[at])) return undefined
  at--
  while (at >= 0 && /^\s*\u2502/.test(lines[at])) at--
  if (at < 1 || !/^\s*\u256d\u2500/.test(lines[at])) return undefined
  const status = lines[at - 1]
  if (!/^\s*\u2b22\s/.test(status) || !status.includes('\u{1F4C1}'))
    return undefined
  const version = status.match(/\s\/\s+v\d+\.\d+\.\d+\s*$/),
    rules = [...status.matchAll(/\u2500{3,}\s/g)],
    rule = rules[0]
  if (
    !version ||
    rules.length !== 1 ||
    !rule ||
    rule.index! + rule[0].length > version.index!
  )
    return undefined
  const parts = status
    .slice(rule.index! + rule[0].length, version.index)
    .split(' / ')
    .map((part) => part.trim())
  if (/^(?:\$[\d.]+\s+)?\(sub\)$|^\$[\d.]+$/.test(parts.at(-1) ?? ''))
    parts.pop()
  if (/^\u2934\s*[\d.]+\/s$/u.test(parts.at(-1) ?? '')) parts.pop()
  const title = parts.join(' / ').trim()
  return !title ? null : title.endsWith('\u2026') ? undefined : title
}
const enumerateSessions = (root: string) => {
  const result: string[] = []
  const dirs = fs.readdirSync(root, { withFileTypes: true })
  if (dirs.length > 512) throw unavailable()
  let count = 0
  for (const dir of dirs)
    if (dir.isDirectory() && !dir.isSymbolicLink()) {
      const entries = fs.readdirSync(path.join(root, dir.name), {
        withFileTypes: true
      })
      count += entries.length
      if (count > 4096) throw unavailable()
      for (const entry of entries)
        if (entry.isFile() && entry.name.endsWith('.jsonl'))
          result.push(path.join(root, dir.name, entry.name))
    }
  if (result.length > 64) throw unavailable()
  return result
}
const unavailable = () =>
  new Error('Exact native pi-family session authority unavailable')
export const familyProcess = (entry: any): FamilyProvider | null => {
  const argv: string[] = entry.argv ?? [entry.argv0 ?? entry.name ?? '']
  const runtime = /(?:^|[\\/])(?:node|bun)(?:\.exe)?$/.test(argv[0] ?? '')
  let at = runtime ? 1 : 0
  if (runtime) {
    for (; argv[at]?.startsWith('--'); at++)
      if (!['--no-warnings', '--experimental-strip-types'].includes(argv[at]))
        return null
  }
  const program = (argv[at] ?? '').replaceAll('\\', '/')
  const direct = /(?:^|\/)(omp|omo|gjc|pi)(?:\.[cm]?js|\.exe)?$/.exec(program)
  if (direct) return direct[1] as FamilyProvider
  if (/\/omo-ai\//.test(program)) return 'omo'
  if (
    runtime &&
    /\/@code-yeongyu\/senpi\/dist\/(?:bundle\/)?cli\.js$/.test(program)
  ) {
    const end = argv.indexOf('--', at),
      options = end < 0 ? argv : argv.slice(0, end)
    if (
      options.some(
        (word, index) =>
          options[index - 1] === '--extension' &&
          /\/omo-ai\/plugin\/?$/.test(word)
      )
    )
      return 'omo'
  }
  return null
}
const rpcDefault = async (method: string, params: Record<string, unknown>) => {
  await executePing({ timeoutMs: 5000 })
  return sendRawSocketRequest(method, params, {
    timeoutMs: 5000,
    maxBytes: 256 * 1024
  })
}
export const resolveFamily = async (
  paneId: string,
  cwd: string,
  reported: string | undefined,
  deps: IFamilyDeps,
  head: (file: string, root: string) => any,
  metadata: (file: string, root: string) => any,
  marker: (file: string, root: string) => { text: string; mtime: number },
  peers: IPane[] = [],
  witness?: (
    file: string,
    root: string
  ) => { title: string | null; text: string },
  inspectPeers = true
): Promise<IFamilyResolution | null> => {
  const rpc = deps.nativeRpc ?? rpcDefault
  const info = await rpc('pane.process_info', { pane_id: paneId })
  if (info.process_info?.pane_id !== paneId) throw unavailable()
  const processes = (info.process_info.foreground_processes ?? []).filter(
    (entry: any) => familyProcess(entry)
  )
  if (!processes.length) return null
  if (
    processes.length > 16 ||
    new Set(processes.map((entry: any) => familyProcess(entry))).size !== 1
  )
    throw unavailable()
  const process = processes[0],
    provider = familyProcess(process)!
  const roots = await (
    deps.processRoots ?? ((pid: number) => selectedProcessRoots(pid, true))
  )(process.pid)
  if (roots.pid !== process.pid || !/^\d+:\d+$/.test(roots.start))
    throw unavailable()
  const keys = roots.keys as Record<string, string | null>
  const home = keys.HOME
  if (!home) throw unavailable()
  const expand = (value: string) =>
    path.isAbsolute(value)
      ? path.resolve(value)
      : value === '~'
        ? home
        : value.startsWith('~/')
          ? path.join(home, value.slice(2))
          : path.resolve(home, value)
  const agentDir =
    provider === 'omo'
      ? (keys.OMO_CODING_AGENT_DIR ??
        keys.SENPI_CODING_AGENT_DIR ??
        keys.PI_CODING_AGENT_DIR ??
        path.join(home, '.omo', 'agent'))
      : provider === 'pi'
        ? (keys.PI_CODING_AGENT_DIR ?? path.join(home, '.pi', 'agent'))
        : path.join(home, `.${provider}`, 'agent')
  const root = expand(
    deps.familyRoots?.[provider] ??
      (provider === 'pi' ? keys.PI_CODING_AGENT_SESSION_DIR : null) ??
      path.join(expand(agentDir), 'sessions')
  )
  if (!path.isAbsolute(root)) throw unavailable()
  const agentInfo = await rpc('agent.get', { target: paneId }),
    agent = agentInfo.agent
  if (agent?.pane_id !== paneId) throw unavailable()
  let file =
    provider !== 'gjc' &&
    agent.agent_session?.kind === 'path' &&
    (provider !== 'omo' || agent.agent_session.agent === 'omo')
      ? agent.agent_session.value
      : undefined
  let pending = false
  const getFiles =
    deps.familyFiles ??
    (deps.nativeRpc && deps.processRoots
      ? async () => []
      : selectedFamilySessionFiles)
  const proofs = [
    {
      process,
      roots,
      files: (await getFiles(process.pid, root, roots.start)).sort()
    }
  ]
  for (const other of processes.slice(1)) {
    const evidence = await (
      deps.processRoots ?? ((pid: number) => selectedProcessRoots(pid, true))
    )(other.pid)
    if (evidence.pid !== other.pid || !/^\d+:\d+$/.test(evidence.start))
      throw unavailable()
    if (
      !deps.familyRoots?.[provider] &&
      (evidence.keys.HOME !== roots.keys.HOME ||
        [
          'PI_CODING_AGENT_DIR',
          'PI_CODING_AGENT_SESSION_DIR',
          'OMO_CODING_AGENT_DIR',
          'SENPI_CODING_AGENT_DIR'
        ].some((key) => (evidence.keys as any)[key] !== keys[key]))
    )
      throw unavailable()
    proofs.push({
      process: other,
      roots: evidence,
      files: (await getFiles(other.pid, root, evidence.start)).sort()
    })
  }
  const descriptors = [
    ...new Set(proofs.flatMap((proof) => proof.files))
  ].sort()
  const parentFile = (candidate: string) => {
    const parts = path.relative(root, candidate).split(path.sep)
    if (
      !parts.length ||
      parts[0] === '..' ||
      path.isAbsolute(path.relative(root, candidate))
    )
      throw unavailable()
    if (provider === 'gjc' && parts.length !== 2 && parts.length !== 3)
      throw unavailable()
    return provider === 'gjc' && parts.length === 3
      ? path.join(root, parts[0], `${parts[1]}.jsonl`)
      : candidate
  }
  const fdFiles = [...new Set(descriptors.map(parentFile))]
  if (fdFiles.length > 1) throw unavailable()
  if (fdFiles.length === 1) file = fdFiles[0]
  let heldSession: string | undefined
  if (provider === 'omo') {
    const slug = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
    const dir = path.join(root, slug),
      holderDir = path.join(dir, 'session-holders')
    const ids: string[] = []
    if (fs.existsSync(holderDir)) {
      const entries = fs.readdirSync(holderDir, { withFileTypes: true })
      if (entries.length > 4096) throw unavailable()
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        for (const proof of proofs) {
          const holder = path.join(
            holderDir,
            entry.name,
            `${proof.process.pid}.json`
          )
          if (!fs.existsSync(holder)) continue
          const record = metadata(holder, root)
          const started =
            Number(proof.roots.start.split(':')[0]) * 1000 +
            Number(proof.roots.start.split(':')[1]) / 1000
          if (
            record.pid === proof.process.pid &&
            typeof record.processStartedAtMs === 'number' &&
            Math.abs(record.processStartedAtMs - started) <= 3000
          ) {
            const id = decodeURIComponent(entry.name)
            if (!ids.includes(id)) ids.push(id)
          }
        }
      }
    }
    if (ids.length > 1) throw unavailable()
    if (ids.length === 1) {
      heldSession = ids[0]
      const names = fs.readdirSync(dir, { withFileTypes: true })
      if (names.length > 4096) throw unavailable()
      const hits = names.filter(
        (entry) =>
          entry.isFile() &&
          (entry.name === `${ids[0]}.jsonl` ||
            entry.name.endsWith(`_${ids[0]}.jsonl`))
      )
      if (hits.length > 1) throw unavailable()
      file = path.join(dir, hits.length ? hits[0].name : `${ids[0]}.jsonl`)
      pending = hits.length === 0
    }
  }
  if (provider === 'omo' && !file) {
    const ids = new Set<string>()
    if (
      agent.agent_session?.agent === 'omo' &&
      agent.agent_session.kind === 'id' &&
      typeof agent.agent_session.value === 'string'
    )
      ids.add(agent.agent_session.value)
    for (const item of processes) {
      const args: string[] = item.argv ?? [],
        end = args.indexOf('--'),
        options = end < 0 ? args : args.slice(0, end)
      for (let at = 0; at < options.length; at++) {
        const id = options[at].startsWith('--session-id=')
          ? options[at].slice(13)
          : options[at] === '--session-id'
            ? options[at + 1]
            : undefined
        if (id && /^[A-Za-z0-9_-]{8,128}$/.test(id)) ids.add(id)
      }
    }
    if (ids.size) {
      const candidates = enumerateSessions(root)
        .map((candidate) => ({
          file: candidate,
          header: head(candidate, root)
        }))
        .filter(
          (candidate) =>
            candidate.header?.type === 'session' && candidate.header.cwd === cwd
        )
      const matches = candidates.filter((candidate) =>
        ids.has(candidate.header.id)
      )
      const started = Math.min(
        ...proofs.map((proof) => Number(proof.roots.start.split(':')[0]) * 1000)
      )
      if (
        matches.length !== 1 ||
        candidates.some(
          (candidate) =>
            candidate.file !== matches[0].file &&
            Number.isFinite(Date.parse(candidate.header.timestamp)) &&
            Date.parse(candidate.header.timestamp) > started + 1000 &&
            Date.parse(candidate.header.timestamp) <= Date.now() + 1000
        )
      )
        throw unavailable()
      file = matches[0].file
    }
  }
  if (provider === 'gjc' && !file) {
    const breadcrumbs = new Set<string>()
    for (const proof of proofs)
      try {
        const tty = execFileSync(
          '/bin/ps',
          ['-p', String(proof.process.pid), '-o', 'tty='],
          {
            encoding: 'utf8',
            timeout: 1500,
            maxBuffer: 4096,
            env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
            stdio: ['ignore', 'pipe', 'ignore']
          }
        ).trim()
        if (!/^ttys\d+$/.test(tty)) throw unavailable()
        const breadcrumb = marker(
          path.join(home, '.gjc', 'agent', 'terminal-sessions', tty),
          path.join(home, '.gjc', 'agent')
        )
        const [savedCwd, savedPath] = breadcrumb.text.split('\n')
        if (
          savedCwd !== cwd ||
          breadcrumb.mtime <
            Number(proof.roots.start.split(':')[0]) * 1000 - 1000
        )
          throw unavailable()
        breadcrumbs.add(parentFile(savedPath))
      } catch {
        /* An unreadable/stale marker is not session evidence. */
      }
    if (breadcrumbs.size > 1) throw unavailable()
    if (breadcrumbs.size === 1) file = [...breadcrumbs][0]
    if (!file) {
      if (!witness) throw unavailable()
      const screen = deps.familyScreen
        ? await deps.familyScreen(paneId)
        : await rpc('pane.read', {
            pane_id: paneId,
            source: 'visible',
            lines: 1000,
            format: 'text',
            strip_ansi: true
          }).then((value) => value.read?.text ?? value.text ?? '')
      const title = gjcStatusTitle(screen)
      const candidates = enumerateSessions(root)
        .filter((candidate) => {
          const header = head(candidate, root)
          return header?.type === 'session' && header.cwd === cwd
        })
        .map((candidate) => ({ file: candidate, ...witness(candidate, root) }))
      const titled =
        typeof title === 'string'
          ? candidates.filter((candidate) => candidate.title === title)
          : title === null
            ? candidates.filter((candidate) => candidate.title === null)
            : candidates
      const among =
        typeof title === 'string' && !titled.length
          ? candidates.filter((candidate) => candidate.title === null)
          : titled
      const normalize = (value: string) =>
        value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '')
      const visible = normalize(screen)
      const hits = among.filter((candidate) =>
        candidate.text
          .split('\n')
          .flatMap((line, index) => {
            try {
              return familyContributions(line, index)
            } catch {
              return []
            }
          })
          .filter((row) => row.role === 'assistant')
          .slice(-8)
          .some((row) =>
            row.parts.some(
              (part) =>
                part.kind === 'text' &&
                normalize(part.text).slice(-160).length >= 64 &&
                visible.includes(normalize(part.text).slice(-160))
            )
          )
      )
      if (hits.length !== 1) throw unavailable()
      file = hits[0].file
    }
  }
  if (
    typeof file !== 'string' ||
    !path.isAbsolute(file) ||
    !file.endsWith('.jsonl')
  )
    throw unavailable()
  if (provider === 'gjc') file = parentFile(file)
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw unavailable()
  let header: any
  try {
    header = head(file, root)
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
      provider === 'gjc' ||
      !(provider === 'omp' || provider === 'pi' || heldSession)
    )
      throw error
    pending = prospective(file, root)
    if (!pending) throw unavailable()
  }
  const session = pending
    ? (heldSession ?? path.basename(file, '.jsonl'))
    : header?.id
  if (
    !pending &&
    (header?.type !== 'session' ||
      typeof header.id !== 'string' ||
      !header.id ||
      (heldSession !== undefined && header.id !== heldSession) ||
      header.cwd !== cwd)
  )
    throw unavailable()
  if (
    (provider === 'omp' || provider === 'pi') &&
    reported &&
    reported !== file
  )
    throw unavailable()
  if (inspectPeers && provider === 'omo')
    for (const peer of peers.filter(
      (peer) =>
        peer.pane_id !== paneId && (peer.foreground_cwd || peer.cwd) === cwd
    )) {
      const peerInfo = await rpc('pane.process_info', { pane_id: peer.pane_id })
      if (peerInfo.process_info?.pane_id !== peer.pane_id) throw unavailable()
      if (
        (peerInfo.process_info.foreground_processes ?? []).some(
          (process: any) => familyProcess(process) === 'omo'
        )
      ) {
        const other = await resolveFamily(
          peer.pane_id,
          cwd,
          peer.agent_session?.value,
          deps,
          head,
          metadata,
          marker,
          [],
          witness,
          false
        )
        if (
          !other ||
          other.file === file ||
          (pending && other.pending && other.session === session)
        )
          throw unavailable()
      }
    }
  return {
    root,
    file,
    pending,
    session,
    source: `${provider}-transcript` as FamilySource,
    signature: JSON.stringify({ proofs, agent, pending, descriptors }),
    validate: async () => {
      const post = await rpc('pane.process_info', { pane_id: paneId }),
        postAgent = await rpc('agent.get', { target: paneId })
      const postRoots = await (
        deps.processRoots ?? ((pid: number) => selectedProcessRoots(pid, true))
      )(process.pid)
      if (
        JSON.stringify(post) !== JSON.stringify(info) ||
        JSON.stringify(postAgent) !== JSON.stringify(agentInfo) ||
        JSON.stringify(postRoots) !== JSON.stringify(roots)
      )
        throw unavailable()
      for (const proof of proofs) {
        const currentRoots = await (
          deps.processRoots ??
          ((pid: number) => selectedProcessRoots(pid, true))
        )(proof.process.pid)
        if (
          JSON.stringify(currentRoots) !== JSON.stringify(proof.roots) ||
          JSON.stringify(
            (await getFiles(proof.process.pid, root, proof.roots.start)).sort()
          ) !== JSON.stringify(proof.files)
        )
          throw unavailable()
      }
      if (pending) prospective(file, root)
      if (provider === 'omo' || provider === 'gjc') {
        // Holder/breadcrumb changes do not necessarily change agent.get. Resolve
        // the exact current native witness again through the caller's fenced reads.
        const current = await resolveFamily(
          paneId,
          cwd,
          reported,
          deps,
          head,
          metadata,
          marker,
          peers,
          witness,
          inspectPeers
        )
        if (
          !current ||
          current.file !== file ||
          current.session !== session ||
          current.pending !== pending ||
          current.source !== `${provider}-transcript`
        )
          throw unavailable()
      }
    }
  }
}
