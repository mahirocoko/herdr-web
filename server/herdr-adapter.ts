import {
  HERDR_TRACKED_PROTOCOL
} from './generated/protocol.ts'
import {
  HerdrSocketError,
  executePing,
  sendRawSocketRequest
} from './herdr-socket.ts'
import { CONSERVATIVE_TOKEN_REGEX } from './security.ts'
import * as cli from './herdr-cli.ts'
import type {
  IAgentExplainManifest,
  IAgentExplainMatchedRule,
  IAgentExplainResult,
  IHerdrHealth,
  IManifestSourceKind,
  IPane,
  IPaneReadOptions,
  IPaneReadResult,
  IPaneReadSource,
  ISnapshotResult
} from './types.ts'

export type HerdrTransportMode = 'socket' | 'cli'
type RawPaneReadSource = 'detection' | 'visible' | 'recent_unwrapped'

export const parseTransportMode = (value: string | undefined): HerdrTransportMode => {
  if (value === undefined || value === '') return 'socket'
  if (value === 'socket' || value === 'cli') return value
  throw new Error(`Unsupported HERDR_TRANSPORT value: ${JSON.stringify(value)}. Expected "socket" or "cli".`)
}

export const getTransportMode = (): HerdrTransportMode => parseTransportMode(process.env.HERDR_TRANSPORT)

const assertSocketProtocol = async (timeoutMs: number): Promise<void> => {
  await executePing({ timeoutMs })
}

export const toRawPaneReadSource = (source: IPaneReadSource): RawPaneReadSource => {
  return source === 'recent-unwrapped' ? 'recent_unwrapped' : source
}

export const validatePaneExists = async (paneId: string, timeoutMs = 3000): Promise<boolean> => {
  if (getTransportMode() === 'cli') {
    const snap = await cli.getHerdrSnapshot(timeoutMs)
    return cli.validatePaneInSnapshot(snap, paneId)
  }

  await assertSocketProtocol(timeoutMs)

  try {
    await sendRawSocketRequest<{ type: string; pane: IPane }>(
      'pane.get',
      { pane_id: paneId },
      { timeoutMs }
    )
    return true
  } catch (err) {
    if (err instanceof HerdrSocketError && err.code === 'pane_not_found') {
      return false
    }
    throw err
  }
}

export const getHerdrHealth = async (timeoutMs = 3000): Promise<IHerdrHealth> => {
  if (getTransportMode() === 'cli') {
    return cli.getHerdrHealth(timeoutMs)
  }

  const now = new Date().toISOString()
  try {
    const ping = await executePing({ timeoutMs })
    return {
      ok: true,
      version: ping.version || 'unknown',
      serverStatus: 'running',
      herdrOk: true,
      timestamp: now
    }
  } catch (err) {
    return {
      ok: false,
      version: 'unknown',
      serverStatus: 'unreachable',
      herdrOk: false,
      timestamp: now
    }
  }
}

export const getHerdrSnapshot = async (timeoutMs = 5000): Promise<ISnapshotResult> => {
  if (getTransportMode() === 'cli') {
    return cli.getHerdrSnapshot(timeoutMs)
  }

  const res = await sendRawSocketRequest<any>('session.snapshot', {}, { timeoutMs })
  const snapshot: ISnapshotResult = (res && typeof res === 'object' && 'snapshot' in res && res.snapshot)
    ? res.snapshot
    : res

  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Herdr session.snapshot returned an invalid or empty snapshot payload')
  }

  if (snapshot.protocol !== HERDR_TRACKED_PROTOCOL) {
    throw new Error(
      `Protocol mismatch in session.snapshot: expected ${HERDR_TRACKED_PROTOCOL}, got ${snapshot.protocol}. Failing closed.`
    )
  }

  return snapshot
}

export const executePrompt = async (
  paneId: string,
  text: string,
  timeoutMs = 5000
): Promise<{ ok: boolean; output: string }> => {
  if (getTransportMode() === 'cli') {
    return cli.executePrompt(paneId, text, timeoutMs)
  }

  const exists = await validatePaneExists(paneId, 3000)
  if (!exists) {
    throw new HerdrSocketError('pane_not_found', `Pane "${paneId}" does not exist in the active Herdr session`)
  }

  // Raw socket agent.prompt without wait
  await sendRawSocketRequest(
    'agent.prompt',
    {
      target: paneId,
      text
    },
    { timeoutMs }
  )

  return {
    ok: true,
    output: ''
  }
}

