import type { IHerdrHealth, IPaneReadResult, IPaneReadSource, ISnapshotResult } from './types.ts'

export interface ICommandResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
}

const PANE_READ_SOURCES = new Set<IPaneReadSource>([
  'detection',
  'visible',
  'recent-unwrapped'
])

export const buildTerminalInputArgv = (paneId: string, text: string): string[] => {
  return ['herdr', 'pane', 'run', paneId, text]
}

export const buildPaneReadArgv = (
  paneId: string,
  options: IPaneReadOptions = {}
): string[] => {
  const source = options.source || 'detection'
  if (!PANE_READ_SOURCES.has(source)) {
    throw new Error(`Unsupported pane read source: ${source}`)
  }
  if (options.lines !== undefined && (!Number.isInteger(options.lines) || options.lines < 1 || options.lines > 1000)) {
    throw new Error('Pane read lines must be an integer between 1 and 1000')
  }

  const argv = ['herdr', 'pane', 'read', paneId, '--source', source, '--format', 'text']
  if (options.lines !== undefined) {
    argv.push('--lines', String(options.lines))
  }
  return argv
}

export const runBoundedCommand = async (
  argv: string[],
  timeoutMs = 5000
): Promise<ICommandResult> => {
  const proc = Bun.spawn(argv, {
    stdout: 'pipe',
    stderr: 'pipe'
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      proc.kill()
    } catch {}
  }, timeoutMs)

  try {
    const [stdoutBytes, stderrBytes] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).arrayBuffer()
    ])

    const exitCode = await proc.exited
    clearTimeout(timer)

    const stdout = new TextDecoder().decode(stdoutBytes)
    const stderr = new TextDecoder().decode(stderrBytes)

    if (timedOut) {
      return {
        ok: false,
        code: -1,
        stdout: '',
        stderr: `Command timed out after ${timeoutMs}ms: ${argv.join(' ')}`
      }
    }

    return {
      ok: exitCode === 0,
      code: exitCode,
      stdout,
      stderr
    }
  } catch (err) {
    clearTimeout(timer)
    try {
      proc.kill()
    } catch {}
    return {
      ok: false,
      code: -1,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err)
    }
  }
}

export const getHerdrHealth = async (timeoutMs = 3000): Promise<IHerdrHealth> => {
  const result = await runBoundedCommand(['herdr', 'status'], timeoutMs)
  const now = new Date().toISOString()

  if (!result.ok) {
    return {
      ok: false,
      version: 'unknown',
      serverStatus: 'unreachable',
      herdrOk: false,
      timestamp: now
    }
  }

  const lines = result.stdout.split('\n')
  let version = 'unknown'
  let serverStatus = 'unknown'

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('version:')) {
      version = trimmed.replace('version:', '').trim()
    } else if (trimmed.startsWith('status:')) {
      serverStatus = trimmed.replace('status:', '').trim()
    }
  }

  const isServerRunning = serverStatus.toLowerCase() === 'running'

  return {
    ok: isServerRunning,
    version,
    serverStatus,
    herdrOk: isServerRunning,
    timestamp: now
  }
}

export const getHerdrSnapshot = async (timeoutMs = 5000): Promise<ISnapshotResult> => {
  const result = await runBoundedCommand(['herdr', 'api', 'snapshot'], timeoutMs)

  if (!result.ok) {
    throw new Error(
      `Failed to capture Herdr snapshot (exit code ${result.code}): ${result.stderr.trim() || 'Unknown error'}`
    )
  }

  try {
    const parsed = JSON.parse(result.stdout)
    const res = parsed.result
    if (!res || typeof res !== 'object') {
      throw new Error('Snapshot envelope does not contain valid "result" object')
    }
    const snapshot = (res.snapshot && typeof res.snapshot === 'object') ? res.snapshot : res
    return snapshot as ISnapshotResult
  } catch (parseErr) {
    throw new Error(
      `Invalid JSON received from Herdr snapshot: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`
    )
  }
}

export const validatePaneInSnapshot = (snapshot: ISnapshotResult, paneId: string): boolean => {
  if (!snapshot.panes || !Array.isArray(snapshot.panes)) {
    return false
  }
  return snapshot.panes.some((p) => p.pane_id === paneId)
}

export const executePrompt = async (
  paneId: string,
  text: string,
  timeoutMs = 5000
): Promise<{ ok: boolean; output: string }> => {
  // Validate pane against a fresh snapshot first
  const snapshot = await getHerdrSnapshot(3000)
  if (!validatePaneInSnapshot(snapshot, paneId)) {
    throw new Error(`Pane "${paneId}" does not exist in the active Herdr session`)
  }

  // herdr agent prompt <paneId> <text> (without --wait)
  const result = await runBoundedCommand(['herdr', 'agent', 'prompt', paneId, text], timeoutMs)
  if (!result.ok) {
    throw new Error(`Agent prompt execution failed: ${result.stderr.trim() || result.stdout.trim() || 'Unknown error'}`)
  }

  return {
    ok: true,
    output: result.stdout.trim()
  }
}

