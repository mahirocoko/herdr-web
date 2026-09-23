import type {
  IAgentSessionInfo,
  IPane,
  IPaneScroll,
  IPaneTokens,
  ISnapshotAgent,
  ISnapshotResult,
  ITab,
  IWorkspace,
  IWorkspaceTokens,
  IWorkspaceWorktree
} from './types.ts'

const CONTROL_CHARS_REGEX = /[\x00-\x1f\x7f]/g

/**
 * Strips ASCII control characters, trims whitespace, and bounds length.
 * Returns undefined if input is not a string or becomes empty.
 */
export const sanitizeBoundedText = (
  value: unknown,
  maxLength = 128
): string | undefined => {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(CONTROL_CHARS_REGEX, '').trim()
  if (cleaned.length === 0) return undefined
  return cleaned.slice(0, maxLength)
}

/**
 * Checks whether a path string represents an absolute POSIX or Windows path,
 * or starts with a tilde home reference.
 */
export const isAbsolutePath = (value: string): boolean => {
  const trimmed = value.trim()
  return (
    trimmed.startsWith('/') ||
    trimmed.startsWith('~') ||
    trimmed.startsWith('\\') ||
    /^[a-zA-Z]:[\\/]/.test(trimmed)
  )
}

const isSafeBasename = (value: string): boolean =>
  value !== '.' && value !== '..' && !/[\\/:]/.test(value)

/**
 * Allowlisted presentation keys for pane tokens.
 * Arbitrary tokens and internal Letta identity tokens are strictly stripped.
 */
export const ALLOWED_PANE_TOKEN_KEYS = new Set([
  'summary',
  'subagents',
  'subagents_running',
  'mahiro_sidebar_context',
  'mahiro_sidebar_model',
  'mahiro_sidebar_provider',
  'mahiro_sidebar_q1_critical'
])

/**
 * Projects a raw workspace into a fresh allowlisted browser workspace object.
 * Strips layouts, arbitrary tokens, Letta identity tokens, and absolute paths.
 */
export const projectBrowserWorkspace = (raw: unknown): IWorkspace | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const ws = raw as Record<string, unknown>
  const workspace_id = sanitizeBoundedText(ws.workspace_id, 128)
  if (!workspace_id) return null

  const label = sanitizeBoundedText(ws.label, 100) ?? ''
  const number =
    typeof ws.number === 'number' && Number.isFinite(ws.number)
      ? Math.max(0, Math.floor(ws.number))
      : 0
  const agent_status = sanitizeBoundedText(ws.agent_status, 32) ?? 'unknown'
  const tab_count =
    typeof ws.tab_count === 'number' && Number.isFinite(ws.tab_count)
      ? Math.max(0, Math.floor(ws.tab_count))
      : 0
  const pane_count =
    typeof ws.pane_count === 'number' && Number.isFinite(ws.pane_count)
      ? Math.max(0, Math.floor(ws.pane_count))
      : 0
  const active_tab_id = sanitizeBoundedText(ws.active_tab_id, 128)
  const focused = Boolean(ws.focused)

  const projected: IWorkspace = {
    workspace_id,
    label,
    number,
    agent_status,
    tab_count,
    pane_count,
    focused,
    ...(active_tab_id !== undefined ? { active_tab_id } : {})
  }

  // Workspace tokens allowlist: ONLY mahiro_workspace_branch, mahiro_workspace_git_status, and mahiro_workspace_worktree
  if (ws.tokens && typeof ws.tokens === 'object' && !Array.isArray(ws.tokens)) {
    const rawTokens = ws.tokens as Record<string, unknown>
    const branch = sanitizeBoundedText(rawTokens.mahiro_workspace_branch, 128)

    const rawGitStatus = typeof rawTokens.mahiro_workspace_git_status === 'string'
      ? rawTokens.mahiro_workspace_git_status.trim()
      : undefined
    const gitStatus: 'clean' | 'dirty' | undefined =
      rawGitStatus === 'clean' || rawGitStatus === 'dirty' ? rawGitStatus : undefined

    let worktreeToken: string | undefined
    const rawWorktree = sanitizeBoundedText(rawTokens.mahiro_workspace_worktree, 128)
    if (rawWorktree && !isAbsolutePath(rawWorktree) && isSafeBasename(rawWorktree)) {
      worktreeToken = rawWorktree
    }

    if (branch !== undefined || gitStatus !== undefined || worktreeToken !== undefined) {
      const tokens: IWorkspaceTokens = {
        ...(branch !== undefined ? { mahiro_workspace_branch: branch } : {}),
        ...(gitStatus !== undefined ? { mahiro_workspace_git_status: gitStatus } : {}),
        ...(worktreeToken !== undefined ? { mahiro_workspace_worktree: worktreeToken } : {})
      }
      projected.tokens = tokens
    }
  }

  // Worktree provenance: expose only bounded repo_name plus is_linked_worktree, never absolute paths
  if (ws.worktree && typeof ws.worktree === 'object' && !Array.isArray(ws.worktree)) {
    const rawWt = ws.worktree as Record<string, unknown>
    const repoName = sanitizeBoundedText(rawWt.repo_name, 128)
    const isLinked = Boolean(rawWt.is_linked_worktree)
    if (repoName !== undefined && !isAbsolutePath(repoName) && isSafeBasename(repoName)) {
      const worktree: IWorkspaceWorktree = {
        repo_name: repoName,
        is_linked_worktree: isLinked
      }
      projected.worktree = worktree
    }
  }

  return projected
}

