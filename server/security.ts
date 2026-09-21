import type {
  IActionRequest,
  IActionTargetIdentity,
  IExpectedPaneMode,
  IPane,
  ISnapshotResult,
  ITabCreateTargetIdentity
} from './types.ts'

export const ALLOWED_KEYS = new Set([
  'esc',
  'tab',
  'enter',
  'ctrl+c',
  'up',
  'down',
  'left',
  'right'
])

export const ALLOWED_LOCAL_HOSTS = new Set([
  '127.0.0.1:8787',
  'localhost:8787',
  '127.0.0.1:5173',
  'localhost:5173',
  '127.0.0.1',
  'localhost'
])

export const PANE_ID_REGEX = /^[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/

export interface IValidationResult<T> {
  valid: boolean
  data?: T
  error?: string
}

export const isHostAllowed = (hostHeader?: string | null): boolean => {
  if (!hostHeader) return false
  const cleanHost = hostHeader.toLowerCase().trim()
  if (ALLOWED_LOCAL_HOSTS.has(cleanHost)) return true
  // Strip optional port
  const hostname = cleanHost.split(':')[0]
  if (ALLOWED_LOCAL_HOSTS.has(hostname)) return true
  // Tailscale *.ts.net domains
  if (hostname.endsWith('.ts.net')) return true
  return false
}

export const APPROVED_DEV_APP_PORTS = new Set(['8787', '5173'])
export const APPROVED_LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost'])

export const parseHostAndPort = (hostStr: string): { hostname: string; port: string } => {
  const colonIndex = hostStr.lastIndexOf(':')
  if (colonIndex !== -1) {
    return {
      hostname: hostStr.slice(0, colonIndex),
      port: hostStr.slice(colonIndex + 1)
    }
  }
  return { hostname: hostStr, port: '' }
}

export const isOriginAllowed = (originHeader?: string | null, hostHeader?: string | null): boolean => {
  if (!originHeader || !hostHeader) return false
  try {
    const originUrl = new URL(originHeader)
    if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') {
      return false
    }

    const cleanHost = hostHeader.toLowerCase().trim()
    const originHost = originUrl.host.toLowerCase().trim()

    // Host must be an allowed host
    if (!isHostAllowed(cleanHost)) {
      return false
    }

    // 1. Exact origin-host equality
    if (originHost === cleanHost) {
      return true
    }

    // 2. Narrowly defined localhost development exception where both sides are localhost/127.0.0.1 on approved dev/app ports
    const hostParsed = parseHostAndPort(cleanHost)
    const originParsed = parseHostAndPort(originHost)

    const isHostApprovedLoopback = APPROVED_LOOPBACK_HOSTNAMES.has(hostParsed.hostname) &&
      APPROVED_DEV_APP_PORTS.has(hostParsed.port)

    const isOriginApprovedLoopback = APPROVED_LOOPBACK_HOSTNAMES.has(originParsed.hostname) &&
      APPROVED_DEV_APP_PORTS.has(originParsed.port)

    if (isHostApprovedLoopback && isOriginApprovedLoopback) {
      return true
    }

    return false
  } catch {
    return false
  }
}

export const isApprovedLoopback = (hostHeader?: string | null, originHeader?: string | null): boolean => {
  if (!hostHeader || !originHeader) return false
  try {
    const originUrl = new URL(originHeader)
    const hostParsed = parseHostAndPort(hostHeader.toLowerCase().trim())
    const originParsed = parseHostAndPort(originUrl.host.toLowerCase().trim())

    const isHostLoopback = APPROVED_LOOPBACK_HOSTNAMES.has(hostParsed.hostname)
    const isOriginLoopback = APPROVED_LOOPBACK_HOSTNAMES.has(originParsed.hostname)

    if (!isHostLoopback || !isOriginLoopback) {
      return false
    }

    const isHostApprovedPort =
      hostParsed.port === '' || APPROVED_DEV_APP_PORTS.has(hostParsed.port)

    const isOriginApprovedPort =
      originParsed.port === '' || APPROVED_DEV_APP_PORTS.has(originParsed.port)

    if (isHostApprovedPort && isOriginApprovedPort) {
      return true
    }

    if (
      process.env.NODE_ENV === 'test' &&
      hostParsed.hostname === originParsed.hostname &&
      hostParsed.port === originParsed.port
    ) {
      return true
    }

    return false
  } catch {
    return false
  }
}

export interface IOwnerAuthOptions {
  requireOrigin?: boolean
}

