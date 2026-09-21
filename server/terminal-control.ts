import { PANE_ID_REGEX, isAgentPane, type IValidationResult } from './security.ts'
import { getHerdrSnapshot } from './herdr-adapter.ts'
import { sendRawSocketRequest, HerdrSocketError } from './herdr-socket.ts'
import { getSharedOperationCoordinator } from './operation-coordinator.ts'
import type { ISnapshotResult, IPane, ITerminalFrame, ITerminalClosed } from './types.ts'

export const MIN_CONTROL_COLS = 40
export const MAX_CONTROL_COLS = 240
export const MIN_CONTROL_ROWS = 12
export const MAX_CONTROL_ROWS = 80
export const DEFAULT_CONTROL_COLS = 80
export const DEFAULT_CONTROL_ROWS = 24

export const MAX_LEASE_DURATION_MS = 10 * 60 * 1000 // 10 minutes absolute max
export const RELEASE_GRACE_TIMEOUT_MS = 1000 // 1s grace period for child release
export const MAX_WS_CONTROL_MESSAGE_BYTES = 8192
export const MAX_INPUT_TEXT_UTF8_BYTES = 4096
export const MAX_STDOUT_LINE_BYTES = 1024 * 1024 // 1 MiB max per stdout line

export interface ITerminalControlGeometry {
  cols: number
  rows: number
}

export type IControlClientMessage =
  | { type: 'terminal.input'; text: string }
  | { type: 'terminal.resize'; cols: number; rows: number }
  | { type: 'terminal.release' }

export type IControlServerEnvelope =
  | { type: 'control.ready'; pane: string; leaseDurationMs: number }
  | { type: 'control.error'; error: string }
  | { type: 'terminal.frame'; encoding: string; full: boolean; bytes: string; note?: string }
  | { type: 'terminal.closed'; reason: string }

export interface IPaneProcessInfoProcess {
  pid?: number | null
  cmdline?: string | null
  argv?: string[] | null
  argv0?: string | null
  cwd?: string | null
}

export interface IPaneProcessInfo {
  pane_id: string
  shell_pid?: number | null
  foreground_process_group_id?: number | null
  foreground_processes?: IPaneProcessInfoProcess[] | null
  tty?: string | null
}

export type IControlPreflightResult =
  | { ok: true; paneId: string; shellPid: number; pgid: number }
  | { ok: false; status: number; code: string; error: string }

export const buildTerminalControlArgv = (paneId: string, cols: number, rows: number): string[] => {
  if (!PANE_ID_REGEX.test(paneId)) {
    throw new Error(`Invalid paneId for terminal control argv: "${paneId}"`)
  }
  if (typeof cols !== 'number' || !Number.isInteger(cols) || cols < MIN_CONTROL_COLS || cols > MAX_CONTROL_COLS) {
    throw new Error(`Invalid cols for terminal control: ${cols} (must be integer between ${MIN_CONTROL_COLS} and ${MAX_CONTROL_COLS})`)
  }
  if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < MIN_CONTROL_ROWS || rows > MAX_CONTROL_ROWS) {
    throw new Error(`Invalid rows for terminal control: ${rows} (must be integer between ${MIN_CONTROL_ROWS} and ${MAX_CONTROL_ROWS})`)
  }

  return [
    'herdr',
    'terminal',
    'session',
    'control',
    paneId,
    '--cols',
    String(cols),
    '--rows',
    String(rows)
  ]
}

export const isStrictDecimalInteger = (val: string): boolean => {
  return /^[1-9][0-9]*$/.test(val)
}