export const executeKeys = async (
  paneId: string,
  keys: string[],
  timeoutMs = 5000
): Promise<{ ok: boolean; output: string }> => {
  if (getTransportMode() === 'cli') {
    return cli.executeKeys(paneId, keys, timeoutMs)
  }

  const exists = await validatePaneExists(paneId, 3000)
  if (!exists) {
    throw new HerdrSocketError('pane_not_found', `Pane "${paneId}" does not exist in the active Herdr session`)
  }

  await sendRawSocketRequest(
    'pane.send_keys',
    {
      pane_id: paneId,
      keys
    },
    { timeoutMs }
  )

  return {
    ok: true,
    output: ''
  }
}

export const executeTerminalInput = async (
  paneId: string,
  text: string,
  timeoutMs = 5000
): Promise<{ ok: boolean; output: string }> => {
  if (getTransportMode() === 'cli') {
    return cli.executeTerminalInput(paneId, text, timeoutMs)
  }

  const exists = await validatePaneExists(paneId, 3000)
  if (!exists) {
    throw new HerdrSocketError('pane_not_found', `Pane "${paneId}" does not exist in the active Herdr session`)
  }

  // Atomically brackets text + Enter in pane.send_input
  await sendRawSocketRequest(
    'pane.send_input',
    {
      pane_id: paneId,
      text,
      keys: ['Enter']
    },
    { timeoutMs }
  )

  return {
    ok: true,
    output: ''
  }
}

export const readPaneContent = async (
  paneId: string,
  options: IPaneReadOptions = {},
  timeoutMs = 5000
): Promise<IPaneReadResult> => {
  if (getTransportMode() === 'cli') {
    return cli.readPaneContent(paneId, options, timeoutMs)
  }

  const exists = await validatePaneExists(paneId, 3000)
  if (!exists) {
    throw new HerdrSocketError('pane_not_found', `Pane "${paneId}" does not exist in the active Herdr session`)
  }

  const source: IPaneReadSource = options.source || 'detection'
  const params: Record<string, unknown> = {
    pane_id: paneId,
    source: toRawPaneReadSource(source),
    format: 'text',
    strip_ansi: true
  }
  if (options.lines !== undefined) {
    params.lines = options.lines
  }

  const res = await sendRawSocketRequest<any>('pane.read', params, { timeoutMs })
  const content = res?.read?.text ?? res?.text ?? ''

  return {
    ok: true,
    paneId,
    source,
    content
  }
}

// Stream observer remains CLI subprocess and is the one intentional CLI transport in socket mode
export const spawnObserverProcess = cli.spawnObserverProcess
export const validatePaneInSnapshot = cli.validatePaneInSnapshot

const CONSERVATIVE_TOKEN_PATTERN = /^[a-zA-Z0-9_.:-]+$/
const CONSERVATIVE_REGION_PATTERN = /^[a-zA-Z0-9_.:-]+(?:\([0-9]{1,4}\))?$/

export const sanitizeConservativeToken = (val: unknown, maxLen = 128): string | undefined => {
  if (typeof val !== 'string') return undefined
  if (val.length === 0 || val.length > maxLen) return undefined
  if (val.includes('.sock') || val.includes('..') || val.includes('/') || val.includes('\\') || val.includes('~')) return undefined
  return CONSERVATIVE_TOKEN_PATTERN.test(val) ? val : undefined
}

export const sanitizeConservativeRegion = (val: unknown, maxLen = 64): string | undefined => {
  if (typeof val !== 'string') return undefined
  if (val.length === 0 || val.length > maxLen) return undefined
  if (val.includes('.sock') || val.includes('..') || val.includes('/') || val.includes('\\') || val.includes('~')) return undefined
  return CONSERVATIVE_REGION_PATTERN.test(val) ? val : undefined
}

