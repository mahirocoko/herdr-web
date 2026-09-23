export interface IWorkspaceTokens {
  mahiro_workspace_branch?: string
  mahiro_workspace_git_status?: 'clean' | 'dirty'
  mahiro_workspace_worktree?: string
}

export interface IWorkspaceWorktree {
  repo_name: string
  is_linked_worktree: boolean
}

export interface IWorkspace {
  workspace_id: string
  label: string
  number: number
  agent_status: 'idle' | 'working' | 'blocked' | 'done' | 'unknown' | string
  tab_count: number
  pane_count: number
  active_tab_id?: string
  focused: boolean
  tokens?: IWorkspaceTokens
  worktree?: IWorkspaceWorktree
}

export interface ITab {
  tab_id: string
  workspace_id: string
  label: string
  number: number
  pane_count: number
  focused: boolean
  agent_status: string
}

export interface IPaneScroll {
  offset_from_bottom: number
  max_offset_from_bottom: number
  viewport_rows: number
}

export interface IPaneTokens {
  summary?: string
  subagents?: string
  subagents_running?: string
  mahiro_sidebar_context?: string
  mahiro_sidebar_model?: string
  mahiro_sidebar_provider?: string
  mahiro_sidebar_q1_critical?: string
}

export interface IAgentSessionInfo {
  source: string
  agent: string
  kind: 'id' | 'path' | string
  value: string
}

export interface IPane {
  pane_id: string
  workspace_id: string
  tab_id: string
  terminal_id?: string
  agent?: string
  agent_session?: IAgentSessionInfo | null
  agent_status: 'idle' | 'working' | 'blocked' | 'done' | 'unknown' | string
  title?: string
  terminal_title?: string
  terminal_title_stripped?: string
  display_agent?: string
  cwd: string | null
  foreground_cwd?: string | null
  focused: boolean
  revision?: number
  scroll?: IPaneScroll
  tokens?: IPaneTokens
}

export interface ISnapshotAgent {
  target?: string
  pane_id?: string
  agent_session?: {
    value?: string
    id?: string
  }
}

export interface ISnapshotResult {
  focused_workspace_id?: string
  focused_tab_id?: string
  focused_pane_id?: string
  active_workspace_id?: string
  workspaces: IWorkspace[]
  tabs: ITab[]
  panes: IPane[]
  protocol: number
  version: string
  agents?: ISnapshotAgent[]
}

export type IExpectedPaneMode = 'agent' | 'blocked-agent' | 'shell'

export interface IActionTargetIdentity {
  paneId: string
  terminalId: string
  expectedMode: IExpectedPaneMode
  agentSessionId?: string
}

export interface ITabCreateTargetIdentity {
  paneId: string
  terminalId: string
}

export interface IWorkspaceCreateSource {
  workspaceId: string
  paneId: string
  terminalId: string
}

export interface IWorkspaceCloseTargetIdentity {
  workspaceId: string
  expected: {
    tabIds: string[]
    paneIds: string[]
  }
}

export interface ITabCloseTargetIdentity {
  workspaceId: string
  tabId: string
  expected: {
    paneIds: string[]
  }
}

export type IStrictActionRequest =
  | {
      type: 'prompt'
      operationId: string
      target: IActionTargetIdentity
      text: string
    }
  | {
      type: 'keys'
      operationId: string
      target: IActionTargetIdentity
      keys: string[]
    }
  | {
      type: 'terminal-input'
      operationId: string
      target: IActionTargetIdentity
      text: string
    }
  | {
      type: 'tab-create'
      operationId: string
      workspaceId: string
      target: ITabCreateTargetIdentity
      label?: string
    }
  | {
      type: 'workspace-create'
      operationId: string
      label?: string
      source?: IWorkspaceCreateSource
    }
  | {
      type: 'workspace-close'
      operationId: string
      target: IWorkspaceCloseTargetIdentity
    }
  | {
      type: 'tab-close'
      operationId: string
      target: ITabCloseTargetIdentity
    }

export type ILifecycleActionRequest = Extract<
  IStrictActionRequest,
  { type: 'workspace-create' | 'workspace-close' | 'tab-close' }
>

export type IActionRequest = IStrictActionRequest

export type ICatalogSourceKind = 'repo-config' | 'native-agent' | 'server-preset'

export interface ICatalogItem {
  id: string
  label: string
  fillValue: string
  description?: string
  category?: string
  mode?: 'agent' | 'shell' | 'both'
}

export interface IInteractionCatalog {
  source: ICatalogSourceKind
  version: number
  items: ICatalogItem[]
}

export interface INativeChoiceOption {
  id: string
  label: string
  description?: string
}

export interface INativeInteractionEnvelope {
  providerId: string
  providerVersion: string
  target: IActionTargetIdentity
  interactionId: string
  revision: number
  expiresAt?: number
  responseMethod: string
  choices: INativeChoiceOption[]
}

export interface INativeChoiceResponse {
  interactionId: string
  choiceId: string
  target: IActionTargetIdentity
  revision: number
}

export type IActionOutcome = 'acknowledged' | 'observed' | 'rejected' | 'unknown'

export interface IActionResult {
  workspaceId?: string
  tabId?: string
  paneId?: string
  [key: string]: unknown
}

export interface IActionResponse {
  ok: boolean
  outcome?: IActionOutcome
  error?: string
  status?: number
  result?: IActionResult
}

export type IPaneReadSource = 'detection' | 'visible' | 'recent-unwrapped'

export interface IPaneReadResult {
  ok: boolean
  paneId: string
  source: IPaneReadSource
  content: string
}

export interface ITerminalFrame {
  type: 'terminal.frame'
  seq: number
  encoding: 'ansi'
  width: number
  height: number
  full: boolean
  bytes: string
}

export interface ITerminalClosed {
  type: 'terminal.closed'
  reason?: string
}

export type ISnapshotStatus = 'loading' | 'connected' | 'reconnecting' | 'error' | 'empty'

export type IManifestSourceKind = 'remote' | 'local' | 'builtin' | 'unknown'

export interface IAgentExplainMatchedRule {
  id: string
  region: string
  state: string
}

export interface IAgentExplainManifest {
  sourceKind: IManifestSourceKind
  version?: string
}

export interface IAgentExplainResult {
  ok: boolean
  paneId: string
  available: boolean
  reason?: string
  agent?: string
  state?: string
  matchedRule?: IAgentExplainMatchedRule
  manifest?: IAgentExplainManifest
  visibleBlocker?: boolean
  visibleIdle?: boolean
  visibleWorking?: boolean
  screenDetectionSkipped?: boolean
  stateUpdateSkipped?: boolean
}

export interface ITerminalControlStatusResult {
  ok: true
  pane: string
  leased: boolean
  status: 'pending' | 'active' | 'releasing' | null
}