export const validateTerminalControlParams = (
  url: URL
): IValidationResult<{ pane: string; cols: number; rows: number }> => {
  const paneValues = url.searchParams.getAll('pane')
  if (paneValues.length !== 1) {
    return { valid: false, error: 'Query parameter "pane" must be specified exactly once' }
  }
  const pane = paneValues[0]
  if (!PANE_ID_REGEX.test(pane)) {
    return { valid: false, error: 'Invalid or missing "pane" query param' }
  }

  const colsValues = url.searchParams.getAll('cols')
  if (colsValues.length > 1) {
    return { valid: false, error: 'Duplicate "cols" query param' }
  }

  const rowsValues = url.searchParams.getAll('rows')
  if (rowsValues.length > 1) {
    return { valid: false, error: 'Duplicate "rows" query param' }
  }

  let cols = DEFAULT_CONTROL_COLS
  let rows = DEFAULT_CONTROL_ROWS

  if (colsValues.length === 1) {
    const rawCols = colsValues[0]
    if (!isStrictDecimalInteger(rawCols)) {
      return { valid: false, error: 'cols must be a canonical decimal integer' }
    }
    const parsed = Number(rawCols)
    if (parsed < MIN_CONTROL_COLS || parsed > MAX_CONTROL_COLS) {
      return {
        valid: false,
        error: `cols must be an integer between ${MIN_CONTROL_COLS} and ${MAX_CONTROL_COLS}`
      }
    }
    cols = parsed
  }

  if (rowsValues.length === 1) {
    const rawRows = rowsValues[0]
    if (!isStrictDecimalInteger(rawRows)) {
      return { valid: false, error: 'rows must be a canonical decimal integer' }
    }
    const parsed = Number(rawRows)
    if (parsed < MIN_CONTROL_ROWS || parsed > MAX_CONTROL_ROWS) {
      return {
        valid: false,
        error: `rows must be an integer between ${MIN_CONTROL_ROWS} and ${MAX_CONTROL_ROWS}`
      }
    }
    rows = parsed
  }

  return {
    valid: true,
    data: {
      pane,
      cols,
      rows
    }
  }
}

export const validateTerminalControlStatusParams = (
  url: URL
): IValidationResult<{ pane: string }> => {
  const allParams = Array.from(url.searchParams.keys())
  for (const key of allParams) {
    if (key !== 'pane') {
      return { valid: false, error: `Unexpected query parameter "${key}"` }
    }
  }

  const paneValues = url.searchParams.getAll('pane')
  if (paneValues.length !== 1) {
    return { valid: false, error: 'Query parameter "pane" must be specified exactly once' }
  }
  const pane = paneValues[0]
  if (!PANE_ID_REGEX.test(pane)) {
    return { valid: false, error: 'Invalid or missing "pane" query param' }
  }

  return {
    valid: true,
    data: { pane }
  }
}

export const validateTerminalControlMessage = (
  raw: unknown
): IValidationResult<IControlClientMessage> => {
  if (typeof raw === 'string') {
    if (new TextEncoder().encode(raw).length > MAX_WS_CONTROL_MESSAGE_BYTES) {
      return { valid: false, error: 'WebSocket message exceeds maximum size of 8192 bytes' }
    }
    try {
      raw = JSON.parse(raw)
    } catch {
      return { valid: false, error: 'Malformed JSON payload' }
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'Control message must be a JSON object' }
  }

  const obj = raw as Record<string, unknown>
  const keys = Object.keys(obj)

  if (typeof obj.type !== 'string') {
    return { valid: false, error: 'Missing or invalid "type" in control message' }
  }

  if (obj.type === 'terminal.input') {
    if (keys.length !== 2 || !('text' in obj)) {
      return { valid: false, error: 'terminal.input message must contain only "type" and "text"' }
    }
    if (typeof obj.text !== 'string' || obj.text.length === 0) {
      return { valid: false, error: 'terminal.input text must be a non-empty string' }
    }
    const byteLength = new TextEncoder().encode(obj.text).length
    if (byteLength > MAX_INPUT_TEXT_UTF8_BYTES) {
      return {
        valid: false,
        error: `terminal.input text exceeds maximum length of ${MAX_INPUT_TEXT_UTF8_BYTES} UTF-8 bytes`
      }
    }
    return {
      valid: true,
      data: {
        type: 'terminal.input',
        text: obj.text
      }
    }
  }

  if (obj.type === 'terminal.resize') {
    if (keys.length !== 3 || !('cols' in obj) || !('rows' in obj)) {
      return { valid: false, error: 'terminal.resize message must contain only "type", "cols", and "rows"' }
    }
    if (
      typeof obj.cols !== 'number' ||
      !Number.isInteger(obj.cols) ||
      obj.cols < MIN_CONTROL_COLS ||
      obj.cols > MAX_CONTROL_COLS
    ) {
      return {
        valid: false,
        error: `terminal.resize cols must be an integer between ${MIN_CONTROL_COLS} and ${MAX_CONTROL_COLS}`
      }
    }
    if (
      typeof obj.rows !== 'number' ||
      !Number.isInteger(obj.rows) ||
      obj.rows < MIN_CONTROL_ROWS ||
      obj.rows > MAX_CONTROL_ROWS
    ) {
      return {
        valid: false,
        error: `terminal.resize rows must be an integer between ${MIN_CONTROL_ROWS} and ${MAX_CONTROL_ROWS}`
      }
    }
    return {
      valid: true,
      data: {
        type: 'terminal.resize',
        cols: obj.cols,
        rows: obj.rows
      }
    }
  }

  if (obj.type === 'terminal.release') {
    if (keys.length !== 1) {
      return { valid: false, error: 'terminal.release message must not contain additional fields' }
    }
    return {
      valid: true,
      data: {
        type: 'terminal.release'
      }
    }
  }

  return { valid: false, error: `Unsupported control message type: "${obj.type}"` }
}