export const executeKeys = async (
  paneId: string,
  keys: string[],
  timeoutMs = 5000
): Promise<{ ok: boolean; output: string }> => {
  // Validate pane against a fresh snapshot first
  const snapshot = await getHerdrSnapshot(3000)
  if (!validatePaneInSnapshot(snapshot, paneId)) {
    throw new Error(`Pane "${paneId}" does not exist in the active Herdr session`)
  }

  // herdr pane send-keys <paneId> <key>...
  const result = await runBoundedCommand(['herdr', 'pane', 'send-keys', paneId, ...keys], timeoutMs)
  if (!result.ok) {
    throw new Error(`Send keys execution failed: ${result.stderr.trim() || result.stdout.trim() || 'Unknown error'}`)
  }

  return {
    ok: true,
    output: result.stdout.trim()
  }
}

export const executeTerminalInput = async (
  paneId: string,
  text: string,
  timeoutMs = 5000
): Promise<{ ok: boolean; output: string }> => {
  // Validate pane against a fresh snapshot first
  const snapshot = await getHerdrSnapshot(3000)
  if (!validatePaneInSnapshot(snapshot, paneId)) {
    throw new Error(`Pane "${paneId}" does not exist in the active Herdr session`)
  }

  const result = await runBoundedCommand(buildTerminalInputArgv(paneId, text), timeoutMs)
  if (!result.ok) {
    throw new Error(`Terminal input execution failed: ${result.stderr.trim() || result.stdout.trim() || 'Unknown error'}`)
  }

  return {
    ok: true,
    output: result.stdout.trim()
  }
}

export interface IPaneReadOptions {
  source?: IPaneReadSource
  lines?: number
}

export const readPaneContent = async (
  paneId: string,
  options: IPaneReadOptions = {},
  timeoutMs = 5000
): Promise<IPaneReadResult> => {
  // Validate pane against a fresh snapshot first
  const snapshot = await getHerdrSnapshot(3000)
  if (!validatePaneInSnapshot(snapshot, paneId)) {
    throw new Error(`Pane "${paneId}" does not exist in the active Herdr session`)
  }

  const source: IPaneReadSource = options.source || 'detection'
  const argv = buildPaneReadArgv(paneId, options)

  const result = await runBoundedCommand(argv, timeoutMs)
  if (!result.ok) {
    throw new Error(`Pane read execution failed: ${result.stderr.trim() || result.stdout.trim() || 'Unknown error'}`)
  }

  return {
    ok: true,
    paneId,
    source,
    content: result.stdout
  }
}

export const spawnObserverProcess = (paneId: string, cols: number, rows: number) => {
  return Bun.spawn(['herdr', 'terminal', 'session', 'observe', paneId, '--cols', String(cols), '--rows', String(rows)], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
}

export const buildAgentExplainArgv = (paneId: string): string[] => {
  return ['herdr', 'agent', 'explain', paneId, '--json']
}

export const getAgentExplain = async (
  paneId: string,
  timeoutMs = 5000
): Promise<{ raw?: any; noAgent?: boolean }> => {
  // Validate pane against a fresh snapshot first
  const snapshot = await getHerdrSnapshot(3000)
  if (!validatePaneInSnapshot(snapshot, paneId)) {
    throw new Error(`Pane "${paneId}" does not exist in the active Herdr session`)
  }

  const argv = buildAgentExplainArgv(paneId)
  const result = await runBoundedCommand(argv, timeoutMs)

  if (!result.ok) {
    try {
      const text = (result.stdout.trim() || result.stderr.trim())
      const parsedErr = JSON.parse(text)
      const errCode = parsedErr?.error?.code || parsedErr?.code
      if (errCode === 'agent_not_found' || errCode === 'no_agent') {
        return { noAgent: true }
      }
    } catch {}

    const combinedOutput = `${result.stderr} ${result.stdout}`
    if (
      /\b(?:agent_not_found|no_agent)\b/.test(combinedOutput) &&
      !combinedOutput.includes('pane_not_found')
    ) {
      return { noAgent: true }
    }

    throw new Error(`Agent explain execution failed: ${result.stderr.trim() || result.stdout.trim() || 'Unknown error'}`)
  }

  try {
    const raw = JSON.parse(result.stdout)
    return { raw }
  } catch (err) {
    throw new Error(`Invalid JSON received from Herdr agent explain: ${err instanceof Error ? err.message : String(err)}`)
  }
}