/**
 * Projects a raw tab into a fresh allowlisted browser tab object.
 */
export const projectBrowserTab = (raw: unknown): ITab | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const tab = raw as Record<string, unknown>
  const tab_id = sanitizeBoundedText(tab.tab_id, 128)
  const workspace_id = sanitizeBoundedText(tab.workspace_id, 128)
  if (!tab_id || !workspace_id) return null

  const label = sanitizeBoundedText(tab.label, 100) ?? ''
  const number =
    typeof tab.number === 'number' && Number.isFinite(tab.number)
      ? Math.max(0, Math.floor(tab.number))
      : 0
  const pane_count =
    typeof tab.pane_count === 'number' && Number.isFinite(tab.pane_count)
      ? Math.max(0, Math.floor(tab.pane_count))
      : 0
  const focused = Boolean(tab.focused)
  const agent_status = sanitizeBoundedText(tab.agent_status, 32) ?? 'unknown'

  return {
    tab_id,
    workspace_id,
    label,
    number,
    pane_count,
    focused,
    agent_status
  }
}

/**
 * Projects a raw pane into a fresh allowlisted browser pane object.
 * Strips state_labels, layouts, unknown tokens, and arbitrary fields.
 */
export const projectBrowserPane = (raw: unknown): IPane | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const pane = raw as Record<string, unknown>
  const pane_id = sanitizeBoundedText(pane.pane_id, 128)
  const workspace_id = sanitizeBoundedText(pane.workspace_id, 128)
  const tab_id = sanitizeBoundedText(pane.tab_id, 128)
  if (!pane_id || !workspace_id || !tab_id) return null

  const terminal_id = sanitizeBoundedText(pane.terminal_id, 128)
  const agent = sanitizeBoundedText(pane.agent, 128)
  const display_agent = sanitizeBoundedText(pane.display_agent, 128)
  const agent_status = (sanitizeBoundedText(pane.agent_status, 32) ?? 'unknown') as IPane['agent_status']

  const title = sanitizeBoundedText(pane.title, 256)
  const terminal_title = sanitizeBoundedText(pane.terminal_title, 256)
  const terminal_title_stripped = sanitizeBoundedText(pane.terminal_title_stripped, 256)

  const cwd = typeof pane.cwd === 'string' ? sanitizeBoundedText(pane.cwd, 1024) ?? null : null
  const foreground_cwd =
    typeof pane.foreground_cwd === 'string'
      ? sanitizeBoundedText(pane.foreground_cwd, 1024) ?? null
      : pane.foreground_cwd === null
        ? null
        : undefined

  const focused = Boolean(pane.focused)
  const revision =
    typeof pane.revision === 'number' && Number.isFinite(pane.revision)
      ? Math.floor(pane.revision)
      : undefined

  const projected: IPane = {
    pane_id,
    workspace_id,
    tab_id,
    agent_status,
    cwd,
    focused,
    ...(terminal_id !== undefined ? { terminal_id } : {}),
    ...(agent !== undefined ? { agent } : {}),
    ...(display_agent !== undefined ? { display_agent } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(terminal_title !== undefined ? { terminal_title } : {}),
    ...(terminal_title_stripped !== undefined ? { terminal_title_stripped } : {}),
    ...(foreground_cwd !== undefined ? { foreground_cwd } : {}),
    ...(revision !== undefined ? { revision } : {})
  }

  // Scroll projection
  if (pane.scroll && typeof pane.scroll === 'object' && !Array.isArray(pane.scroll)) {
    const rawScroll = pane.scroll as Record<string, unknown>
    if (
      typeof rawScroll.offset_from_bottom === 'number' &&
      typeof rawScroll.max_offset_from_bottom === 'number' &&
      typeof rawScroll.viewport_rows === 'number'
    ) {
      const scroll: IPaneScroll = {
        offset_from_bottom: Number.isFinite(rawScroll.offset_from_bottom) ? rawScroll.offset_from_bottom : 0,
        max_offset_from_bottom: Number.isFinite(rawScroll.max_offset_from_bottom) ? rawScroll.max_offset_from_bottom : 0,
        viewport_rows: Number.isFinite(rawScroll.viewport_rows) ? rawScroll.viewport_rows : 0
      }
      projected.scroll = scroll
    }
  }

  // Strict agent_session projection
  if (pane.agent_session && typeof pane.agent_session === 'object' && !Array.isArray(pane.agent_session)) {
    const rawSession = pane.agent_session as Record<string, unknown>
    const source = sanitizeBoundedText(rawSession.source, 64)
    const sessionAgent = sanitizeBoundedText(rawSession.agent, 64)
    const kind = sanitizeBoundedText(rawSession.kind, 64)
    const value = sanitizeBoundedText(rawSession.value, 256)
    const id = sanitizeBoundedText(rawSession.id, 256)

    if (source && sessionAgent && (kind === 'id' || kind === 'path') && value) {
      const agent_session: IAgentSessionInfo = {
        source,
        agent: sessionAgent,
        kind,
        value,
        ...(id !== undefined ? { id } : {})
      }
      projected.agent_session = agent_session
    }
  } else if (pane.agent_session === null) {
    projected.agent_session = null
  }

  // Pane tokens allowlist: summary, subagents, subagents_running, mahiro_sidebar_*
  if (pane.tokens && typeof pane.tokens === 'object' && !Array.isArray(pane.tokens)) {
    const rawTokens = pane.tokens as Record<string, unknown>
    const tokens: IPaneTokens = {}
    let hasToken = false

    for (const key of Object.keys(rawTokens)) {
      if (ALLOWED_PANE_TOKEN_KEYS.has(key)) {
        const val = sanitizeBoundedText(rawTokens[key], 512)
        if (val !== undefined) {
          tokens[key] = val
          hasToken = true
        }
      }
    }

    if (hasToken) {
      projected.tokens = tokens
    }
  }

  return projected
}