export type IUpstreamTerminalFrame = ITerminalFrame
export type IUpstreamTerminalClosed = ITerminalClosed
export type IUpstreamTerminalMessage = ITerminalFrame | ITerminalClosed

export const canAcceptTerminalControlMessage = (
  controlReady: boolean,
  isClosed?: boolean
): boolean => {
  return Boolean(controlReady && !isClosed)
}

const FRAME_ALLOWED_KEYS = ['type', 'seq', 'encoding', 'width', 'height', 'full', 'bytes']
const CLOSED_ALLOWED_KEYS = ['type', 'reason']

export const parseAndValidateUpstreamTerminalMessage = (
  raw: string
): IValidationResult<IUpstreamTerminalMessage> => {
  if (typeof raw !== 'string') {
    return { valid: false, error: 'Upstream terminal message must be a string' }
  }

  const byteLength = new TextEncoder().encode(raw).length
  if (byteLength > MAX_STDOUT_LINE_BYTES) {
    return { valid: false, error: `Upstream terminal message exceeds ${MAX_STDOUT_LINE_BYTES} byte limit` }
  }

  let obj: any
  try {
    obj = JSON.parse(raw)
  } catch {
    return { valid: false, error: 'Upstream message is not valid JSON' }
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, error: 'Upstream message must be a JSON object' }
  }

  if (typeof obj.type !== 'string') {
    return { valid: false, error: 'Upstream message missing "type" string' }
  }

  const keys = Object.keys(obj)

  if (obj.type === 'terminal.frame') {
    for (const key of keys) {
      if (!FRAME_ALLOWED_KEYS.includes(key)) {
        return { valid: false, error: `Unexpected key in terminal.frame: "${key}"` }
      }
    }
    for (const reqKey of FRAME_ALLOWED_KEYS) {
      if (!(reqKey in obj)) {
        return { valid: false, error: `Missing required key in terminal.frame: "${reqKey}"` }
      }
    }

    if (typeof obj.seq !== 'number' || !Number.isInteger(obj.seq) || !Number.isFinite(obj.seq) || obj.seq < 0) {
      return { valid: false, error: 'terminal.frame "seq" must be a finite non-negative integer' }
    }

    if (obj.encoding !== 'ansi') {
      return { valid: false, error: `terminal.frame "encoding" must be exactly "ansi", got "${obj.encoding}"` }
    }

    if (typeof obj.width !== 'number' || !Number.isInteger(obj.width) || obj.width < MIN_CONTROL_COLS || obj.width > MAX_CONTROL_COLS) {
      return { valid: false, error: `terminal.frame "width" must be an integer between ${MIN_CONTROL_COLS} and ${MAX_CONTROL_COLS}` }
    }

    if (typeof obj.height !== 'number' || !Number.isInteger(obj.height) || obj.height < MIN_CONTROL_ROWS || obj.height > MAX_CONTROL_ROWS) {
      return { valid: false, error: `terminal.frame "height" must be an integer between ${MIN_CONTROL_ROWS} and ${MAX_CONTROL_ROWS}` }
    }

    if (typeof obj.full !== 'boolean') {
      return { valid: false, error: 'terminal.frame "full" must be a boolean' }
    }

    if (typeof obj.bytes !== 'string') {
      return { valid: false, error: 'terminal.frame "bytes" must be a string' }
    }

    if (obj.bytes.length > 0) {
      if (obj.bytes.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(obj.bytes)) {
        return { valid: false, error: 'terminal.frame "bytes" must be valid base64' }
      }
      const approxDecoded = Math.floor((obj.bytes.length * 3) / 4)
      if (approxDecoded > MAX_STDOUT_LINE_BYTES) {
        return { valid: false, error: 'terminal.frame "bytes" exceeds decoded byte limit' }
      }
    }

    return {
      valid: true,
      data: {
        type: 'terminal.frame',
        seq: obj.seq,
        encoding: 'ansi',
        width: obj.width,
        height: obj.height,
        full: obj.full,
        bytes: obj.bytes
      }
    }
  }

  if (obj.type === 'terminal.closed') {
    for (const key of keys) {
      if (!CLOSED_ALLOWED_KEYS.includes(key)) {
        return { valid: false, error: `Unexpected key in terminal.closed: "${key}"` }
      }
    }

    let reason: string | undefined = undefined
    if ('reason' in obj) {
      if (typeof obj.reason !== 'string') {
        return { valid: false, error: 'terminal.closed "reason" must be a string' }
      }
      if (obj.reason.length > 100) {
        return { valid: false, error: 'terminal.closed "reason" exceeds 100 characters' }
      }
      if (!/^[a-zA-Z0-9_ -]+$/.test(obj.reason)) {
        return { valid: false, error: 'terminal.closed "reason" contains invalid characters' }
      }
      reason = obj.reason
    }

    return {
      valid: true,
      data: {
        type: 'terminal.closed',
        ...(reason !== undefined ? { reason } : {})
      }
    }
  }

  return { valid: false, error: `Unsupported upstream message type: "${obj.type}"` }
}

