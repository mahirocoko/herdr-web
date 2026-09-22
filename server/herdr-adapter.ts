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
  ISnapshotResult,
  ITabCloseExecutionResult,
  ITabCloseTargetIdentity,
  ITabCreateExecutionResult,
  IWorkspaceCloseExecutionResult,
  IWorkspaceCloseTargetIdentity,
  IWorkspaceCreateExecutionResult,
  IWorkspaceCreateSource
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

  if (!Array.isArray(snapshot.workspaces) || !Array.isArray(snapshot.tabs) || !Array.isArray(snapshot.panes)) {
    throw new Error('Herdr session.snapshot returned malformed topology: workspaces, tabs, and panes must be arrays')
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

type RawSocketRequester = (
  method: string,
  params: Record<string, unknown>,
  opts?: { timeoutMs?: number }
) => Promise<unknown>

const hasSnapshotArrays = (snapshot: ISnapshotResult): boolean =>
  Array.isArray(snapshot.workspaces) && Array.isArray(snapshot.tabs) && Array.isArray(snapshot.panes)

const collectCanonicalMembership = <T>(
  values: T[],
  belongsToTarget: (value: T) => boolean,
  getId: (value: T) => unknown
): { ids?: string[]; error?: string } => {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (!value || typeof value !== 'object' || !belongsToTarget(value)) continue
    const id = getNonEmptyString(getId(value))
    if (!id) return { error: 'Target membership contains a missing or malformed ID' }
    if (seen.has(id)) return { error: `Target membership contains duplicate ID "${id}"` }
    seen.add(id)
    ids.push(id)
  }
  ids.sort()
  return { ids }
}

const exactIdSetsMatch = (expected: string[], current: string[]): boolean => {
  if (expected.length !== current.length) return false
  const normalizedExpected = [...expected].sort()
  const normalizedCurrent = [...current].sort()
  return normalizedExpected.every((id, index) => id === normalizedCurrent[index])
}

const validateCloseSnapshotTopology = (snapshot: ISnapshotResult): string | null => {
  const specifications: Array<{
    kind: string
    values: unknown[]
    idKey: string
    relationKeys: string[]
  }> = [
    { kind: 'workspace', values: snapshot.workspaces, idKey: 'workspace_id', relationKeys: [] },
    { kind: 'tab', values: snapshot.tabs, idKey: 'tab_id', relationKeys: ['workspace_id'] },
    { kind: 'pane', values: snapshot.panes, idKey: 'pane_id', relationKeys: ['workspace_id', 'tab_id'] }
  ]
  for (const specification of specifications) {
    const seen = new Set<string>()
    for (const value of specification.values) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return `${specification.kind} topology contains a malformed entry`
      }
      const record = value as Record<string, unknown>
      const id = getNonEmptyString(record[specification.idKey])
      if (!id) return `${specification.kind} topology contains a missing or malformed ${specification.idKey}`
      if (seen.has(id)) return `${specification.kind} topology contains duplicate ID "${id}"`
      seen.add(id)
      for (const relationKey of specification.relationKeys) {
        if (!getNonEmptyString(record[relationKey])) {
          return `${specification.kind} topology contains a missing or malformed ${relationKey}`
        }
      }
    }
  }
  return null
}

const getNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const isExactOkResponse = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.type === 'ok' && Object.keys(record).length === 1
}

const AGENT_STATUSES = new Set(['idle', 'working', 'blocked', 'done', 'unknown'])

const isUnsignedInteger = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const isWorkspaceInfoShape = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const workspace = value as Record<string, unknown>
  return (
    typeof workspace.workspace_id === 'string' &&
    isUnsignedInteger(workspace.number) &&
    typeof workspace.label === 'string' &&
    typeof workspace.focused === 'boolean' &&
    isUnsignedInteger(workspace.pane_count) &&
    isUnsignedInteger(workspace.tab_count) &&
    typeof workspace.active_tab_id === 'string' &&
    typeof workspace.agent_status === 'string' &&
    AGENT_STATUSES.has(workspace.agent_status)
  )
}