export interface IOwnerAuthResult {
  allowed: boolean
  status: number
  error?: string
}

export const validateOwnerAuth = (
  req: Request,
  hostHeader?: string | null,
  originHeader?: string | null,
  configuredOwnerLogin?: string,
  options: IOwnerAuthOptions = {}
): IOwnerAuthResult => {
  const requireOrigin = options.requireOrigin ?? true

  // 1. Origin and Host checks
  if (originHeader) {
    if (!isOriginAllowed(originHeader, hostHeader)) {
      return { allowed: false, status: 403, error: 'Forbidden: origin not authorized' }
    }
  } else if (requireOrigin) {
    return { allowed: false, status: 403, error: 'Forbidden: origin not authorized' }
  }

  if (!isHostAllowed(hostHeader)) {
    return { allowed: false, status: 403, error: 'Forbidden: host not authorized' }
  }

  const cleanHost = (hostHeader || '').toLowerCase().trim()
  const hostname = cleanHost.split(':')[0]
  const isTailnetHost = hostname.endsWith('.ts.net')
  const tailscaleLogin = req.headers.get('tailscale-user-login')?.trim().toLowerCase()

  // 2. Tailnet production requirements
  if (isTailnetHost || tailscaleLogin !== undefined) {
    if (!configuredOwnerLogin || configuredOwnerLogin.trim().length === 0) {
      return { allowed: false, status: 500, error: 'Server misconfigured: owner login not set' }
    }

    const expectedLogin = configuredOwnerLogin.trim().toLowerCase()
    if (!tailscaleLogin || tailscaleLogin !== expectedLogin) {
      return { allowed: false, status: 403, error: 'Forbidden: Tailnet user not authorized' }
    }

    return { allowed: true, status: 200 }
  }

  // 3. Loopback dev exception: allowed strictly when host and origin are approved loopback
  const effectiveOrigin = originHeader || (hostHeader ? `http://${hostHeader}` : null)
  if (isApprovedLoopback(hostHeader, effectiveOrigin)) {
    return { allowed: true, status: 200 }
  }

  // Non-loopback, non-tailnet or unverified origin
  return { allowed: false, status: 403, error: 'Forbidden: unauthorized network context' }
}

export const VALID_EXPECTED_MODES = new Set(['agent', 'blocked-agent', 'shell'])
export const CONSERVATIVE_TOKEN_REGEX = /^[a-zA-Z0-9_.:-]+$/
export const CONTROL_CHARS_REGEX = /[\x00-\x1f\x7f]/

