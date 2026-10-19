import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { selectedProcessRoots } from './native-process-root.ts'
import { uploadSessionEvidence } from '../image-upload-service.ts'
import { executePing, sendRawSocketRequest } from '../herdr-socket.ts'
import type { ISnapshotResult } from '../types.ts'
import type {
  IConversationRead,
  IConversationTurn
} from '../../src/types/conversation.ts'

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const unavailable = () => new Error('Cursor text replay unavailable')
const rpc = async (method: string, params: Record<string, unknown>) => {
  await executePing({ timeoutMs: 3000 })
  return sendRawSocketRequest(method, params, {
    timeoutMs: 3000,
    maxBytes: 256 * 1024
  })
}
export interface ICursorDeps {
  nativeRpc?: typeof rpc
  processRoots?: typeof selectedProcessRoots
}
export const cursorIdentity = async (
  snapshot: ISnapshotResult,
  paneId: string,
  deps: ICursorDeps = {}
) => {
  const pane = snapshot.panes.find((p) => p.pane_id === paneId)
  if (!pane?.terminal_id) throw unavailable()
  const owners =
    snapshot.agents?.filter(
      (a) => a.target === paneId || a.pane_id === paneId
    ) ?? []
  if (owners.length > 1) throw unavailable()
  const native = deps.nativeRpc ?? rpc
  const agent = (await native('agent.get', { target: paneId })).agent
  const info = (await native('pane.process_info', { pane_id: paneId }))
    .process_info
  for (const record of [pane, ...owners, agent]) {
    if (!record) throw unavailable()
    const row = record as any
    for (const [key, expected] of Object.entries({
      pane_id: paneId,
      target: paneId,
      terminal_id: pane.terminal_id,
      workspace_id: pane.workspace_id,
      tab_id: pane.tab_id,
      agent: 'cursor'
    })) {
      if (row[key] != null && row[key] !== expected) throw unavailable()
    }
  }
  if (
    agent?.pane_id !== paneId ||
    agent.terminal_id !== pane.terminal_id ||
    agent.agent !== 'cursor' ||
    agent.workspace_id !== pane.workspace_id ||
    agent.tab_id !== pane.tab_id
  )
    throw unavailable()
  const sessions = [
    pane.agent_session,
    owners[0]?.agent_session,
    agent.agent_session
  ].map((value) => uploadSessionEvidence(value, 'cursor'))
  const session = sessions[2]
  if (
    !session ||
    session.kind !== 'id' ||
    session.source !== 'herdr:cursor' ||
    session.agent !== 'cursor' ||
    session.value.length > 256
  )
    throw unavailable()
  if (!sessions[0] && !sessions[1]) throw unavailable()
  for (const candidate of sessions) {
    if (!candidate) continue
    for (const key of ['value', 'agent', 'kind', 'source'] as const)
      if (candidate[key] !== undefined && candidate[key] !== session[key])
        throw unavailable()
  }
  const pid = info?.foreground_process_group_id
  if (
    info?.pane_id !== paneId ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !Number.isSafeInteger(info.shell_pid) ||
    info.shell_pid <= 0 ||
    pid === info.shell_pid ||
    !Array.isArray(info.foreground_processes)
  )
    throw unavailable()
  const selected = info.foreground_processes.filter((p: any) => p.pid === pid)
  if (selected.length !== 1) throw unavailable()
  const executable = selected[0].argv?.[0]
  if (
    typeof executable !== 'string' ||
    !isAbsolute(executable) ||
    basename(executable) !== 'cursor-agent'
  )
    throw unavailable()
  const roots = await (deps.processRoots ?? selectedProcessRoots)(pid)
  if (
    roots.pid !== pid ||
    roots.source !== 'kern-procargs2' ||
    !/^\d+:\d+$/.test(roots.start) ||
    !roots.keys.HOME ||
    roots.keys.HOME !== process.env.HOME
  )
    throw unavailable()
  const cwdValue = agent.foreground_cwd ?? agent.cwd
  const snapshotCwd = pane.foreground_cwd ?? pane.cwd
  const processCwd = selected[0].cwd
  if (
    typeof cwdValue !== 'string' ||
    !isAbsolute(cwdValue) ||
    typeof snapshotCwd !== 'string' ||
    !isAbsolute(snapshotCwd) ||
    typeof processCwd !== 'string' ||
    !isAbsolute(processCwd)
  )
    throw unavailable()
  const cwd = await realpath(cwdValue)
  for (const candidate of [
    agent.cwd,
    agent.foreground_cwd,
    pane.cwd,
    pane.foreground_cwd,
    processCwd,
    ...owners.flatMap((owner) => [owner.cwd, owner.foreground_cwd])
  ]) {
    if (candidate == null) continue
    if (
      typeof candidate !== 'string' ||
      !isAbsolute(candidate) ||
      cwd !== (await realpath(candidate))
    )
      throw unavailable()
  }
  const key = hash([
    paneId,
    pane.terminal_id,
    pane.workspace_id,
    pane.tab_id,
    session,
    cwd,
    pid,
    roots.start,
    roots.keys.HOME,
    executable,
    selected[0].argv
  ])
  return {
    key,
    cwd,
    executable,
    sessionId: session.value,
    paneId,
    status: agent.agent_status,
    ready: agent.interactive_ready === true
  }
}