/**
 * Projects snapshot agents to fallback ownership fields plus the minimal session
 * identity required to preserve replacement-safe browser mutations.
 */
export const projectBrowserAgents = (raw: unknown): ISnapshotAgent[] | undefined => {
  if (!Array.isArray(raw)) return undefined

  return raw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return {}
    const agent = item as Record<string, unknown>
    const target = sanitizeBoundedText(agent.target, 128)
    const pane_id = sanitizeBoundedText(agent.pane_id, 128)
    const projected: ISnapshotAgent = {}
    if (target !== undefined) projected.target = target
    if (pane_id !== undefined) projected.pane_id = pane_id
    if (agent.agent_session && typeof agent.agent_session === 'object' && !Array.isArray(agent.agent_session)) {
      const rawSession = agent.agent_session as Record<string, unknown>
      const value = sanitizeBoundedText(rawSession.value, 256)
      const id = sanitizeBoundedText(rawSession.id, 256)
      if (value !== undefined || id !== undefined) {
        projected.agent_session = {
          ...(value !== undefined ? { value } : {}),
          ...(id !== undefined ? { id } : {})
        }
      }
    }
    return projected
  })
}

/**
 * Creates a focused server-side browser projection of an authoritative snapshot.
 *
 * Enforces:
 * - Fresh allowlisted objects (no spreading of raw input)
 * - Strips unknown top-level, workspace, tab, pane, and agent fields
 * - Strips layouts and state_labels completely
 * - Strips raw arbitrary token maps and Letta identity tokens (letta_pid, letta_started_at, letta_scope, etc.)
 * - Strips absolute worktree paths (repo_root, checkout_path) and absolute worktree token values
 * - Sanitizes free-text fields (ASCII control characters removed, bounded lengths)
 * - Preserves fields required by current browser selection/navigation/action identity/terminal source behavior
 * - Projects snapshot agents to target/pane_id plus strict nested value/id session identity
 */