export const validateActionRequest = (body: unknown): IValidationResult<IActionRequest> => {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' }
  }

  const raw = body as Record<string, unknown>
  const type = raw.type

  if (type !== 'prompt' && type !== 'keys' && type !== 'terminal-input' && type !== 'tab-create') {
    return { valid: false, error: 'Action type must be "prompt", "keys", "terminal-input", or "tab-create"' }
  }

  if (typeof raw.operationId !== 'string' || raw.operationId.trim().length === 0) {
    return { valid: false, error: 'Missing or empty "operationId"' }
  }
  const operationId = raw.operationId.trim()
  if (operationId.length > 128 || !CONSERVATIVE_TOKEN_REGEX.test(operationId)) {
    return { valid: false, error: 'Invalid "operationId": must be a safe token (1-128 chars, alphanumeric, underscore, period, colon, hyphen)' }
  }

  if (!raw.target || typeof raw.target !== 'object' || Array.isArray(raw.target)) {
    return { valid: false, error: 'Missing or invalid "target" object' }
  }

  const rawTarget = raw.target as Record<string, unknown>
  if (typeof rawTarget.paneId !== 'string' || !PANE_ID_REGEX.test(rawTarget.paneId.trim())) {
    return { valid: false, error: 'Invalid target paneId: must match format "ws:p1"' }
  }
  const paneId = rawTarget.paneId.trim()

  if (typeof rawTarget.terminalId !== 'string' || rawTarget.terminalId.trim().length === 0) {
    return { valid: false, error: 'Missing or empty target "terminalId"' }
  }
  const terminalId = rawTarget.terminalId.trim()
  if (terminalId.length > 128 || !CONSERVATIVE_TOKEN_REGEX.test(terminalId)) {
    return { valid: false, error: 'Invalid target "terminalId": must be a safe token (1-128 chars, alphanumeric, underscore, period, colon, hyphen)' }
  }

  if (type === 'tab-create') {
    if (typeof raw.workspaceId !== 'string' || raw.workspaceId.trim().length === 0) {
      return { valid: false, error: 'Missing or empty "workspaceId"' }
    }
    const workspaceId = raw.workspaceId.trim()
    if (workspaceId.length > 128 || !CONSERVATIVE_TOKEN_REGEX.test(workspaceId)) {
      return { valid: false, error: 'Invalid "workspaceId" format' }
    }

    let label: string | undefined
    if (raw.label !== undefined && raw.label !== null) {
      if (typeof raw.label !== 'string') {
        return { valid: false, error: 'Invalid "label": must be a string' }
      }
      const trimmedLabel = raw.label.trim()
      if (trimmedLabel.length > 100 || CONTROL_CHARS_REGEX.test(trimmedLabel)) {
        return { valid: false, error: 'label exceeds maximum length of 100 characters or contains control characters' }
      }
      label = trimmedLabel
    }

    return {
      valid: true,
      data: {
        type: 'tab-create',
        operationId,
        workspaceId,
        target: {
          paneId,
          terminalId
        },
        ...(label !== undefined ? { label } : {})
      }
    }
  }

  if (typeof rawTarget.expectedMode !== 'string' || !VALID_EXPECTED_MODES.has(rawTarget.expectedMode)) {
    return { valid: false, error: 'Invalid or missing target "expectedMode": must be "agent", "blocked-agent", or "shell"' }
  }
  const expectedMode = rawTarget.expectedMode as IExpectedPaneMode

  let agentSessionId: string | undefined
  if (rawTarget.agentSessionId !== undefined && rawTarget.agentSessionId !== null) {
    if (typeof rawTarget.agentSessionId !== 'string') {
      return { valid: false, error: 'Invalid target "agentSessionId": must be a string' }
    }
    const trimmedSession = rawTarget.agentSessionId.trim()
    if (trimmedSession.length === 0 || trimmedSession.length > 256 || !CONSERVATIVE_TOKEN_REGEX.test(trimmedSession)) {
      return { valid: false, error: 'Invalid target "agentSessionId": must be a safe token (1-256 chars, alphanumeric, underscore, period, colon, hyphen)' }
    }
    agentSessionId = trimmedSession
  }

  const target: IActionTargetIdentity = {
    paneId,
    terminalId,
    expectedMode,
    ...(agentSessionId !== undefined ? { agentSessionId } : {})
  }

  if (type === 'prompt') {
    if (expectedMode !== 'agent') {
      return {
        valid: false,
        error: `Action type "prompt" requires target expectedMode "agent", received "${expectedMode}"`
      }
    }
    if (typeof raw.text !== 'string' || raw.text.trim().length === 0) {
      return { valid: false, error: 'Prompt text must be a non-empty string' }
    }
    if (raw.text.length > 4096) {
      return { valid: false, error: 'Prompt text exceeds maximum length of 4096 characters' }
    }
    return {
      valid: true,
      data: {
        type: 'prompt',
        operationId,
        target,
        text: raw.text
      }
    }
  }

  if (type === 'terminal-input') {
    if (expectedMode !== 'blocked-agent' && expectedMode !== 'shell') {
      return {
        valid: false,
        error: `Action type "terminal-input" requires target expectedMode "blocked-agent" or "shell", received "${expectedMode}"`
      }
    }
    if (typeof raw.text !== 'string' || raw.text.trim().length === 0) {
      return { valid: false, error: 'Terminal input text must be a non-empty string' }
    }
    if (raw.text.length > 4096) {
      return { valid: false, error: 'Terminal input text exceeds maximum length of 4096 characters' }
    }
    return {
      valid: true,
      data: {
        type: 'terminal-input',
        operationId,
        target,
        text: raw.text
      }
    }
  }

  if (type === 'keys') {
    if (!Array.isArray(raw.keys) || raw.keys.length === 0) {
      return { valid: false, error: 'Keys must be a non-empty array of strings' }
    }
    if (raw.keys.length > 16) {
      return { valid: false, error: 'Keys array exceeds maximum size of 16 keys' }
    }
    const cleanKeys: string[] = []
    for (const k of raw.keys) {
      if (typeof k !== 'string') {
        return { valid: false, error: 'All keys must be strings' }
      }
      const lower = k.toLowerCase().trim()
      if (!ALLOWED_KEYS.has(lower)) {
        return { valid: false, error: `Unauthorized key: "${k}". Allowed keys: ${Array.from(ALLOWED_KEYS).join(', ')}` }
      }
      cleanKeys.push(lower)
    }
    return {
      valid: true,
      data: {
        type: 'keys',
        operationId,
        target,
        keys: cleanKeys
      }
    }
  }

  return { valid: false, error: 'Unknown validation state' }
}

