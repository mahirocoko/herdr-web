import {
  PANE_ID_REGEX,
  CONSERVATIVE_TOKEN_REGEX,
  type IValidationResult
} from './security.ts'

export const MIN_FIT_COLS = 1
export const MAX_FIT_COLS = 500
export const MIN_FIT_ROWS = 1
export const MAX_FIT_ROWS = 200
export const DEFAULT_FIT_COLS = 80
export const DEFAULT_FIT_ROWS = 24

export const MAX_WS_FIT_MESSAGE_BYTES = 8192

export const MIN_SCROLL_DELTA = -1000
export const MAX_SCROLL_DELTA = 1000

export interface IFitClientResizeMessage {
  type: 'terminal.resize'
  cols: number
  rows: number
}

export type IFitClientScrollMessage =
  | {
      type: 'terminal.scroll'
      deltaRows: number
    }
  | {
      type: 'terminal.scroll'
      to: 'latest'
    }
  | {
      type: 'terminal.scroll'
      reset: true
    }

export type IFitClientMessage =
  IFitClientResizeMessage | IFitClientScrollMessage

export interface ITerminalScrollState {
  offset: number
  maxOffset: number
  viewportRows: number
  offset_from_bottom?: number
  max_offset_from_bottom?: number
  viewport_rows?: number
}

export interface ITerminalScrollStateMessage {
  type: 'terminal.scroll-state'
  offset: number
  maxOffset: number
  viewportRows: number
  offset_from_bottom: number
  max_offset_from_bottom: number
  viewport_rows: number
}

export const isStrictDecimalInteger = (val: string): boolean => {
  return /^[1-9][0-9]*$/.test(val)
}

export const validateTerminalFitParams = (
  url: URL
): IValidationResult<{
  pane: string
  terminalId: string
  cols: number
  rows: number
}> => {
  const paneValues = url.searchParams.getAll('pane')
  if (paneValues.length !== 1) {
    return {
      valid: false,
      error: 'Query parameter "pane" must be specified exactly once'
    }
  }
  const pane = paneValues[0].trim()
  if (!PANE_ID_REGEX.test(pane)) {
    return { valid: false, error: 'Invalid or missing "pane" query param' }
  }

  const terminalIdValues = url.searchParams.getAll('terminalId')
  if (terminalIdValues.length !== 1) {
    return {
      valid: false,
      error: 'Query parameter "terminalId" must be specified exactly once'
    }
  }
  const terminalId = terminalIdValues[0].trim()
  if (
    !CONSERVATIVE_TOKEN_REGEX.test(terminalId) ||
    terminalId.length === 0 ||
    terminalId.length > 128
  ) {
    return {
      valid: false,
      error: 'Invalid or missing "terminalId" query param'
    }
  }

  const colsValues = url.searchParams.getAll('cols')
  if (colsValues.length > 1) {
    return { valid: false, error: 'Duplicate "cols" query param' }
  }

  const rowsValues = url.searchParams.getAll('rows')
  if (rowsValues.length > 1) {
    return { valid: false, error: 'Duplicate "rows" query param' }
  }

  let cols = DEFAULT_FIT_COLS
  let rows = DEFAULT_FIT_ROWS

  if (colsValues.length === 1) {
    const rawCols = colsValues[0]
    if (!isStrictDecimalInteger(rawCols)) {
      return {
        valid: false,
        error: 'cols must be a canonical decimal integer'
      }
    }
    const parsed = Number(rawCols)
    if (parsed < MIN_FIT_COLS || parsed > MAX_FIT_COLS) {
      return {
        valid: false,
        error: `cols must be an integer between ${MIN_FIT_COLS} and ${MAX_FIT_COLS}`
      }
    }
    cols = parsed
  }

  if (rowsValues.length === 1) {
    const rawRows = rowsValues[0]
    if (!isStrictDecimalInteger(rawRows)) {
      return {
        valid: false,
        error: 'rows must be a canonical decimal integer'
      }
    }
    const parsed = Number(rawRows)
    if (parsed < MIN_FIT_ROWS || parsed > MAX_FIT_ROWS) {
      return {
        valid: false,
        error: `rows must be an integer between ${MIN_FIT_ROWS} and ${MAX_FIT_ROWS}`
      }
    }
    rows = parsed
  }

  return {
    valid: true,
    data: {
      pane,
      terminalId,
      cols,
      rows
    }
  }
}

