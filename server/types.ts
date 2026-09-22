export interface IHerdrHealth {
  ok: boolean
  version: string
  serverStatus: string
  herdrOk: boolean
  timestamp: string
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
  [key: string]: string | undefined
}

export interface IAgentSessionInfo {
  source: string
  agent: string
  kind: 'id' | 'path' | string
  value: string
  id?: string
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
  state_labels?: Record<string, string>
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
  layouts?: any[]
  agents?: any[]
}

export interface ISnapshotEnvelope {
  type: 'session_snapshot'
  result: ISnapshotResult
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

export interface IWorkspaceCloseExpectedMembership {
  tabIds: string[]
  paneIds: string[]
}

export interface IWorkspaceCloseTargetIdentity {
  workspaceId: string
  expected: IWorkspaceCloseExpectedMembership
}

export interface ITabCloseExpectedMembership {
  paneIds: string[]
}

export interface ITabCloseTargetIdentity {
  workspaceId: string
  tabId: string
  expected: ITabCloseExpectedMembership
}

export type IActionRequest =
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

export interface IWorkspaceCreateExecutionResult {
  ok: boolean
  status?: number
  error?: string
  outcome?: 'observed' | 'rejected' | 'unknown'
  result?: {
    workspaceId: string
    tabId: string
    paneId: string
  }
}

export interface IWorkspaceCloseExecutionResult {
  ok: boolean
  status?: number
  error?: string
  outcome?: 'observed' | 'rejected' | 'unknown'
  result?: {
    workspaceId: string
  }
}

export interface ITabCloseExecutionResult {
  ok: boolean
  status?: number
  error?: string
  outcome?: 'observed' | 'rejected' | 'unknown'
  result?: {
    workspaceId: string
    tabId: string
  }
}

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

export interface IActionResponse {
  ok: boolean
  outcome?: IActionOutcome
  error?: string
  status?: number
  result?: any
}

export type IPaneReadSource = 'detection' | 'visible' | 'recent-unwrapped'

export interface IPaneReadOptions {
  source?: IPaneReadSource
  lines?: number
}

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
  warning?: string
  fallbackReason?: string
}