export const PUBLIC_PREFLIGHT_ERRORS: Record<string, string> = {
  invalid_pane_id: 'Invalid pane identifier format',
  snapshot_unavailable: 'Herdr session snapshot unavailable',
  pane_not_found: 'Pane not found in active session',
  ambiguous_pane: 'Pane identifier is ambiguous',
  agent_pane_refusal: 'Terminal control is not available for agent panes',
  process_info_unavailable: 'Pane process information unavailable',
  malformed_process_info: 'Invalid process information received from server',
  process_info_mismatch: 'Pane process mismatch detected',
  invalid_shell_pid: 'Invalid shell process detected',
  invalid_foreground_pgid: 'Invalid foreground process group detected',
  busy_shell_refusal: 'Pane is executing another foreground process or busy'
}

export const getPublicPreflightErrorMessage = (code?: string): string => {
  if (code && code in PUBLIC_PREFLIGHT_ERRORS) {
    return PUBLIC_PREFLIGHT_ERRORS[code]
  }
  return 'Terminal control preflight validation failed'
}

export const sanitizeStderrToCategory = (raw: string): string => {
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return 'empty'
  if (trimmed.includes('permission') || trimmed.includes('eacces') || trimmed.includes('operation not permitted')) {
    return 'permission_denied'
  }
  if (trimmed.includes('not found') || trimmed.includes('enoent') || trimmed.includes('no such file')) {
    return 'resource_not_found'
  }
  if (trimmed.includes('busy') || trimmed.includes('in use') || trimmed.includes('locked')) {
    return 'resource_busy'
  }
  if (trimmed.includes('invalid') || trimmed.includes('unsupported') || trimmed.includes('bad argument')) {
    return 'invalid_argument'
  }
  return 'child_process_error'
}