export const validateTerminalFitClientMessage = (
  raw: unknown
): IValidationResult<IFitClientMessage> => {
  if (typeof raw === 'string') {
    if (new TextEncoder().encode(raw).length > MAX_WS_FIT_MESSAGE_BYTES) {
      return {
        valid: false,
        error: `WebSocket message exceeds maximum size of ${MAX_WS_FIT_MESSAGE_BYTES} bytes`
      }
    }
    try {
      raw = JSON.parse(raw)
    } catch {
      return { valid: false, error: 'Malformed JSON payload' }
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, error: 'Message must be a JSON object' }
  }

  const obj = raw as Record<string, unknown>
  const keys = Object.keys(obj)

  if (typeof obj.type !== 'string') {
    return { valid: false, error: 'Missing or invalid "type" in message' }
  }

  if (obj.type !== 'terminal.resize' && obj.type !== 'terminal.scroll') {
    return {
      valid: false,
      error: `Unsupported message type "${obj.type}". Fitted reader accepts only "terminal.resize" and "terminal.scroll". Interactive inputs or commands are forbidden.`
    }
  }

  if (obj.type === 'terminal.resize') {
    if (keys.length !== 3 || !('cols' in obj) || !('rows' in obj)) {
      return {
        valid: false,
        error:
          'terminal.resize message must contain only "type", "cols", and "rows"'
      }
    }

    if (
      typeof obj.cols !== 'number' ||
      !Number.isInteger(obj.cols) ||
      obj.cols < MIN_FIT_COLS ||
      obj.cols > MAX_FIT_COLS
    ) {
      return {
        valid: false,
        error: `terminal.resize cols must be an integer between ${MIN_FIT_COLS} and ${MAX_FIT_COLS}`
      }
    }

    if (
      typeof obj.rows !== 'number' ||
      !Number.isInteger(obj.rows) ||
      obj.rows < MIN_FIT_ROWS ||
      obj.rows > MAX_FIT_ROWS
    ) {
      return {
        valid: false,
        error: `terminal.resize rows must be an integer between ${MIN_FIT_ROWS} and ${MAX_FIT_ROWS}`
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

  if (obj.type === 'terminal.scroll') {
    if ('to' in obj) {
      if (keys.length !== 2) {
        return {
          valid: false,
          error: 'terminal.scroll with "to" must contain only "type" and "to"'
        }
      }
      if (obj.to !== 'latest') {
        return {
          valid: false,
          error: 'terminal.scroll "to" only supports "latest"'
        }
      }
      return {
        valid: true,
        data: {
          type: 'terminal.scroll',
          to: 'latest'
        }
      }
    }

    if ('reset' in obj) {
      if (keys.length !== 2) {
        return {
          valid: false,
          error:
            'terminal.scroll with "reset" must contain only "type" and "reset"'
        }
      }
      if (obj.reset !== true) {
        return {
          valid: false,
          error: 'terminal.scroll "reset" must be boolean true'
        }
      }
      return {
        valid: true,
        data: {
          type: 'terminal.scroll',
          reset: true
        }
      }
    }

    if ('deltaRows' in obj) {
      if (keys.length !== 2) {
        return {
          valid: false,
          error:
            'terminal.scroll with "deltaRows" must contain only "type" and "deltaRows"'
        }
      }
      if (
        typeof obj.deltaRows !== 'number' ||
        !Number.isInteger(obj.deltaRows) ||
        obj.deltaRows < MIN_SCROLL_DELTA ||
        obj.deltaRows > MAX_SCROLL_DELTA
      ) {
        return {
          valid: false,
          error: `terminal.scroll deltaRows must be an integer between ${MIN_SCROLL_DELTA} and ${MAX_SCROLL_DELTA}`
        }
      }
      return {
        valid: true,
        data: {
          type: 'terminal.scroll',
          deltaRows: obj.deltaRows
        }
      }
    }

    return {
      valid: false,
      error:
        'terminal.scroll message must specify either "deltaRows", "to: latest", or "reset: true"'
    }
  }

  return {
    valid: false,
    error: 'Unrecognized message'
  }
}

export interface ITerminalFitScrollAdapter {
  verifyTarget?: (paneId: string, terminalId: string) => Promise<boolean>
  getScrollMetadata: (
    paneId: string,
    timeoutMs?: number
  ) => Promise<{
    offset_from_bottom: number
    max_offset_from_bottom: number
    viewport_rows: number
  }>
  executeScroll: (
    paneId: string,
    offsetFromBottom: number,
    timeoutMs?: number
  ) => Promise<{ ok: boolean; offset_from_bottom: number }>
}

export interface IPendingScrollIntent {
  mode: 'relative' | 'latest'
  delta: number
}

export interface IFittedTerminalSession {
  terminalId: string
  paneId: string
  generation: number
  proc?: any
  ws?: any
  status: 'reserving' | 'active' | 'retiring' | 'closed'
  cols: number
  rows: number
  createdAt: number
  initialScrollOffset?: number
  lastAppliedScrollOffset?: number
  pendingScrollIntent?: IPendingScrollIntent | null
  scrollDrainPromise?: Promise<void> | null
}

export type ISpawnTerminalFitProcess = (
  terminalId: string,
  cols: number,
  rows: number
) => any

export const defaultSpawnTerminalFitProcess: ISpawnTerminalFitProcess = (
  terminalId: string,
  cols: number,
  rows: number
) => {
  return Bun.spawn(
    [
      'herdr',
      'terminal',
      'session',
      'control',
      terminalId,
      '--cols',
      String(cols),
      '--rows',
      String(rows)
    ],
    {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe'
    }
  )
}

export class TerminalFitManager {
  private activeSessions = new Map<string, IFittedTerminalSession>()
  private blockedTerminals = new Map<string, string>()
  private generationCounters = new Map<string, number>()
  private activeRetirePromises = new Map<
    string,
    Promise<{ confirmed: boolean; generation: number }>
  >()
  private spawnFn: ISpawnTerminalFitProcess
  private scrollAdapter?: ITerminalFitScrollAdapter

  constructor(options?: {
    spawnProcess?: ISpawnTerminalFitProcess
    scrollAdapter?: ITerminalFitScrollAdapter
  }) {
    this.spawnFn = options?.spawnProcess ?? defaultSpawnTerminalFitProcess
    this.scrollAdapter = options?.scrollAdapter
  }

  public setScrollAdapter(adapter?: ITerminalFitScrollAdapter): void {
    this.scrollAdapter = adapter
  }

  public getScrollAdapter(): ITerminalFitScrollAdapter | undefined {
    return this.scrollAdapter
  }

  public setInitialScrollOffset(
    terminalId: string,
    generation: number,
    offset: number
  ): boolean {
    const session = this.activeSessions.get(terminalId)
    if (!session || session.generation !== generation) {
      return false
    }
    if (session.initialScrollOffset === undefined) {
      session.initialScrollOffset = Math.max(0, Math.floor(offset))
    }
    return true
  }

  public recordAppliedScrollOffset(
    terminalId: string,
    generation: number,
    offset: number
  ): boolean {
    const session = this.activeSessions.get(terminalId)
    if (!session || session.generation !== generation) {
      return false
    }
    session.lastAppliedScrollOffset = Math.max(0, Math.floor(offset))
    return true
  }

  public async restoreSessionScroll(
    terminalId: string,
    generation: number
  ): Promise<{ restored: boolean; reason?: string; offset?: number }> {
    const session = this.activeSessions.get(terminalId)
    if (!session || session.generation !== generation) {
      return { restored: false, reason: 'generation_mismatch_or_not_found' }
    }

    // Guard 3: No-scroll release writes nothing (lastAppliedScrollOffset === undefined)
    if (session.lastAppliedScrollOffset === undefined) {
      return { restored: false, reason: 'no_scroll_applied' }
    }

    if (!this.scrollAdapter) {
      return { restored: false, reason: 'no_scroll_adapter' }
    }

    if (
      this.scrollAdapter.verifyTarget &&
      !(await this.scrollAdapter
        .verifyTarget(session.paneId, terminalId)
        .catch(() => false))
    ) {
      return { restored: false, reason: 'native_target_replaced' }
    }

    let liveMeta: {
      offset_from_bottom: number
      max_offset_from_bottom: number
      viewport_rows: number
    }
    try {
      liveMeta = await this.scrollAdapter.getScrollMetadata(
        session.paneId,
        2000
      )
    } catch {
      return { restored: false, reason: 'fetch_metadata_failed' }
    }

    // Recheck exact unchanged target/generation after async call (Guards 1 & 4)
    const currentSession = this.activeSessions.get(terminalId)
    if (
      !currentSession ||
      currentSession.generation !== generation ||
      currentSession.paneId !== session.paneId
    ) {
      return { restored: false, reason: 'generation_changed_during_restore' }
    }

    // Guard 1: preserve differing native-desktop scroll intent
    if (liveMeta.offset_from_bottom !== session.lastAppliedScrollOffset) {
      return { restored: false, reason: 'native_changed_offset_preserved' }
    }

    // Guard 2: Clamp original offset against live max_offset_from_bottom
    const originalOffset = session.initialScrollOffset ?? 0
    const targetOffset = Math.min(
      Math.max(0, originalOffset),
      Math.max(0, liveMeta.max_offset_from_bottom)
    )

    if (
      this.scrollAdapter.verifyTarget &&
      !(await this.scrollAdapter
        .verifyTarget(session.paneId, terminalId)
        .catch(() => false))
    ) {
      return { restored: false, reason: 'native_target_replaced' }
    }

    if (this.activeSessions.get(terminalId) !== session) {
      return { restored: false, reason: 'generation_changed_during_restore' }
    }

    try {
      await this.scrollAdapter.executeScroll(session.paneId, targetOffset, 2000)
      session.lastAppliedScrollOffset = undefined
      return { restored: true, offset: targetOffset }
    } catch {
      return { restored: false, reason: 'execute_scroll_failed' }
    }
  }

  public enqueueScroll(
    terminalId: string,
    generation: number,
    msg: IFitClientScrollMessage,
    options?: {
      verifyTarget?: () => Promise<boolean>
      onScrollState?: (state: ITerminalScrollState) => void
    }
  ): Promise<{ applied: boolean; offset?: number; reason?: string }> {
    const session = this.activeSessions.get(terminalId)
    if (
      !session ||
      session.generation !== generation ||
      session.status !== 'active' ||
      this.isFitBlocked(terminalId)
    ) {
      return Promise.resolve({
        applied: false,
        reason: 'inactive_or_stale_generation'
      })
    }

    if ('to' in msg && msg.to === 'latest') {
      session.pendingScrollIntent = { mode: 'latest', delta: 0 }
    } else if ('reset' in msg && msg.reset === true) {
      session.pendingScrollIntent = { mode: 'latest', delta: 0 }
    } else if ('deltaRows' in msg && typeof msg.deltaRows === 'number') {
      if (!session.pendingScrollIntent) {
        session.pendingScrollIntent = { mode: 'relative', delta: msg.deltaRows }
      } else {
        session.pendingScrollIntent.delta += msg.deltaRows
      }
    }

    if (!session.scrollDrainPromise) {
      session.scrollDrainPromise = this.drainScrollQueue(
        session,
        generation,
        options
      ).finally(() => {
        session.scrollDrainPromise = null
      })
    }

    return session.scrollDrainPromise.then(() => ({
      applied: true,
      offset: session.lastAppliedScrollOffset
    }))
  }

  private async drainScrollQueue(
    session: IFittedTerminalSession,
    generation: number,
    options?: {
      verifyTarget?: () => Promise<boolean>
      onScrollState?: (state: ITerminalScrollState) => void
    }
  ): Promise<void> {
    if (!this.scrollAdapter) {
      session.pendingScrollIntent = null
      return
    }

    while (
      session.pendingScrollIntent &&
      session.status === 'active' &&
      session.generation === generation &&
      !this.isFitBlocked(session.terminalId)
    ) {
      const intent = session.pendingScrollIntent
      session.pendingScrollIntent = null

      if (
        session.status !== 'active' ||
        session.generation !== generation ||
        this.isFitBlocked(session.terminalId)
      ) {
        return
      }

      if (options?.verifyTarget) {
        let validTarget = false
        try {
          validTarget = await options.verifyTarget()
        } catch {
          validTarget = false
        }
        if (!validTarget) {
          session.pendingScrollIntent = null
          return
        }
      }

      if (
        session.status !== 'active' ||
        session.generation !== generation ||
        this.isFitBlocked(session.terminalId)
      ) {
        return
      }

      let liveMeta: {
        offset_from_bottom: number
        max_offset_from_bottom: number
        viewport_rows: number
      }
      try {
        liveMeta = await this.scrollAdapter.getScrollMetadata(
          session.paneId,
          2000
        )
      } catch {
        return
      }

      if (
        session.status !== 'active' ||
        session.generation !== generation ||
        this.isFitBlocked(session.terminalId)
      ) {
        return
      }

      if (session.initialScrollOffset === undefined) {
        session.initialScrollOffset = Math.max(
          0,
          Math.floor(liveMeta.offset_from_bottom)
        )
      }

      const baseOffset =
        intent.mode === 'latest'
          ? 0
          : (session.lastAppliedScrollOffset ?? liveMeta.offset_from_bottom)

      const nextPending: IPendingScrollIntent | null | undefined = (
        session as any
      ).pendingScrollIntent
      if (nextPending) {
        if (nextPending.mode === 'latest') {
          continue
        } else {
          intent.delta += nextPending.delta
          session.pendingScrollIntent = null
        }
      }

      const rawTarget = baseOffset + intent.delta
      const targetOffset = Math.max(
        0,
        Math.min(liveMeta.max_offset_from_bottom, Math.floor(rawTarget))
      )

      try {
        await this.scrollAdapter.executeScroll(
          session.paneId,
          targetOffset,
          2000
        )
      } catch {
        return
      }

      if (
        session.status !== 'active' ||
        session.generation !== generation ||
        this.isFitBlocked(session.terminalId)
      ) {
        return
      }

      session.lastAppliedScrollOffset = targetOffset

      const scrollState: ITerminalScrollState = {
        offset: targetOffset,
        maxOffset: liveMeta.max_offset_from_bottom,
        viewportRows: liveMeta.viewport_rows,
        offset_from_bottom: targetOffset,
        max_offset_from_bottom: liveMeta.max_offset_from_bottom,
        viewport_rows: liveMeta.viewport_rows
      }

      if (options?.onScrollState) {
        try {
          options.onScrollState(scrollState)
        } catch {}
      }
    }
  }

  public isFitBlocked(terminalId: string): boolean {
    return this.blockedTerminals.has(terminalId)
  }

  public blockFitAdmission(terminalId: string, ownerToken?: string): string {
    const token = ownerToken ?? crypto.randomUUID()
    this.blockedTerminals.set(terminalId, token)
    return token
  }

  public unblockFitAdmission(terminalId: string, ownerToken?: string): boolean {
    if (ownerToken) {
      const existing = this.blockedTerminals.get(terminalId)
      if (existing && existing !== ownerToken) {
        return false
      }
    }
    this.blockedTerminals.delete(terminalId)
    return true
  }

  public hasActiveSession(terminalId: string): boolean {
    return this.activeSessions.has(terminalId)
  }

  public getSession(terminalId: string): IFittedTerminalSession | undefined {
    return this.activeSessions.get(terminalId)
  }

  public reserveFit(
    terminalId: string,
    paneId: string
  ):
    | { ok: true; generation: number; session: IFittedTerminalSession }
    | { ok: false; status: number; code: string; error: string } {
    if (this.blockedTerminals.has(terminalId)) {
      return {
        ok: false,
        status: 409,
        code: 'FIT_BLOCKED_BY_CONTROL',
        error:
          'Terminal fit is temporarily blocked while input control is active'
      }
    }

    const existing = this.activeSessions.get(terminalId)
    if (existing && existing.status !== 'closed') {
      return {
        ok: false,
        status: 409,
        code: 'FIT_BUSY',
        error: 'FIT_BUSY: terminal already has an active fitted viewer'
      }
    }

    const nextGen = (this.generationCounters.get(terminalId) ?? 0) + 1
    this.generationCounters.set(terminalId, nextGen)

    const session: IFittedTerminalSession = {
      terminalId,
      paneId,
      generation: nextGen,
      status: 'reserving',
      cols: DEFAULT_FIT_COLS,
      rows: DEFAULT_FIT_ROWS,
      createdAt: Date.now()
    }
    this.activeSessions.set(terminalId, session)

    return {
      ok: true,
      generation: nextGen,
      session
    }
  }

  public cancelReservation(terminalId: string, generation: number): void {
    const session = this.activeSessions.get(terminalId)
    if (
      session &&
      session.generation === generation &&
      session.status === 'reserving'
    ) {
      this.activeSessions.delete(terminalId)
    }
  }

  public registerProcess(
    terminalId: string,
    generation: number,
    proc: any
  ): boolean {
    const session = this.activeSessions.get(terminalId)
    if (!session || session.generation !== generation) {
      return false
    }
    session.proc = proc
    return true
  }

  public activateSession(
    terminalId: string,
    generation: number,
    proc: any,
    ws: any,
    cols: number,
    rows: number
  ): boolean {
    const session = this.activeSessions.get(terminalId)
    if (
      !session ||
      session.generation !== generation ||
      session.status !== 'reserving'
    ) {
      // Late activation with false: must kill child to prevent orphaned process
      if (proc) {
        try {
          proc.kill()
        } catch {}
      }
      return false
    }

    session.proc = proc
    session.ws = ws
    session.cols = cols
    session.rows = rows
    session.status = 'active'
    return true
  }

  public handleClientResize(
    terminalId: string,
    generation: number,
    cols: number,
    rows: number
  ): boolean {
    const session = this.activeSessions.get(terminalId)
    if (
      !session ||
      session.generation !== generation ||
      session.status !== 'active'
    ) {
      return false
    }

    session.cols = cols
    session.rows = rows

    if (session.proc?.stdin && typeof session.proc.stdin.write === 'function') {
      try {
        session.proc.stdin.write(
          JSON.stringify({ type: 'terminal.resize', cols, rows }) + '\n'
        )
        if (typeof session.proc.stdin.flush === 'function') {
          session.proc.stdin.flush()
        }
        return true
      } catch {
        return false
      }
    }
    return false
  }

  public retireFitProducer(
    terminalId: string,
    generation?: number
  ): Promise<{ confirmed: boolean; generation: number }> {
    const session = this.activeSessions.get(terminalId)
    if (!session) {
      return Promise.resolve({
        confirmed: true,
        generation: generation ?? 0
      })
    }

    if (typeof generation === 'number' && session.generation !== generation) {
      // Stale callback; generation fence prevents closing a newer session
      return Promise.resolve({
        confirmed: true,
        generation: session.generation
      })
    }

    const sessionGen = session.generation
    const promiseKey = `${terminalId}:${sessionGen}`
    const existing = this.activeRetirePromises.get(promiseKey)
    if (existing) {
      return existing
    }

    session.status = 'retiring'

    // Notify WS if open
    if (session.ws) {
      try {
        if (session.ws.readyState === 1) {
          session.ws.send(
            JSON.stringify({
              type: 'terminal.closed',
              reason: 'producer_retired'
            })
          )
          session.ws.close()
        }
      } catch {}
    }

    const retirePromise = (async () => {
      if (session.scrollDrainPromise) {
        try {
          await session.scrollDrainPromise
        } catch {}
      }

      try {
        await this.restoreSessionScroll(terminalId, sessionGen)
      } catch {}

      let childExited = false
      let exitTimer: any = null

      try {
        if (session.proc) {
          try {
            session.proc.kill()
          } catch {}

          if (session.proc.exited) {
            const exitPromise = session.proc.exited
              .then(() => {
                childExited = true
                if (exitTimer) {
                  clearTimeout(exitTimer)
                  exitTimer = null
                }
              })
              .catch(() => {})

            const timerPromise = new Promise((resolve) => {
              exitTimer = setTimeout(resolve, 2000)
            })

            await Promise.race([exitPromise, timerPromise])
          } else {
            childExited = true
          }
        } else {
          childExited = true
        }

        if (childExited) {
          session.status = 'closed'
          // Generation fence: only delete if still the same generation
          const current = this.activeSessions.get(terminalId)
          if (current && current.generation === sessionGen) {
            this.activeSessions.delete(terminalId)
          }
          return { confirmed: true, generation: sessionGen }
        } else {
          // Child still alive after timeout: remain in retiring status (quarantined/blocked)
          session.proc.exited
            ?.then(() => {
              session.status = 'closed'
              const current = this.activeSessions.get(terminalId)
              if (current && current.generation === sessionGen) {
                this.activeSessions.delete(terminalId)
              }
            })
            .catch(() => {})

          return { confirmed: false, generation: sessionGen }
        }
      } finally {
        if (exitTimer) {
          clearTimeout(exitTimer)
          exitTimer = null
        }
        this.activeRetirePromises.delete(promiseKey)
      }
    })()

    this.activeRetirePromises.set(promiseKey, retirePromise)
    return retirePromise
  }

  public async retireAllProducers(): Promise<
    { confirmed: boolean; generation: number }[]
  > {
    const promises: Promise<{ confirmed: boolean; generation: number }>[] = []
    for (const [terminalId, session] of this.activeSessions.entries()) {
      promises.push(this.retireFitProducer(terminalId, session.generation))
    }
    return Promise.all(promises)
  }

  public getSpawnProcess(): ISpawnTerminalFitProcess {
    return this.spawnFn
  }
}

let sharedFitManager: TerminalFitManager | null = null

export const getSharedTerminalFitManager = (options?: {
  spawnProcess?: ISpawnTerminalFitProcess
  scrollAdapter?: ITerminalFitScrollAdapter
}): TerminalFitManager => {
  if (!sharedFitManager) {
    sharedFitManager = new TerminalFitManager(options)
  } else if (options?.scrollAdapter && !sharedFitManager.getScrollAdapter()) {
    sharedFitManager.setScrollAdapter(options.scrollAdapter)
  }
  return sharedFitManager
}
