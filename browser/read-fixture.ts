import type { ISnapshotResult } from '../src/types/herdr.ts'
import type { IConversationRead } from '../src/types/conversation.ts'

export const snapshot: ISnapshotResult = {
  protocol: 22,
  version: 'fixture',
  focused_workspace_id: 'smoke-space',
  focused_tab_id: 'smoke-tab',
  focused_pane_id: 'smoke-pane',
  workspaces: [
    {
      workspace_id: 'smoke-space',
      label: 'Smoke Space',
      number: 1,
      agent_status: 'idle',
      tab_count: 1,
      pane_count: 1,
      focused: true
    }
  ],
  tabs: [
    {
      tab_id: 'smoke-tab',
      workspace_id: 'smoke-space',
      label: 'Smoke Tab',
      number: 1,
      pane_count: 1,
      focused: true,
      agent_status: 'idle'
    }
  ],
  panes: [
    {
      pane_id: 'smoke-pane',
      workspace_id: 'smoke-space',
      tab_id: 'smoke-tab',
      terminal_id: 'smoke-terminal',
      agent: 'letta',
      agent_session: {
        source: 'fixture',
        agent: 'letta',
        kind: 'id',
        value: 'smoke-session'
      },
      agent_status: 'idle',
      cwd: null,
      focused: true
    }
  ]
}
export const conversation: IConversationRead = {
  ok: true,
  paneId: 'smoke-pane',
  source: 'letta-transcript',
  sessionKey: 'smoke-history',
  turns: Array.from({ length: 24 }, (_, index) => ({
    id: `smoke-turn-${index}`,
    role: index % 2 ? ('assistant' as const) : ('user' as const),
    ts: null,
    parts: [
      {
        kind: 'text' as const,
        text: `Smoke needle ${index}. ${'Deterministic read-only fixture content. '.repeat(12)}`
      }
    ]
  })),
  metadata: { model: null, reasoning_effort: null },
  truncated: false,
  before: null
}

/** No fallback: every unknown read and every write is rejected before native I/O. */
export const readFixture = (
  method: string,
  path: string
): unknown | undefined => {
  if (method !== 'GET') return undefined
  switch (path) {
    case '/api/health':
      return { ok: true, version: 'fixture', serverStatus: 'connected' }
    case '/api/snapshot':
      return { ok: true, snapshot }
    case '/api/conversation':
      return conversation
    case '/api/pane/prompt':
      return {
        prompt: null,
        suggestion: null,
        target: {
          paneId: 'smoke-pane',
          terminalId: 'smoke-terminal',
          expectedMode: 'agent',
          agentSessionId: 'smoke-session'
        }
      }
    case '/api/push/config':
      return { ok: true, enabled: false, reason: 'Read-only smoke fixture' }
    case '/api/interactions/catalog':
      return {
        ok: true,
        source: 'repo-config',
        catalog: { source: 'repo-config', version: 1, items: [] }
      }
    case '/api/agent/explain':
      return {
        ok: true,
        paneId: 'smoke-pane',
        available: false,
        reason: 'fixture'
      }
    default:
      return undefined
  }
}