export const projectAgentExplain = (paneId: string, raw: any): IAgentExplainResult => {
  const explain = (raw && typeof raw === 'object' && 'explain' in raw && raw.explain)
    ? raw.explain
    : raw

  if (!explain || typeof explain !== 'object') {
    return {
      ok: true,
      paneId,
      available: false,
      reason: 'no-agent'
    }
  }

  const agent = sanitizeConservativeToken(explain.agent, 64) || 'unknown'
  const state = sanitizeConservativeToken(explain.state, 32) || 'unknown'

  let matchedRule: IAgentExplainMatchedRule | undefined
  if (explain.matched_rule && typeof explain.matched_rule === 'object') {
    const id = sanitizeConservativeToken(explain.matched_rule.id, 128)
    const region = sanitizeConservativeRegion(explain.matched_rule.region, 64)
    const ruleState = sanitizeConservativeToken(explain.matched_rule.state, 32)
    if (id && region && ruleState) {
      matchedRule = { id, region, state: ruleState }
    }
  }

  let sourceKind: IManifestSourceKind = 'unknown'
  const rawSource = typeof explain.manifest_source === 'string' ? explain.manifest_source : ''
  if (rawSource.startsWith('remote:') || explain.source_kind === 'remote') {
    sourceKind = 'remote'
  } else if (rawSource.startsWith('local:') || explain.source_kind === 'local') {
    sourceKind = 'local'
  } else if (rawSource.startsWith('builtin:') || rawSource === 'builtin' || explain.source_kind === 'builtin') {
    sourceKind = 'builtin'
  }

  const rawVersion = explain.manifest_version || (sourceKind === 'remote' ? explain.cached_remote_version : undefined)
  const manifestVersion = sanitizeConservativeToken(rawVersion, 64)
  const manifest: IAgentExplainManifest = {
    sourceKind,
    ...(manifestVersion ? { version: manifestVersion } : {})
  }

  const result: IAgentExplainResult = {
    ok: true,
    paneId,
    available: true,
    agent,
    state,
    ...(matchedRule ? { matchedRule } : {}),
    manifest,
    ...(explain.visible_blocker === true ? { visibleBlocker: true } : {}),
    ...(explain.visible_idle === true ? { visibleIdle: true } : {}),
    ...(explain.visible_working === true ? { visibleWorking: true } : {}),
    ...(explain.screen_detection_skipped === true ? { screenDetectionSkipped: true } : {}),
    ...((explain.skip_state_update === true || explain.state_update_skipped === true) ? { stateUpdateSkipped: true } : {})
  }

  return result
}

export const getAgentExplain = async (
  paneId: string,
  timeoutMs = 5000
): Promise<IAgentExplainResult> => {
  if (getTransportMode() === 'cli') {
    const res = await cli.getAgentExplain(paneId, timeoutMs)
    if (res.noAgent) {
      return {
        ok: true,
        paneId,
        available: false,
        reason: 'no-agent'
      }
    }
    return projectAgentExplain(paneId, res.raw)
  }

  // Socket mode: assert protocol first
  const exists = await validatePaneExists(paneId, 3000)
  if (!exists) {
    throw new HerdrSocketError('pane_not_found', `Pane "${paneId}" does not exist in the active Herdr session`)
  }

  try {
    const res = await sendRawSocketRequest<any>(
      'agent.explain',
      { target: paneId },
      { timeoutMs }
    )
    return projectAgentExplain(paneId, res)
  } catch (err) {
    if (err instanceof HerdrSocketError && (err.code === 'agent_not_found' || err.code === 'no_agent')) {
      return {
        ok: true,
        paneId,
        available: false,
        reason: 'no-agent'
      }
    }
    throw err
  }
}

export interface ITabCreateExecutionResult {
  ok: boolean
  status?: number
  error?: string
  outcome?: 'observed' | 'rejected' | 'unknown'
  result?: {
    tabId: string
    paneId: string
  }
}