const isTabInfoShape = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const tab = value as Record<string, unknown>
  return (
    typeof tab.tab_id === 'string' &&
    typeof tab.workspace_id === 'string' &&
    isUnsignedInteger(tab.number) &&
    typeof tab.label === 'string' &&
    typeof tab.focused === 'boolean' &&
    isUnsignedInteger(tab.pane_count) &&
    typeof tab.agent_status === 'string' &&
    AGENT_STATUSES.has(tab.agent_status)
  )
}

const isPaneInfoShape = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const pane = value as Record<string, unknown>
  return (
    typeof pane.pane_id === 'string' &&
    typeof pane.terminal_id === 'string' &&
    typeof pane.workspace_id === 'string' &&
    typeof pane.tab_id === 'string' &&
    typeof pane.focused === 'boolean' &&
    typeof pane.agent_status === 'string' &&
    AGENT_STATUSES.has(pane.agent_status) &&
    isUnsignedInteger(pane.revision)
  )
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
      sendSocketRequest?: RawSocketRequester
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

  if (!hasSnapshotArrays(preSnapshot)) {
    return {
      ok: false,
      status: 502,
      outcome: 'rejected',
      error: 'Failed to validate snapshot before tab creation: workspaces, tabs, and panes must be arrays'
    }
  }

  const sourcePanes = preSnapshot.panes.filter((pane) => pane && pane.pane_id === target.paneId)
  if (sourcePanes.length === 0) {
    return {
      ok: false,
      status: 404,
      outcome: 'rejected',
      error: `Pane "${target.paneId}" not found in active session`
    }
  }
  if (sourcePanes.length !== 1) {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: `Ambiguous duplicate pane ID "${target.paneId}" in active session`
    }
  }
  const sourcePane = sourcePanes[0]

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

  const derivedCwd = getNonEmptyString(sourcePane.foreground_cwd) ?? getNonEmptyString(sourcePane.cwd)
  if (!derivedCwd) {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: `Source pane "${target.paneId}" has no usable current working directory`
    }
  }

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
    rpcResponse = await sendRequest('tab.create', createParams, { timeoutMs })
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

  if (!hasSnapshotArrays(postSnapshot)) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Tab creation outcome unknown: post-creation snapshot is malformed'
    }
  }

  const exactTabs = postSnapshot.tabs.filter((tab) => tab && tab.tab_id === returnedTabId)
  if (exactTabs.length !== 1 || exactTabs[0].workspace_id !== workspaceId) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: exactTabs.length > 1
        ? `Tab creation outcome unknown: duplicate correlated tab ID "${returnedTabId}" in post-creation snapshot`
        : `Tab creation outcome unknown: correlated tab "${returnedTabId}" not found in post-creation snapshot`
    }
  }

  const tabPanes = postSnapshot.panes.filter(
    (p) => p && p.tab_id === returnedTabId && p.terminal_id && p.terminal_id.trim().length > 0
  )

  if (returnedRootPaneId) {
    const rootPaneMatches = postSnapshot.panes.filter((pane) => pane && pane.pane_id === returnedRootPaneId)
    const rootPaneMatch = rootPaneMatches.length === 1 ? rootPaneMatches[0] : undefined
    if (
      !rootPaneMatch ||
      rootPaneMatch.tab_id !== returnedTabId ||
      rootPaneMatch.workspace_id !== workspaceId ||
      !getNonEmptyString(rootPaneMatch.terminal_id)
    ) {
      return {
        ok: false,
        status: 504,
        outcome: 'unknown',
        error: rootPaneMatches.length > 1
          ? `Tab creation outcome unknown: duplicate returned root pane ID "${returnedRootPaneId}" in post-creation snapshot`
          : `Tab creation outcome unknown: returned root pane "${returnedRootPaneId}" does not match tab "${returnedTabId}" in post-creation snapshot`
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

export const executeWorkspaceCreate = async (
  label?: string,
  source?: IWorkspaceCreateSource,
  options: {
    timeoutMs?: number
    preSnapshot?: ISnapshotResult
    deps?: {
      fetchSnapshot?: (timeoutMs?: number) => Promise<ISnapshotResult>
      sendSocketRequest?: RawSocketRequester
    }
  } = {}
): Promise<IWorkspaceCreateExecutionResult> => {
  if (getTransportMode() === 'cli') {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: 'Workspace creation is unavailable in CLI transport mode; socket transport is required.'
    }
  }

  const timeoutMs = options.timeoutMs ?? 5000
  const fetchSnapshot = options.deps?.fetchSnapshot ?? getHerdrSnapshot
  const sendRequest = options.deps?.sendSocketRequest ?? sendRawSocketRequest

  // 1. Authoritative preflight snapshot
  let preSnapshot: ISnapshotResult
  try {
    preSnapshot = options.preSnapshot ?? await fetchSnapshot(3000)
  } catch (err) {
    return {
      ok: false,
      status: 502,
      outcome: 'rejected',
      error: `Failed to fetch snapshot before workspace creation: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  if (!hasSnapshotArrays(preSnapshot)) {
    return {
      ok: false,
      status: 502,
      outcome: 'rejected',
      error: 'Failed to validate snapshot before workspace creation: workspaces, tabs, and panes must be arrays'
    }
  }

  let derivedCwd: string | undefined
  if (source) {
    const sourceWorkspaces = preSnapshot.workspaces.filter((workspace) => workspace && workspace.workspace_id === source.workspaceId)
    if (sourceWorkspaces.length === 0) {
      return {
        ok: false,
        status: 404,
        outcome: 'rejected',
        error: `Workspace "${source.workspaceId}" not found in active session`
      }
    }
    if (sourceWorkspaces.length !== 1) {
      return {
        ok: false,
        status: 409,
        outcome: 'rejected',
        error: `Ambiguous duplicate workspace ID "${source.workspaceId}" in active session`
      }
    }

    const sourcePanes = preSnapshot.panes.filter((pane) => pane && pane.pane_id === source.paneId)
    if (sourcePanes.length === 0) {
      return {
        ok: false,
        status: 404,
        outcome: 'rejected',
        error: `Pane "${source.paneId}" not found in active session`
      }
    }
    if (sourcePanes.length !== 1) {
      return {
        ok: false,
        status: 409,
        outcome: 'rejected',
        error: `Ambiguous duplicate pane ID "${source.paneId}" in active session`
      }
    }
    const sourcePane = sourcePanes[0]

    if (sourcePane.terminal_id !== source.terminalId) {
      return {
        ok: false,
        status: 409,
        outcome: 'rejected',
        error: `Terminal replacement detected: pane "${source.paneId}" terminal is "${sourcePane.terminal_id ?? ''}", expected "${source.terminalId}"`
      }
    }

    if (sourcePane.workspace_id !== source.workspaceId) {
      return {
        ok: false,
        status: 400,
        outcome: 'rejected',
        error: `Source pane "${source.paneId}" does not belong to workspace "${source.workspaceId}" (belongs to "${sourcePane.workspace_id}")`
      }
    }

    derivedCwd = getNonEmptyString(sourcePane.foreground_cwd) ?? getNonEmptyString(sourcePane.cwd)
    if (!derivedCwd) {
      return {
        ok: false,
        status: 409,
        outcome: 'rejected',
        error: `Source pane "${source.paneId}" has no usable current working directory`
      }
    }
  }

  // Hardcoded focus: false, no browser env/cwd/focus
  const createParams: Record<string, unknown> = {
    focus: false
  }
  if (label && label.trim().length > 0) {
    createParams.label = label.trim()
  }
  if (derivedCwd) {
    createParams.cwd = derivedCwd
  }

  // 2. Send workspace.create RPC
  let rpcResponse: any
  let sendError: unknown | null = null
  try {
    rpcResponse = await sendRequest('workspace.create', createParams, { timeoutMs })
  } catch (err) {
    sendError = err
  }

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
      error: 'Workspace creation outcome unknown: operation may have timed out or resulted in ambiguous state'
    }
  }

  // 3. Correlated response identity extraction and internal consistency validation
  if (!rpcResponse || typeof rpcResponse !== 'object' || rpcResponse.type !== 'workspace_created') {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Workspace creation outcome unknown: invalid or malformed response from daemon (expected type "workspace_created")'
    }
  }

  if (
    !isWorkspaceInfoShape(rpcResponse.workspace) ||
    !isTabInfoShape(rpcResponse.tab) ||
    !isPaneInfoShape(rpcResponse.root_pane)
  ) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Workspace creation outcome unknown: response entities did not match required protocol-22 workspace/tab/root_pane shapes'
    }
  }

  const returnedWorkspaceId = getNonEmptyString(rpcResponse.workspace.workspace_id)
  const returnedTabId = getNonEmptyString(rpcResponse.tab.tab_id)
  const returnedTabWorkspaceId = getNonEmptyString(rpcResponse.tab.workspace_id)
  const returnedRootPaneId = getNonEmptyString(rpcResponse.root_pane.pane_id)
  const returnedRootPaneWorkspaceId = getNonEmptyString(rpcResponse.root_pane.workspace_id)
  const returnedRootPaneTabId = getNonEmptyString(rpcResponse.root_pane.tab_id)

  if (
    !returnedWorkspaceId || !CONSERVATIVE_TOKEN_REGEX.test(returnedWorkspaceId) ||
    !returnedTabId || !CONSERVATIVE_TOKEN_REGEX.test(returnedTabId) ||
    !returnedTabWorkspaceId ||
    !returnedRootPaneId || !CONSERVATIVE_TOKEN_REGEX.test(returnedRootPaneId) ||
    !returnedRootPaneWorkspaceId ||
    !returnedRootPaneTabId
  ) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Workspace creation outcome unknown: response did not include the exact workspace/tab/root_pane identity shape'
    }
  }

  if (
    returnedTabWorkspaceId !== returnedWorkspaceId ||
    returnedRootPaneWorkspaceId !== returnedWorkspaceId ||
    returnedRootPaneTabId !== returnedTabId
  ) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Workspace creation outcome unknown: response returned inconsistent relationship between workspace, tab, and root_pane'
    }
  }

  // 4. Post-creation authoritative snapshot verification
  let postSnapshot: ISnapshotResult
  try {
    postSnapshot = await fetchSnapshot(3000)
  } catch {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Workspace creation outcome unknown: failed to fetch post-creation snapshot'
    }
  }

  if (!hasSnapshotArrays(postSnapshot)) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Workspace creation outcome unknown: post-creation snapshot is malformed'
    }
  }

  const exactWorkspaces = postSnapshot.workspaces.filter((workspace) => workspace && workspace.workspace_id === returnedWorkspaceId)
  if (exactWorkspaces.length !== 1) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: exactWorkspaces.length > 1
        ? `Workspace creation outcome unknown: duplicate correlated workspace ID "${returnedWorkspaceId}" in post-creation snapshot`
        : `Workspace creation outcome unknown: correlated workspace "${returnedWorkspaceId}" not found in post-creation snapshot`
    }
  }

  const exactTabs = postSnapshot.tabs.filter((tab) => tab && tab.tab_id === returnedTabId)
  if (exactTabs.length !== 1 || exactTabs[0].workspace_id !== returnedWorkspaceId) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: exactTabs.length > 1
        ? `Workspace creation outcome unknown: duplicate correlated tab ID "${returnedTabId}" in post-creation snapshot`
        : `Workspace creation outcome unknown: correlated tab "${returnedTabId}" not found in post-creation snapshot`
    }
  }

  const exactRootPanes = postSnapshot.panes.filter((pane) => pane && pane.pane_id === returnedRootPaneId)
  const exactRootPane = exactRootPanes.length === 1 ? exactRootPanes[0] : undefined
  if (
    !exactRootPane ||
    exactRootPane.workspace_id !== returnedWorkspaceId ||
    exactRootPane.tab_id !== returnedTabId ||
    !getNonEmptyString(exactRootPane.terminal_id)
  ) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: `Workspace creation outcome unknown: correlated terminal-backed root pane "${returnedRootPaneId}" not found in post-creation snapshot`
    }
  }

  return {
    ok: true,
    status: 200,
    outcome: 'observed',
    result: {
      workspaceId: returnedWorkspaceId,
      tabId: returnedTabId,
      paneId: returnedRootPaneId
    }
  }
}

export const executeWorkspaceClose = async (
  target: IWorkspaceCloseTargetIdentity,
  options: {
    timeoutMs?: number
    preSnapshot?: ISnapshotResult
    deps?: {
      fetchSnapshot?: (timeoutMs?: number) => Promise<ISnapshotResult>
      sendSocketRequest?: RawSocketRequester
    }
  } = {}
): Promise<IWorkspaceCloseExecutionResult> => {
  if (getTransportMode() === 'cli') {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: 'Workspace close is unavailable in CLI transport mode; socket transport is required.'
    }
  }

  const timeoutMs = options.timeoutMs ?? 5000
  const fetchSnapshot = options.deps?.fetchSnapshot ?? getHerdrSnapshot
  const sendRequest = options.deps?.sendSocketRequest ?? sendRawSocketRequest

  // 1. Authoritative preflight snapshot (target existence check)
  let preSnapshot: ISnapshotResult
  try {
    preSnapshot = options.preSnapshot ?? await fetchSnapshot(3000)
  } catch (err) {
    return {
      ok: false,
      status: 502,
      outcome: 'rejected',
      error: `Failed to fetch snapshot before workspace close: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  if (!hasSnapshotArrays(preSnapshot)) {
    return {
      ok: false,
      status: 502,
      outcome: 'rejected',
      error: 'Failed to validate snapshot before workspace close: workspaces, tabs, and panes must be arrays'
    }
  }

  const targetWorkspaces = preSnapshot.workspaces.filter((workspace) => workspace && workspace.workspace_id === target.workspaceId)
  if (targetWorkspaces.length === 0) {
    return {
      ok: false,
      status: 404,
      outcome: 'rejected',
      error: `Workspace "${target.workspaceId}" not found in active session`
    }
  }
  if (targetWorkspaces.length !== 1) {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: `Ambiguous duplicate workspace ID "${target.workspaceId}" in active session`
    }
  }

  const topologyError = validateCloseSnapshotTopology(preSnapshot)
  if (topologyError) {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: `Workspace membership could not be validated. Refresh and reconfirm before closing. ${topologyError}`
    }
  }

  const currentTabs = collectCanonicalMembership(
    preSnapshot.tabs,
    (tab) => tab.workspace_id === target.workspaceId,
    (tab) => tab.tab_id
  )
  const currentPanes = collectCanonicalMembership(
    preSnapshot.panes,
    (pane) => pane.workspace_id === target.workspaceId,
    (pane) => pane.pane_id
  )
  if (!currentTabs.ids || !currentPanes.ids) {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: `Workspace membership could not be validated. Refresh and reconfirm before closing. ${currentTabs.error || currentPanes.error}`
    }
  }
  if (
    !exactIdSetsMatch(target.expected.tabIds, currentTabs.ids) ||
    !exactIdSetsMatch(target.expected.paneIds, currentPanes.ids)
  ) {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: 'Workspace membership changed after confirmation. Refresh and reconfirm before closing.'
    }
  }

  // 2. Send workspace.close RPC (close_group: false, last Space allowed, never group-close/escalate)
  let rpcResponse: any
  let sendError: unknown | null = null
  try {
    rpcResponse = await sendRequest(
      'workspace.close',
      { workspace_id: target.workspaceId, close_group: false },
      { timeoutMs }
    )
  } catch (err) {
    sendError = err
  }

  if (sendError) {
    if (sendError instanceof HerdrSocketError) {
      if (sendError.code === 'workspace_not_found' || sendError.code === 'not_found') {
        return {
          ok: false,
          status: 404,
          outcome: 'rejected',
          error: sendError.message
        }
      }
      if (sendError.code === 'group_required' || sendError.code === 'close_group_required') {
        return {
          ok: false,
          status: 409,
          outcome: 'rejected',
          error: sendError.message
        }
      }
      if (sendError.code === 'invalid_params') {
        return {
          ok: false,
          status: 400,
          outcome: 'rejected',
          error: sendError.message
        }
      }
    }
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Workspace close outcome unknown: operation may have timed out or resulted in ambiguous state'
    }
  }

  // 3. Exact { type: 'ok' } response validation
  if (!isExactOkResponse(rpcResponse)) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Workspace close outcome unknown: invalid or malformed response from daemon (expected type "ok")'
    }
  }

  // 4. Post-close authoritative snapshot verification: target and all descendants absent
  let postSnapshot: ISnapshotResult
  try {
    postSnapshot = await fetchSnapshot(3000)
  } catch {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Workspace close outcome unknown: failed to fetch post-close snapshot'
    }
  }

  if (!hasSnapshotArrays(postSnapshot)) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Workspace close outcome unknown: post-close snapshot is malformed'
    }
  }

  const workspaceRemains = postSnapshot.workspaces.some(
    (w) => w && w.workspace_id === target.workspaceId
  )
  if (workspaceRemains) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: `Workspace close outcome unknown: workspace "${target.workspaceId}" still present in post-close snapshot`
    }
  }

  const confirmedTabIds = new Set(target.expected.tabIds)
  const descendantTabsRemain = postSnapshot.tabs.some(
    (t) => t && (
      t.workspace_id === target.workspaceId ||
      confirmedTabIds.has(t.tab_id)
    )
  )
  if (descendantTabsRemain) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: `Workspace close outcome unknown: confirmed descendant tabs for workspace "${target.workspaceId}" still present in post-close snapshot`
    }
  }

  const confirmedPaneIds = new Set(target.expected.paneIds)
  const descendantPanesRemain = postSnapshot.panes.some(
    (p) => p && (
      p.workspace_id === target.workspaceId ||
      confirmedPaneIds.has(p.pane_id)
    )
  )
  if (descendantPanesRemain) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: `Workspace close outcome unknown: confirmed descendant panes for workspace "${target.workspaceId}" still present in post-close snapshot`
    }
  }

  return {
    ok: true,
    status: 200,
    outcome: 'observed',
    result: {
      workspaceId: target.workspaceId
    }
  }
}