/** Strict bounded NDJSON; invalid UTF-8 is never replacement-decoded. */
export class CursorFrames {
  private pending = Buffer.alloc(0)
  private bytes = 0
  private frames = 0
  accept(bytes: Buffer, receive: (row: any) => void) {
    this.bytes += bytes.length
    if (this.bytes > 8 * 1024 * 1024) throw unavailable()
    this.pending = Buffer.concat([this.pending, bytes])
    for (;;) {
      const end = this.pending.indexOf(10)
      if (end < 0) break
      if (end > 1024 * 1024 || ++this.frames > 16384) throw unavailable()
      const line = this.pending.subarray(0, end)
      this.pending = this.pending.subarray(end + 1)
      const row = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(line)
      )
      if (!row || Array.isArray(row) || row.jsonrpc !== '2.0')
        throw unavailable()
      receive(row)
    }
    if (this.pending.length > 1024 * 1024) throw unavailable()
  }
  resetBudget() {
    this.bytes = 0
    this.frames = 0
  }
}
const ownedHelpers = new Set<ReplayHelper>()
class ReplayHelper {
  private child: ChildProcessWithoutNullStreams
  private frames = new CursorFrames()
  private sequence = 0
  private pending: {
    id: number
    resolve: (value: any) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null
  private turns: IConversationTurn[] | null = null
  private dead = false
  private initialized = false
  private stderrBytes = 0
  private killTimer?: ReturnType<typeof setTimeout>
  get active() {
    return !this.dead
  }
  constructor(private identity: Awaited<ReturnType<typeof cursorIdentity>>) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !/^(HERDR_|ORCA_|AGENT_HALO_|LETTA_|CONVERSATION_ID$|AGENT_ID$)/.test(
            key
          )
      )
    )
    this.child = spawn(identity.executable, ['acp'], {
      cwd: identity.cwd,
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    ownedHelpers.add(this)
    this.child.stdout.on('data', (bytes) => {
      try {
        this.frames.accept(bytes, (row) => this.receive(row))
      } catch {
        this.close()
      }
    })
    this.child.stderr.on('data', (bytes) => {
      this.stderrBytes += bytes.length
      if (this.stderrBytes > 65536) this.close()
    })
    this.child.stdin.on('error', () => this.close())
    this.child.on('error', () => this.close())
    this.child.on('exit', () => this.close())
  }
  close(force = false) {
    if (this.dead && !force) return
    this.dead = true
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.reject(unavailable())
      this.pending = null
    }
    // This PID/group is ours, never the selected TUI group.
    const pid = this.child.pid
    if (force && this.killTimer) clearTimeout(this.killTimer)
    if (pid) {
      try {
        process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM')
      } catch {}
      if (force) {
        ownedHelpers.delete(this)
        return
      }
      // Root exit is not group exit: SDK descendants may ignore SIGTERM.
      this.killTimer = setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {}
        ownedHelpers.delete(this)
      }, 1000)
      this.killTimer.unref()
    } else ownedHelpers.delete(this)
  }
  private send(row: unknown) {
    this.child.stdin.write(JSON.stringify(row) + '\n')
  }
  private receive(row: any) {
    if (typeof row.method === 'string') {
      if (row.id != null) {
        if (!(typeof row.id === 'string' || Number.isSafeInteger(row.id)))
          throw unavailable()
        this.send(
          row.method === 'session/request_permission'
            ? {
                jsonrpc: '2.0',
                id: row.id,
                result: { outcome: { outcome: 'cancelled' } }
              }
            : {
                jsonrpc: '2.0',
                id: row.id,
                error: { code: -32601, message: 'Read-only client' }
              }
        )
      } else if (row.method === 'session/update') {
        if (!this.turns || row.params?.sessionId !== this.identity.sessionId)
          throw unavailable()
        const update = row.params.update
        const role =
          update?.sessionUpdate === 'user_message_chunk'
            ? 'user'
            : update?.sessionUpdate === 'agent_message_chunk'
              ? 'assistant'
              : null
        if (!role || update.content?.type !== 'text') return // Unknown/native non-text chunks are not fabricated tools.
        if (typeof update.content.text !== 'string') throw unavailable()
        const last = this.turns.at(-1)
        if (last?.role === role)
          (last.parts[0] as { kind: 'text'; text: string }).text +=
            update.content.text
        else
          this.turns.push({
            id: '',
            role,
            ts: null,
            parts: [{ kind: 'text', text: update.content.text }]
          })
      }
      return
    }
    const pending = this.pending
    if (
      !pending ||
      row.id !== pending.id ||
      Object.hasOwn(row, 'result') === Object.hasOwn(row, 'error')
    )
      throw unavailable()
    clearTimeout(pending.timer)
    this.pending = null
    if (Object.hasOwn(row, 'error')) pending.reject(unavailable())
    else if (
      !row.result ||
      typeof row.result !== 'object' ||
      Array.isArray(row.result)
    )
      pending.reject(unavailable())
    else pending.resolve(row.result)
  }
  private call(method: 'initialize' | 'session/load', params: unknown) {
    if (this.dead || this.pending) return Promise.reject(unavailable())
    this.frames.resetBudget()
    this.stderrBytes = 0
    return new Promise<any>((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => this.close(), 12000)
      this.pending = { id, resolve, reject, timer }
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }
  async read() {
    if (!this.initialized) {
      const init = await this.call('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false
        }
      })
      if (
        init?.protocolVersion !== 1 ||
        init.agentCapabilities?.loadSession !== true
      )
        throw unavailable()
      this.initialized = true
    }
    this.turns = []
    await this.call('session/load', {
      sessionId: this.identity.sessionId,
      cwd: this.identity.cwd,
      mcpServers: []
    })
    if (!this.active) throw unavailable()
    const turns = this.turns.map((turn, index) => ({
      ...turn,
      id: `replay-derived-${hash([index, turn.role, turn.parts])}`
    }))
    this.turns = null
    return turns
  }
}
interface IEntry {
  helper: ReplayHelper
  paneId: string
  promise?: Promise<IConversationTurn[]>
  turns?: IConversationTurn[]
  at: number
  timer?: ReturnType<typeof setTimeout>
}
const pool = new Map<string, IEntry>()
const failures = new Map<string, number>()
export const rememberCursorFailure = (
  cache: Map<string, number>,
  key: string,
  at = Date.now()
) => {
  cache.delete(key)
  while (cache.size >= 32) cache.delete(cache.keys().next().value!)
  cache.set(key, at)
}
const retire = (key: string) => {
  const entry = pool.get(key)
  if (!entry) return
  clearTimeout(entry.timer)
  entry.helper.close()
  pool.delete(key)
}
export const closeCursorReplayHelpers = (force = false) => {
  for (const key of pool.keys()) retire(key)
  if (force) for (const helper of ownedHelpers) helper.close(true)
}
process.once('exit', () => closeCursorReplayHelpers(true))
export const readCursorReplay = async (
  snapshot: ISnapshotResult,
  paneId: string,
  fetchSnapshot: () => Promise<ISnapshotResult>,
  deps: ICursorDeps = {}
): Promise<IConversationRead> => {
  let identity: Awaited<ReturnType<typeof cursorIdentity>>
  try {
    identity = await cursorIdentity(snapshot, paneId, deps)
  } catch {
    for (const [key, entry] of pool) if (entry.paneId === paneId) retire(key)
    throw unavailable()
  }
  for (const [key, entry] of pool)
    if (entry.paneId === paneId && key !== identity.key) retire(key)
  for (const [key, at] of failures)
    if (Date.now() - at > 10000) failures.delete(key)
  if (failures.has(identity.key)) throw unavailable()
  let entry = pool.get(identity.key)
  if (entry && !entry.helper.active) {
    retire(identity.key)
    rememberCursorFailure(failures, identity.key)
    throw unavailable()
  }
  if (!entry) {
    if (pool.size >= 2) throw unavailable()
    entry = { helper: new ReplayHelper(identity), paneId, at: 0 }
    pool.set(identity.key, entry)
  }
  clearTimeout(entry.timer)
  try {
    if (!entry.turns || Date.now() - entry.at > 1500) {
      entry.promise ??= entry.helper
        .read()
        .then((turns) => {
          entry!.turns = turns
          entry!.at = Date.now()
          return turns
        })
        .finally(() => {
          entry!.promise = undefined
        })
      await entry.promise
    }
    const after = await cursorIdentity(await fetchSnapshot(), paneId, deps)
    if (!entry.helper.active || after.key !== identity.key) throw unavailable()
    return {
      ok: true,
      paneId,
      source: 'cursor-acp-replay',
      sessionKey: identity.key,
      turns: structuredClone(entry.turns!),
      metadata: { model: null, reasoning_effort: null },
      truncated: false,
      before: null
    }
  } catch {
    retire(identity.key)
    rememberCursorFailure(failures, identity.key)
    throw unavailable()
  } finally {
    if (pool.get(identity.key) === entry) {
      clearTimeout(entry.timer)
      entry.timer = setTimeout(() => retire(identity.key), 30000)
      entry.timer.unref()
    }
  }
}