/**
 * Canonical server agent evidence helper (matches frontend isAgentPane).
 * Literal case-insensitive 'shell' is not agent evidence.
 * Presence of agent_session or matching snapshot agents is agent evidence.
 */
export const isAgentPane = (
  pane?: Partial<IPane> | null,
  snapshotAgents?: any[] | null
): boolean => {
  if (!pane) return false

  // 1. pane.agent (case-insensitive, ignores 'shell')
  const agent = (pane.agent || '').trim()
  if (agent.length > 0 && agent.toLowerCase() !== 'shell') {
    return true
  }

  // 2. pane.display_agent (case-insensitive, ignores 'shell')
  const displayAgent = (pane.display_agent || '').trim()
  if (displayAgent.length > 0 && displayAgent.toLowerCase() !== 'shell') {
    return true
  }

  // 3. pane.agent_session (truthy check for session presence)
  const agentSession = (pane as any).agent_session
  if (agentSession !== undefined && agentSession !== null && agentSession !== false && agentSession !== '') {
    return true
  }

  // 4. snapshot agents matching pane_id or target
  if (pane.pane_id && Array.isArray(snapshotAgents) && snapshotAgents.length > 0) {
    const hasMatchingAgent = snapshotAgents.some(
      (a) => a && (a.target === pane.pane_id || a.pane_id === pane.pane_id)
    )
    if (hasMatchingAgent) {
      return true
    }
  }

  return false
}

export interface ITargetPreflightResult {
  ok: boolean
  status?: number
  error?: string
  pane?: IPane
  derivedCwd?: string
}

export const verifyTargetAgainstSnapshot = (
  snapshot: ISnapshotResult,
  target: IActionTargetIdentity | ITabCreateTargetIdentity,
  options: { isTabCreate?: boolean; actionType?: string } = {}
): ITargetPreflightResult => {
  const panes = snapshot.panes || []
  const targetPane = panes.find((p) => p && p.pane_id === target.paneId)
  if (!targetPane) {
    return {
      ok: false,
      status: 404,
      error: `Pane "${target.paneId}" not found in active session`
    }
  }

  if (targetPane.terminal_id !== target.terminalId) {
    return {
      ok: false,
      status: 409,
      error: `Terminal replacement detected: pane "${target.paneId}" terminal is "${targetPane.terminal_id ?? ''}", expected "${target.terminalId}"`
    }
  }

  const derivedCwd = targetPane.foreground_cwd || targetPane.cwd

  if (options.isTabCreate) {
    return { ok: true, pane: targetPane, derivedCwd }
  }

  const actionTarget = target as IActionTargetIdentity

  const paneAgentSession = targetPane.agent_session
  const agents = snapshot.agents || []
  const owningAgent = agents.find((a: any) => a && (a.target === target.paneId || a.pane_id === target.paneId))

  // Canonical agent ownership evidence (identical to Terminal Control)
  const isAgent = isAgentPane(targetPane, snapshot.agents)

  let computedMode: IExpectedPaneMode
  if (isAgent) {
    computedMode = targetPane.agent_status === 'blocked' ? 'blocked-agent' : 'agent'
  } else {
    computedMode = 'shell'
  }

  if (computedMode !== actionTarget.expectedMode) {
    return {
      ok: false,
      status: 409,
      error: `Expected mode mismatch: expected "${actionTarget.expectedMode}", but pane is currently "${computedMode}"`
    }
  }

  if (options.actionType === 'prompt' && actionTarget.expectedMode !== 'agent') {
    return {
      ok: false,
      status: 409,
      error: `Action type "prompt" requires expectedMode "agent", received "${actionTarget.expectedMode}"`
    }
  }

  if (options.actionType === 'terminal-input' && actionTarget.expectedMode !== 'blocked-agent' && actionTarget.expectedMode !== 'shell') {
    return {
      ok: false,
      status: 409,
      error: `Action type "terminal-input" requires expectedMode "blocked-agent" or "shell", received "${actionTarget.expectedMode}"`
    }
  }

  const authoritativeSessionId =
    paneAgentSession?.value ??
    paneAgentSession?.id ??
    owningAgent?.agent_session?.value ??
    owningAgent?.agent_session?.id

  if (actionTarget.expectedMode === 'agent' || actionTarget.expectedMode === 'blocked-agent') {
    if (authoritativeSessionId) {
      if (!actionTarget.agentSessionId) {
        return {
          ok: false,
          status: 409,
          error: `Missing required agentSessionId for pane "${actionTarget.paneId}": pane has active session "${authoritativeSessionId}"`
        }
      }
      if (actionTarget.agentSessionId !== authoritativeSessionId) {
        return {
          ok: false,
          status: 409,
          error: `Agent session replacement detected: expected "${actionTarget.agentSessionId}", got "${authoritativeSessionId}"`
        }
      }
    } else {
      if (actionTarget.agentSessionId) {
        return {
          ok: false,
          status: 409,
          error: `Agent session mismatch: caller specified "${actionTarget.agentSessionId}", but pane has no active session`
        }
      }
    }
  } else {
    // shell mode
    if (actionTarget.agentSessionId) {
      return {
        ok: false,
        status: 409,
        error: `Agent session mismatch: caller specified agentSessionId for shell pane`
      }
    }
  }

  return { ok: true, pane: targetPane, derivedCwd }
}