export const sanitizeStderrOutput = (text: string): string => {
  return text
    .replace(/(?:\/[\w.-]+){2,}/g, '[path]')
    .replace(/token=[a-zA-Z0-9_-]+/gi, 'token=[redacted]')
    .replace(/pid\s*[:=]?\s*\d+/gi, 'pid=[redacted]')
    .slice(0, 500)
    .trim()
}

export interface IPreflightDependencies {
  fetchSnapshot?: (timeoutMs: number) => Promise<ISnapshotResult>
  fetchProcessInfo?: (paneId: string, timeoutMs: number) => Promise<any>
}

export const preflightShellPane = async (
  paneId: string,
  deps: IPreflightDependencies = {},
  timeoutMs = 3000
): Promise<IControlPreflightResult> => {
  if (!PANE_ID_REGEX.test(paneId)) {
    return {
      ok: false,
      status: 400,
      code: 'invalid_pane_id',
      error: `Invalid pane ID format: "${paneId}"`
    }
  }

  // 1. Authoritative Snapshot Verification
  let snapshot: ISnapshotResult
  try {
    const fetcher = deps.fetchSnapshot || getHerdrSnapshot
    snapshot = await fetcher(timeoutMs)
  } catch (err) {
    return {
      ok: false,
      status: 502,
      code: 'snapshot_unavailable',
      error: `Failed to fetch authoritative snapshot: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  const panes = snapshot.panes || []
  const matchingPanes = panes.filter((p) => p && p.pane_id === paneId)

  if (matchingPanes.length === 0) {
    return {
      ok: false,
      status: 404,
      code: 'pane_not_found',
      error: `Pane "${paneId}" not found in active session`
    }
  }

  if (matchingPanes.length > 1) {
    return {
      ok: false,
      status: 400,
      code: 'ambiguous_pane',
      error: `Ambiguous duplicate pane "${paneId}" in active session`
    }
  }

  const targetPane: IPane = matchingPanes[0]

  // Refuse if pane is an agent pane
  if (isAgentPane(targetPane, snapshot.agents)) {
    return {
      ok: false,
      status: 422,
      code: 'agent_pane_refusal',
      error: `Control mode is disabled for agent panes ("${paneId}")`
    }
  }

  // 2. Socket-First Process Info Verification
  let rawProcessInfo: any
  try {
    if (deps.fetchProcessInfo) {
      rawProcessInfo = await deps.fetchProcessInfo(paneId, timeoutMs)
    } else {
      rawProcessInfo = await sendRawSocketRequest<any>(
        'pane.process_info',
        { pane_id: paneId },
        { timeoutMs }
      )
    }
  } catch (procErr) {
    if (procErr instanceof HerdrSocketError && procErr.code === 'pane_not_found') {
      return {
        ok: false,
        status: 404,
        code: 'pane_not_found',
        error: `Pane "${paneId}" does not exist in the active Herdr session`
      }
    }
    return {
      ok: false,
      status: 502,
      code: 'process_info_unavailable',
      error: `Failed to fetch pane process info: ${procErr instanceof Error ? procErr.message : String(procErr)}`
    }
  }

  const info: IPaneProcessInfo =
    rawProcessInfo && typeof rawProcessInfo === 'object' && 'process_info' in rawProcessInfo
      ? rawProcessInfo.process_info
      : rawProcessInfo

  if (!info || typeof info !== 'object') {
    return {
      ok: false,
      status: 502,
      code: 'malformed_process_info',
      error: 'Malformed process info returned from Herdr'
    }
  }

  if (info.pane_id !== paneId) {
    return {
      ok: false,
      status: 502,
      code: 'process_info_mismatch',
      error: `Process info pane ID mismatch: expected "${paneId}", got "${info.pane_id}"`
    }
  }

  const shellPid = info.shell_pid
  const foregroundPgid = info.foreground_process_group_id
  const foregroundProcesses = info.foreground_processes

  if (
    typeof shellPid !== 'number' ||
    !Number.isInteger(shellPid) ||
    shellPid <= 0
  ) {
    return {
      ok: false,
      status: 409,
      code: 'invalid_shell_pid',
      error: 'Pane shell process ID is missing or invalid'
    }
  }

  if (
    typeof foregroundPgid !== 'number' ||
    !Number.isInteger(foregroundPgid) ||
    foregroundPgid <= 0
  ) {
    return {
      ok: false,
      status: 409,
      code: 'invalid_foreground_pgid',
      error: 'Pane foreground process group ID is missing or invalid'
    }
  }

  if (!Array.isArray(foregroundProcesses) || foregroundProcesses.length !== 1) {
    return {
      ok: false,
      status: 409,
      code: 'busy_shell_refusal',
      error: 'Pane is not an idle shell: multiple or zero foreground processes detected'
    }
  }

  if (foregroundPgid !== shellPid) {
    return {
      ok: false,
      status: 409,
      code: 'busy_shell_refusal',
      error: 'Pane is busy: foreground process group differs from shell process ID'
    }
  }

  const soleProc = foregroundProcesses[0]
  if (
    soleProc &&
    soleProc.pid !== undefined &&
    soleProc.pid !== null &&
    (typeof soleProc.pid !== 'number' || soleProc.pid !== shellPid)
  ) {
    return {
      ok: false,
      status: 409,
      code: 'busy_shell_refusal',
      error: 'Pane is busy: foreground process PID differs from shell process ID'
    }
  }

  return {
    ok: true,
    paneId,
    shellPid,
    pgid: foregroundPgid
  }
}

export const spawnTerminalControlProcess = (paneId: string, cols: number, rows: number) => {
  const argv = buildTerminalControlArgv(paneId, cols, rows)
  return Bun.spawn(argv, {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe'
  })
}

export interface ITerminalControlArbiter {
  claimPane(paneId: string, leaseId: string): { ok: true; token: string } | { ok: false; status: number; error: string }
  releasePane(token: string): void
  isPaneClaimed?(paneId: string): boolean
}

export interface IControlLease {
  id: string
  paneId: string
  createdAt: number
  expiresAt: number
  status: 'pending' | 'active' | 'releasing' | 'released'
  proc?: ReturnType<typeof spawnTerminalControlProcess>
  ws?: any
  expiryTimer?: Timer
  claimToken?: string
}

const createLocalArbiter = (): ITerminalControlArbiter => {
  const claimed = new Map<string, string>()
  return {
    claimPane: (paneId: string) => {
      if (claimed.has(paneId)) {
        return { ok: false, status: 409, error: 'A terminal control session is already active or pending' }
      }
      const token = crypto.randomUUID()
      claimed.set(paneId, token)
      return { ok: true, token }
    },
    releasePane: (token: string) => {
      for (const [pane, t] of claimed.entries()) {
        if (t === token) claimed.delete(pane)
      }
    },
    isPaneClaimed: (paneId: string) => claimed.has(paneId)
  }
}

export interface ITerminalControlLeaseManagerOptions {
  arbiter?: ITerminalControlArbiter
  maxLeaseDurationMs?: number
  releaseGraceTimeoutMs?: number
  releaseKillTimeoutMs?: number
}

export class TerminalControlLeaseManager {
  private currentLease: IControlLease | null = null
  private activeReleasePromises = new Map<string, Promise<void>>()
  private arbiter: ITerminalControlArbiter
  private readonly maxLeaseDurationMs: number
  private readonly releaseGraceTimeoutMs: number
  private readonly releaseKillTimeoutMs: number

  constructor(options: ITerminalControlLeaseManagerOptions = {}) {
    this.arbiter = options.arbiter ?? createLocalArbiter()
    this.maxLeaseDurationMs = options.maxLeaseDurationMs ?? MAX_LEASE_DURATION_MS
    this.releaseGraceTimeoutMs = options.releaseGraceTimeoutMs ?? RELEASE_GRACE_TIMEOUT_MS
    this.releaseKillTimeoutMs = options.releaseKillTimeoutMs ?? 500
  }

  /**
   * Binds an injected manager to the server's selected shared pane arbiter before use.
   * Rebinding with any live/pending/releasing lease fails closed so an existing claim
   * can never be detached from the arbiter that created it.
   */
  public bindArbiter(arbiter: ITerminalControlArbiter): void {
    if (this.currentLease && this.currentLease.status !== 'released') {
      throw new Error('Cannot bind terminal control arbiter while a lease is active or pending')
    }
    this.arbiter = arbiter
  }

  public isLeasePending(leaseId: string): boolean {
    if (!this.currentLease || this.currentLease.id !== leaseId) return false
    if (this.currentLease.status !== 'pending') return false
    if (Date.now() >= this.currentLease.expiresAt) return false
    return true
  }

  public isLeaseActive(leaseId: string): boolean {
    if (!this.currentLease || this.currentLease.id !== leaseId) return false
    if (this.currentLease.status !== 'active') return false
    if (Date.now() >= this.currentLease.expiresAt) return false
    return true
  }

  public reserveLease(paneId: string): { ok: true; lease: IControlLease } | { ok: false; status: number; error: string } {
    if (this.currentLease && this.currentLease.status !== 'released') {
      return {
        ok: false,
        status: 409,
        error: 'A terminal control session is already active or pending'
      }
    }

    const now = Date.now()
    const leaseId = crypto.randomUUID()
    const lease: IControlLease = {
      id: leaseId,
      paneId,
      createdAt: now,
      expiresAt: now + this.maxLeaseDurationMs,
      status: 'pending'
    }

    // Synchronously claim pane through arbiter
    const claim = this.arbiter.claimPane(paneId, leaseId)
    if (!claim.ok) {
      return {
        ok: false,
        status: claim.status,
        error: claim.error
      }
    }

    lease.claimToken = claim.token
    this.currentLease = lease

    // Start absolute expiry timer at reservation
    lease.expiryTimer = setTimeout(() => {
      void this.releaseLease(leaseId, 'lease_expired')
    }, this.maxLeaseDurationMs)

    return { ok: true, lease }
  }

  public activateLease(
    leaseId: string,
    proc: ReturnType<typeof spawnTerminalControlProcess>,
    ws: any
  ): boolean {
    if (
      !this.currentLease ||
      this.currentLease.id !== leaseId ||
      this.currentLease.status !== 'pending'
    ) {
      return false
    }

    this.currentLease.status = 'active'
    this.currentLease.proc = proc
    this.currentLease.ws = ws

    return true
  }

  public releaseLease(leaseId: string, reason = 'detached'): Promise<void> {
    const existingPromise = this.activeReleasePromises.get(leaseId)
    if (existingPromise) {
      return existingPromise
    }

    if (
      !this.currentLease ||
      this.currentLease.id !== leaseId ||
      this.currentLease.status === 'released' ||
      this.currentLease.status === 'releasing'
    ) {
      return Promise.resolve()
    }

    const lease = this.currentLease
    lease.status = 'releasing'

    if (lease.expiryTimer) {
      clearTimeout(lease.expiryTimer)
      lease.expiryTimer = undefined
    }

    const releasePromise = (async () => {
      try {
        if (!lease.proc) {
          // Pending lease with no child releases immediately
          if (lease.claimToken) {
            this.arbiter.releasePane(lease.claimToken)
            lease.claimToken = undefined
          }
          if (lease.ws) {
            try {
              if (lease.ws.readyState === 1) {
                lease.ws.send(JSON.stringify({ type: 'terminal.closed', reason }))
                lease.ws.close()
              }
            } catch {}
          }
          lease.status = 'released'
          if (this.currentLease?.id === leaseId) {
            this.currentLease = null
          }
          return
        }

        const proc = lease.proc
        let childExited = false
        proc.exited.then(() => {
          childExited = true
        })

        // 1. Send terminal.release to child stdin if writable
        try {
          if (proc.stdin && typeof proc.stdin.write === 'function') {
            proc.stdin.write(JSON.stringify({ type: 'terminal.release' }) + '\n')
            proc.stdin.flush?.()
          }
        } catch {}

        // 2. Wait bounded grace period for clean exit
        try {
          const timeoutPromise = new Promise((resolve) => setTimeout(resolve, this.releaseGraceTimeoutMs))
          const race = await Promise.race([proc.exited, timeoutPromise])
          if (typeof race === 'number') {
            childExited = true
          }
        } catch {}

        // 3. Hard fallback: explicitly send SIGKILL, boundedly await exit
        if (!childExited) {
          try {
            try {
              ;(proc as any).kill('SIGKILL')
            } catch {
              proc.kill()
            }
            const killTimeout = new Promise((resolve) => setTimeout(resolve, this.releaseKillTimeoutMs))
            const killRace = await Promise.race([proc.exited, killTimeout])
            if (typeof killRace === 'number') {
              childExited = true
            }
          } catch {}
        }

        // 4. Notify WebSocket and close safely
        if (lease.ws) {
          const ws = lease.ws
          try {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'terminal.closed', reason }))
              ws.close()
            }
          } catch {}
        }

        // Finalize or quarantine:
        if (childExited) {
          lease.status = 'released'
          if (lease.claimToken) {
            this.arbiter.releasePane(lease.claimToken)
            lease.claimToken = undefined
          }
          if (this.currentLease?.id === leaseId) {
            this.currentLease = null
          }
        } else {
          // Child exit still unconfirmed: retain releasing/quarantined lease + claim; attach late exit finalization
          proc.exited.then(() => {
            lease.status = 'released'
            if (lease.claimToken) {
              this.arbiter.releasePane(lease.claimToken)
              lease.claimToken = undefined
            }
            if (this.currentLease?.id === leaseId) {
              this.currentLease = null
            }
          })
        }
      } finally {
        this.activeReleasePromises.delete(leaseId)
      }
    })()

    this.activeReleasePromises.set(leaseId, releasePromise)
    return releasePromise
  }

  public async releaseActiveLease(reason = 'detached'): Promise<void> {
    if (this.currentLease) {
      await this.releaseLease(this.currentLease.id, reason)
    }
  }

  public getActiveLease(): IControlLease | null {
    if (this.currentLease && this.currentLease.status !== 'released') {
      return this.currentLease
    }
    return null
  }

  public isPaneLeased(paneId: string): boolean {
    return (
      this.currentLease !== null &&
      this.currentLease.status !== 'released' &&
      this.currentLease.paneId === paneId
    )
  }

  public getLeaseStatus(paneId: string): {
    leased: boolean
    status: 'pending' | 'active' | 'releasing' | null
  } {
    if (
      this.currentLease !== null &&
      this.currentLease.status !== 'released' &&
      this.currentLease.paneId === paneId
    ) {
      return {
        leased: true,
        status: this.currentLease.status
      }
    }
    return {
      leased: false,
      status: null
    }
  }

  public resetForTesting(): void {
    if (this.currentLease) {
      if (this.currentLease.expiryTimer) {
        clearTimeout(this.currentLease.expiryTimer)
      }
      if (this.currentLease.claimToken) {
        this.arbiter.releasePane(this.currentLease.claimToken)
      }
      if (this.currentLease.proc) {
        try {
          this.currentLease.proc.kill()
        } catch {}
      }
      this.currentLease = null
    }
    this.activeReleasePromises.clear()
  }
}

let sharedLeaseManager: TerminalControlLeaseManager | null = null

export const getSharedTerminalControlLeaseManager = (): TerminalControlLeaseManager => {
  if (!sharedLeaseManager) {
    sharedLeaseManager = new TerminalControlLeaseManager({
      arbiter: {
        claimPane: (paneId, leaseId) => getSharedOperationCoordinator().claimPaneForControl(paneId, leaseId),
        releasePane: (token) => { getSharedOperationCoordinator().releaseControlPane(token) },
        isPaneClaimed: (paneId) => getSharedOperationCoordinator().isPaneClaimed(paneId)
      }
    })
  }
  return sharedLeaseManager
}