export const executeTabClose = async (
  target: ITabCloseTargetIdentity,
  options: {
    timeoutMs?: number
    preSnapshot?: ISnapshotResult
    deps?: {
      fetchSnapshot?: (timeoutMs?: number) => Promise<ISnapshotResult>
      sendSocketRequest?: RawSocketRequester
    }
  } = {}
): Promise<ITabCloseExecutionResult> => {
  if (getTransportMode() === 'cli') {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: 'Tab close is unavailable in CLI transport mode; socket transport is required.'
    }
  }

  const timeoutMs = options.timeoutMs ?? 5000
  const fetchSnapshot = options.deps?.fetchSnapshot ?? getHerdrSnapshot
  const sendRequest = options.deps?.sendSocketRequest ?? sendRawSocketRequest

  // 1. Authoritative preflight snapshot
  let preSnapshot: ISnapshotResult
  try {
    preSnapshot = options.preSnapshot ?? await fetchSnapshot(3000)
  } catch (err) {
    return {
      ok: false,
      status: 502,
      outcome: 'rejected',
      error: `Failed to fetch snapshot before tab close: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  if (!hasSnapshotArrays(preSnapshot)) {
    return {
      ok: false,
      status: 502,
      outcome: 'rejected',
      error: 'Failed to validate snapshot before tab close: workspaces, tabs, and panes must be arrays'
    }
  }

  const targetWorkspaces = preSnapshot.workspaces.filter((workspace) => workspace && workspace.workspace_id === target.workspaceId)
  if (targetWorkspaces.length === 0) {
    return {
      ok: false,
      status: 404,
      outcome: 'rejected',
      error: `Workspace "${target.workspaceId}" not found in active session`
    }
  }
  if (targetWorkspaces.length !== 1) {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: `Ambiguous duplicate workspace ID "${target.workspaceId}" in active session`
    }
  }

  const targetTabs = preSnapshot.tabs.filter((tab) => tab && tab.tab_id === target.tabId)
  if (targetTabs.length === 0) {
    return {
      ok: false,
      status: 404,
      outcome: 'rejected',
      error: `Tab "${target.tabId}" not found in active session`
    }
  }
  if (targetTabs.length !== 1) {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: `Ambiguous duplicate tab ID "${target.tabId}" in active session`
    }
  }
  const targetTab = targetTabs[0]

  if (targetTab.workspace_id !== target.workspaceId) {
    return {
      ok: false,
      status: 400,
      outcome: 'rejected',
      error: `Tab "${target.tabId}" does not belong to workspace "${target.workspaceId}" (belongs to "${targetTab.workspace_id}")`
    }
  }

  const topologyError = validateCloseSnapshotTopology(preSnapshot)
  if (topologyError) {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: `Tab membership could not be validated. Refresh and reconfirm before closing. ${topologyError}`
    }
  }

  const currentPanes = collectCanonicalMembership(
    preSnapshot.panes,
    (pane) => pane.workspace_id === target.workspaceId && pane.tab_id === target.tabId,
    (pane) => pane.pane_id
  )
  if (!currentPanes.ids) {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: `Tab membership could not be validated. Refresh and reconfirm before closing. ${currentPanes.error}`
    }
  }
  if (!exactIdSetsMatch(target.expected.paneIds, currentPanes.ids)) {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: 'Tab membership changed after confirmation. Refresh and reconfirm before closing.'
    }
  }

  // Pre-RPC rejection: reject last tab in space (ZERO RPC!)
  const spaceTabs = preSnapshot.tabs.filter(
    (t) => t && t.workspace_id === target.workspaceId
  )
  if (spaceTabs.length <= 1) {
    return {
      ok: false,
      status: 409,
      outcome: 'rejected',
      error: 'Cannot close the last tab in a space; use Close Space instead.'
    }
  }

  // 2. Send tab.close RPC
  let rpcResponse: any
  let sendError: unknown | null = null
  try {
    rpcResponse = await sendRequest(
      'tab.close',
      { tab_id: target.tabId },
      { timeoutMs }
    )
  } catch (err) {
    sendError = err
  }

  if (sendError) {
    if (sendError instanceof HerdrSocketError) {
      if (sendError.code === 'tab_not_found' || sendError.code === 'not_found') {
        return {
          ok: false,
          status: 404,
          outcome: 'rejected',
          error: sendError.message
        }
      }
      if (sendError.code === 'invalid_params') {
        return {
          ok: false,
          status: 400,
          outcome: 'rejected',
          error: sendError.message
        }
      }
    }
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Tab close outcome unknown: operation may have timed out or resulted in ambiguous state'
    }
  }

  // 3. Exact { type: 'ok' } response validation
  if (!isExactOkResponse(rpcResponse)) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Tab close outcome unknown: invalid or malformed response from daemon (expected type "ok")'
    }
  }

  // 4. Post-close authoritative snapshot verification
  let postSnapshot: ISnapshotResult
  try {
    postSnapshot = await fetchSnapshot(3000)
  } catch {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Tab close outcome unknown: failed to fetch post-close snapshot'
    }
  }

  if (!hasSnapshotArrays(postSnapshot)) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: 'Tab close outcome unknown: post-close snapshot is malformed'
    }
  }

  const remainingWorkspaces = postSnapshot.workspaces.filter(
    (workspace) => workspace && workspace.workspace_id === target.workspaceId
  )
  if (remainingWorkspaces.length !== 1) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: `Tab close outcome unknown: workspace "${target.workspaceId}" unexpectedly disappeared in post-close snapshot`
    }
  }

  const tabRemains = postSnapshot.tabs.some(
    (t) => t && t.tab_id === target.tabId
  )
  if (tabRemains) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: `Tab close outcome unknown: tab "${target.tabId}" still present in post-close snapshot`
    }
  }

  const confirmedPaneIds = new Set(target.expected.paneIds)
  const descendantPanesRemain = postSnapshot.panes.some(
    (p) => p && (
      p.tab_id === target.tabId ||
      confirmedPaneIds.has(p.pane_id)
    )
  )
  if (descendantPanesRemain) {
    return {
      ok: false,
      status: 504,
      outcome: 'unknown',
      error: `Tab close outcome unknown: confirmed descendant panes for tab "${target.tabId}" still present in post-close snapshot`
    }
  }

  return {
    ok: true,
    status: 200,
    outcome: 'observed',
    result: {
      workspaceId: target.workspaceId,
      tabId: target.tabId
    }
  }
}