export const ALLOWED_PANE_READ_SOURCES = new Set(['detection', 'visible', 'recent-unwrapped'])

export const validatePaneReadParams = (
  url: URL
): IValidationResult<{ pane: string; source: 'detection' | 'visible' | 'recent-unwrapped'; lines?: number }> => {
  const pane = url.searchParams.get('pane')
  if (!pane || !PANE_ID_REGEX.test(pane.trim())) {
    return { valid: false, error: 'Invalid or missing "pane" query param' }
  }

  const rawSource = url.searchParams.get('source') || 'detection'
  const sourceClean = rawSource.trim().toLowerCase()
  if (!ALLOWED_PANE_READ_SOURCES.has(sourceClean)) {
    return {
      valid: false,
      error: `Invalid source: "${rawSource}". Allowed sources: ${Array.from(ALLOWED_PANE_READ_SOURCES).join(', ')}`
    }
  }

  const rawLines = url.searchParams.get('lines')
  let lines: number | undefined
  if (rawLines) {
    const parsed = parseInt(rawLines, 10)
    if (isNaN(parsed) || parsed < 1 || parsed > 1000) {
      return { valid: false, error: 'lines must be an integer between 1 and 1000' }
    }
    lines = parsed
  }

  return {
    valid: true,
    data: {
      pane: pane.trim(),
      source: sourceClean as 'detection' | 'visible' | 'recent-unwrapped',
      lines
    }
  }
}

export const validateTerminalParams = (url: URL): IValidationResult<{ pane: string; cols: number; rows: number }> => {
  const pane = url.searchParams.get('pane')
  if (!pane || !PANE_ID_REGEX.test(pane.trim())) {
    return { valid: false, error: 'Invalid or missing "pane" query param' }
  }

  const rawCols = url.searchParams.get('cols')
  const rawRows = url.searchParams.get('rows')

  let cols = 80
  let rows = 24

  if (rawCols) {
    const parsed = parseInt(rawCols, 10)
    if (isNaN(parsed) || parsed < 20 || parsed > 500) {
      return { valid: false, error: 'cols must be an integer between 20 and 500' }
    }
    cols = parsed
  }

  if (rawRows) {
    const parsed = parseInt(rawRows, 10)
    if (isNaN(parsed) || parsed < 5 || parsed > 200) {
      return { valid: false, error: 'rows must be an integer between 5 and 200' }
    }
    rows = parsed
  }

  return {
    valid: true,
    data: {
      pane: pane.trim(),
      cols,
      rows
    }
  }
}

export const validateAgentExplainParams = (
  url: URL
): IValidationResult<{ pane: string }> => {
  const keys = Array.from(url.searchParams.keys())
  if (!url.searchParams.has('pane')) {
    return { valid: false, error: 'Missing required "pane" query param' }
  }

  if (url.searchParams.getAll('pane').length > 1 || keys.length > 1) {
    return { valid: false, error: 'Unexpected or duplicate query parameters' }
  }

  const pane = url.searchParams.get('pane')
  if (!pane || !PANE_ID_REGEX.test(pane.trim())) {
    return { valid: false, error: 'Invalid "pane" query param: must match format "ws:p1"' }
  }

  return {
    valid: true,
    data: {
      pane: pane.trim()
    }
  }
}