export const executeTabCreate = async (
  workspaceId: string,
  target: { paneId: string; terminalId: string },
  label?: string,
  options: {
    timeoutMs?: number
    preSnapshot?: ISnapshotResult
    deps?: {
      fetchSnapshot?: (timeoutMs?: number) => Promise<ISnapshotResult>
      sendSocketRequest?: <T>(method: string, params: Record<string, unknown>, opts?: { timeoutMs?: number }) => Promise<T>
    }
  } = {}
): Promise<ITabCreateExecutionResult> => {
  if (getTransportMode() === 'cli') {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: 'Tab creation is unavailable in CLI transport mode; socket transport is required.'
    }
  }

  const timeoutMs = options.timeoutMs ?? 5000
  const fetchSnapshot = options.deps?.fetchSnapshot ?? getHerdrSnapshot
  const sendRequest = options.deps?.sendSocketRequest ?? sendRawSocketRequest

  // 1. Authoritative preflight snapshot (reuse if passed from route to avoid redundant fetch)
  let preSnapshot: ISnapshotResult
  try {
    preSnapshot = options.preSnapshot ?? await fetchSnapshot(3000)
  } catch (err) {
    return {
      ok: false,
      status: 502,
      outcome: 'rejected',
      error: `Failed to fetch snapshot before tab creation: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  const prePanes = preSnapshot.panes || []
  const sourcePane = prePanes.find((p) => p && p.pane_id === target.paneId)
  if (!sourcePane) {
    return {
      ok: false,
      status: 404,
      outcome: 'rejected',
      error: `Pane "${target.paneId}" not found in active session`
    }
  }

  if (sourcePane.terminal_id !== target.terminalId) {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: `Terminal replacement detected: pane "${target.paneId}" terminal is "${sourcePane.terminal_id ?? ''}", expected "${target.terminalId}"`
    }
  }

  if (sourcePane.workspace_id !== workspaceId) {
    return {
      ok: false,
      status: 400,
      outcome: 'rejected',
      error: `Source pane "${target.paneId}" does not belong to workspace "${workspaceId}" (belongs to "${sourcePane.workspace_id}")`
    }
  }

  const derivedCwd = sourcePane.foreground_cwd || sourcePane.cwd

  // Hardcoded focus: false, no env, no arbitrary cwd path
  const createParams: Record<string, unknown> = {
    workspace_id: workspaceId,
    cwd: derivedCwd,
    focus: false
  }
  if (label && label.trim().length > 0) {
    createParams.label = label.trim()
  }

  // 2. Send tab.create RPC
  let rpcResponse: any
  let sendError: unknown | null = null
  try {
    rpcResponse = await sendRequest<any>('tab.create', createParams, { timeoutMs })
  } catch (err) {
    sendError = err
  }

  // If send threw: only a proven explicit pre-dispatch daemon rejection may be rejected; when uncertain, unknown
  if (sendError) {
    if (sendError instanceof HerdrSocketError && (sendError.code === 'invalid_params' || sendError.code === 'unauthorized')) {
      return {
        ok: false,
        status: 400,
        outcome: 'rejected',
        error: sendError.message
      }
    }
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Tab creation outcome unknown: operation may have timed out or resulted in ambiguous state'
    }
  }

  // 3. Correlated response identity extraction and validation
  if (!rpcResponse || typeof rpcResponse !== 'object' || rpcResponse.type !== 'tab_created') {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Tab creation outcome unknown: invalid or malformed response from daemon (expected type "tab_created")'
    }
  }

  const returnedTab = rpcResponse.tab
  const returnedTabId: string | null =
    typeof returnedTab?.tab_id === 'string'
      ? returnedTab.tab_id
      : typeof rpcResponse.tab_id === 'string'
        ? rpcResponse.tab_id
        : null

  const returnedWorkspaceId: string | null =
    typeof returnedTab?.workspace_id === 'string'
      ? returnedTab.workspace_id
      : typeof rpcResponse.workspace_id === 'string'
        ? rpcResponse.workspace_id
        : null

  if (
    !returnedTabId ||
    !CONSERVATIVE_TOKEN_REGEX.test(returnedTabId) ||
    returnedWorkspaceId !== workspaceId
  ) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Tab creation outcome unknown: response did not include valid correlated tab identity for requested workspace'
    }
  }

  let returnedRootPaneId: string | null = null
  if (typeof rpcResponse.root_pane === 'string') {
    returnedRootPaneId = rpcResponse.root_pane
  } else if (rpcResponse.root_pane && typeof rpcResponse.root_pane === 'object' && typeof rpcResponse.root_pane.pane_id === 'string') {
    returnedRootPaneId = rpcResponse.root_pane.pane_id
  }

  // 4. Post-creation authoritative snapshot verification (strictly searching correlated ID)
  let postSnapshot: ISnapshotResult
  try {
    postSnapshot = await fetchSnapshot(3000)
  } catch {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Tab creation outcome unknown: failed to fetch post-creation snapshot'
    }
  }

  const tabs = postSnapshot.tabs || []
  const exactTab = tabs.find((t) => t && t.tab_id === returnedTabId && t.workspace_id === workspaceId)
  if (!exactTab) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: `Tab creation outcome unknown: correlated tab "${returnedTabId}" not found in post-creation snapshot`
    }
  }

  const panes = postSnapshot.panes || []
  const tabPanes = panes.filter(
    (p) => p && p.tab_id === returnedTabId && p.terminal_id && p.terminal_id.trim().length > 0
  )

  if (returnedRootPaneId) {
    // Validate tab relation and use exact pane ID
    const rootPaneMatch = tabPanes.find((p) => p.pane_id === returnedRootPaneId)
    if (!rootPaneMatch) {
      return {
        ok: false,
        status: 504,
        outcome: 'unknown',
        error: `Tab creation outcome unknown: returned root pane "${returnedRootPaneId}" does not match tab "${returnedTabId}" in post-creation snapshot`
      }
    }

    return {
      ok: true,
      status: 200,
      outcome: 'observed',
      result: {
        tabId: returnedTabId,
        paneId: returnedRootPaneId
      }
    }
  }

  // Tab-only identity: post-snapshot may return success only when exact tab has exactly one current terminal-backed pane
  if (tabPanes.length === 1) {
    return {
      ok: true,
      status: 200,
      outcome: 'observed',
      result: {
        tabId: returnedTabId,
        paneId: tabPanes[0].pane_id
      }
    }
  }

  return {
    ok: false,
    status: 504,
    outcome: 'unknown',
    error: `Tab creation outcome unknown: tab "${returnedTabId}" has ${tabPanes.length} terminal panes, expected exactly 1`
  }
}