export const projectBrowserSnapshot = (raw: unknown): ISnapshotResult => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      protocol: 22,
      version: '0.0.0',
      workspaces: [],
      tabs: [],
      panes: []
    }
  }

  const snap = raw as Record<string, unknown>

  const protocol =
    typeof snap.protocol === 'number' && Number.isFinite(snap.protocol)
      ? Math.floor(snap.protocol)
      : 22
  const version = sanitizeBoundedText(snap.version, 64) ?? '0.0.0'

  const focused_workspace_id = sanitizeBoundedText(snap.focused_workspace_id, 128)
  const focused_tab_id = sanitizeBoundedText(snap.focused_tab_id, 128)
  const focused_pane_id = sanitizeBoundedText(snap.focused_pane_id, 128)
  const active_workspace_id = sanitizeBoundedText(snap.active_workspace_id, 128)

  const rawWorkspaces = Array.isArray(snap.workspaces) ? snap.workspaces : []
  const workspaces: IWorkspace[] = []
  for (const item of rawWorkspaces) {
    const projected = projectBrowserWorkspace(item)
    if (projected) workspaces.push(projected)
  }

  const rawTabs = Array.isArray(snap.tabs) ? snap.tabs : []
  const tabs: ITab[] = []
  for (const item of rawTabs) {
    const projected = projectBrowserTab(item)
    if (projected) tabs.push(projected)
  }

  const rawPanes = Array.isArray(snap.panes) ? snap.panes : []
  const panes: IPane[] = []
  for (const item of rawPanes) {
    const projected = projectBrowserPane(item)
    if (projected) panes.push(projected)
  }

  const agents = projectBrowserAgents(snap.agents)

  const projectedSnapshot: ISnapshotResult = {
    protocol,
    version,
    workspaces,
    tabs,
    panes,
    ...(focused_workspace_id !== undefined ? { focused_workspace_id } : {}),
    ...(focused_tab_id !== undefined ? { focused_tab_id } : {}),
    ...(focused_pane_id !== undefined ? { focused_pane_id } : {}),
    ...(active_workspace_id !== undefined ? { active_workspace_id } : {}),
    ...(agents !== undefined ? { agents } : {})
  }

  return projectedSnapshot
}
