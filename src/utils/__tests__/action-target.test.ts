import { describe, expect, it } from 'bun:test'
import {
  deriveActionTarget,
  deriveTabCreateSourcePanes,
  formatActionErrorMessage,
  orderBlockedPanes,
  canSubmitNewTab,
  resolveAttentionCloseFocusTarget
} from '../action-target.ts'
import type { IPane, ITab, IWorkspace } from '@/types/herdr.ts'

describe('deriveActionTarget', () => {
  it('returns error when pane is missing or has no pane_id', () => {
    expect(deriveActionTarget(null)).toEqual({ target: null, error: 'No pane selected' })
    expect(deriveActionTarget({})).toEqual({ target: null, error: 'No pane selected' })
  })

  it('requires terminal_id and returns truthful refresh guidance when missing', () => {
    const pane: Partial<IPane> = { pane_id: 'pane-1', terminal_id: undefined }
    expect(deriveActionTarget(pane)).toEqual({
      target: null,
      error: 'Terminal identity missing for this pane. Refresh snapshot to retry.'
    })

    const paneEmptyTerminal: Partial<IPane> = { pane_id: 'pane-1', terminal_id: '   ' }
    expect(deriveActionTarget(paneEmptyTerminal)).toEqual({
      target: null,
      error: 'Terminal identity missing for this pane. Refresh snapshot to retry.'
    })
  })

  it('derives expectedMode as shell when pane is not agent-owned, omitting agentSessionId', () => {
    const pane: Partial<IPane> = {
      pane_id: 'pane-shell',
      terminal_id: 'term-1',
      agent: '',
      display_agent: '',
      agent_status: 'idle'
    }
    const res = deriveActionTarget(pane)
    expect(res.error).toBeUndefined()
    expect(res.target).toEqual({
      paneId: 'pane-shell',
      terminalId: 'term-1',
      expectedMode: 'shell'
    })
  })

  it('derives expectedMode as agent when agent-owned and not blocked', () => {
    const pane: Partial<IPane> = {
      pane_id: 'pane-agent',
      terminal_id: 'term-2',
      agent: 'gemini',
      agent_status: 'working',
      agent_session: { source: 'herdr', agent: 'gemini', kind: 'id', value: 'sess-123' }
    }
    const res = deriveActionTarget(pane)
    expect(res.target).toEqual({
      paneId: 'pane-agent',
      terminalId: 'term-2',
      expectedMode: 'agent',
      agentSessionId: 'sess-123'
    })
  })

  it('derives expectedMode as blocked-agent when agent-owned and blocked', () => {
    const pane: Partial<IPane> = {
      pane_id: 'pane-blocked',
      terminal_id: 'term-3',
      display_agent: 'Claude',
      agent_status: 'blocked',
      agent_session: { source: 'herdr', agent: 'claude', kind: 'id', value: 'sess-456' }
    }
    const res = deriveActionTarget(pane)
    expect(res.target).toEqual({
      paneId: 'pane-blocked',
      terminalId: 'term-3',
      expectedMode: 'blocked-agent',
      agentSessionId: 'sess-456'
    })
  })

  it('extracts agentSessionId from snapshot agents if absent on pane', () => {
    const pane: Partial<IPane> = {
      pane_id: 'pane-agent-snap',
      terminal_id: 'term-4',
      agent: 'codex',
      agent_status: 'working'
    }
    const snapshotAgents = [
      {
        target: 'pane-agent-snap',
        agent_session: { value: 'sess-from-snap' }
      }
    ]
    const res = deriveActionTarget(pane, snapshotAgents)
    expect(res.target).toEqual({
      paneId: 'pane-agent-snap',
      terminalId: 'term-4',
      expectedMode: 'agent',
      agentSessionId: 'sess-from-snap'
    })
  })

  it('omits agentSessionId in shell mode even if snapshot has unrelated agent data', () => {
    const pane: Partial<IPane> = {
      pane_id: 'pane-pure-shell',
      terminal_id: 'term-5',
      agent_status: 'idle'
    }
    const snapshotAgents = [{ target: 'other-pane', agent_session: { value: 'sess-other' } }]
    const res = deriveActionTarget(pane, snapshotAgents)
    expect(res.target).toEqual({
      paneId: 'pane-pure-shell',
      terminalId: 'term-5',
      expectedMode: 'shell'
    })
  })
})

describe('deriveTabCreateSourcePanes', () => {
  const samplePanes: IPane[] = [
    {
      pane_id: 'p1',
      workspace_id: 'ws-1',
      tab_id: 't1',
      terminal_id: 'term-1',
      foreground_cwd: '/Users/example/herdr',
      cwd: '/tmp',
      focused: false,
      agent_status: 'idle'
    },
    {
      pane_id: 'p2',
      workspace_id: 'ws-1',
      tab_id: 't1',
      terminal_id: 'term-2',
      cwd: '/Users/example/herdr', // same CWD
      focused: false,
      agent_status: 'idle'
    },
    {
      pane_id: 'p3',
      workspace_id: 'ws-1',
      tab_id: 't2',
      terminal_id: 'term-3',
      foreground_cwd: '/tmp/build',
      cwd: '/tmp',
      focused: false,
      agent_status: 'idle'
    },
    {
      pane_id: 'p4',
      workspace_id: 'ws-2', // different workspace
      tab_id: 't3',
      terminal_id: 'term-4',
      foreground_cwd: '/var/log',
      cwd: '/tmp',
      focused: false,
      agent_status: 'idle'
    },
    {
      pane_id: 'p5',
      workspace_id: 'ws-1',
      tab_id: 't1',
      terminal_id: '', // missing terminal_id
      foreground_cwd: '/dev/null',
      cwd: '/tmp',
      focused: false,
      agent_status: 'idle'
    }
  ]

  it('filters by destination workspace and valid terminal identity, deduplicating unique CWDs', () => {
    const choices = deriveTabCreateSourcePanes(samplePanes, 'ws-1')
    expect(choices).toHaveLength(2)
    expect(choices[0].displayCwd).toBe('/Users/example/herdr')
    expect(choices[0].pane.pane_id).toBe('p1')
    expect(choices[1].displayCwd).toBe('/tmp/build')
    expect(choices[1].pane.pane_id).toBe('p3')
  })

  it('prioritizes preferredPaneId if it belongs to Space', () => {
    const choices = deriveTabCreateSourcePanes(samplePanes, 'ws-1', 'p2')
    expect(choices).toHaveLength(2)
    expect(choices[0].pane.pane_id).toBe('p2')
    expect(choices[0].displayCwd).toBe('/Users/example/herdr')
  })
})

describe('orderBlockedPanes', () => {
  const workspaces: IWorkspace[] = [
    { workspace_id: 'ws-b', number: 2, label: 'Space B', tab_count: 1, pane_count: 1, focused: false, agent_status: 'blocked' },
    { workspace_id: 'ws-a', number: 1, label: 'Space A', tab_count: 1, pane_count: 1, focused: false, agent_status: 'blocked' }
  ]

  const tabs: ITab[] = [
    { tab_id: 't-2', workspace_id: 'ws-b', number: 2, label: 'Tab 2', pane_count: 1, focused: false, agent_status: 'blocked' },
    { tab_id: 't-1', workspace_id: 'ws-b', number: 1, label: 'Tab 1', pane_count: 1, focused: false, agent_status: 'blocked' },
    { tab_id: 't-a', workspace_id: 'ws-a', number: 1, label: 'Tab A', pane_count: 1, focused: false, agent_status: 'blocked' }
  ]

  const blocked: IPane[] = [
    { pane_id: 'pane-other-2', workspace_id: 'ws-b', tab_id: 't-2', cwd: '/tmp', focused: false, agent_status: 'blocked' },
    { pane_id: 'pane-other-1', workspace_id: 'ws-b', tab_id: 't-1', cwd: '/tmp', focused: false, agent_status: 'blocked' },
    { pane_id: 'pane-current-2', workspace_id: 'ws-a', tab_id: 't-a', cwd: '/tmp', focused: false, agent_status: 'blocked' },
    { pane_id: 'pane-current-1', workspace_id: 'ws-a', tab_id: 't-a', cwd: '/tmp', focused: false, agent_status: 'blocked' }
  ]

  it('orders current Space first, then by workspace.number, tab.number, and pane_id', () => {
    const ordered = orderBlockedPanes(blocked, 'ws-a', workspaces, tabs)
    // ws-a is current space: pane-current-1, pane-current-2
    expect(ordered[0].pane_id).toBe('pane-current-1')
    expect(ordered[1].pane_id).toBe('pane-current-2')
    // ws-b is other space: t-1 (num 1) before t-2 (num 2)
    expect(ordered[2].pane_id).toBe('pane-other-1')
    expect(ordered[3].pane_id).toBe('pane-other-2')
  })
})

describe('formatActionErrorMessage', () => {
  it('formats unknown outcome as truthful inspection message', () => {
    expect(formatActionErrorMessage({ outcome: 'unknown', error: 'Gateway timeout' })).toBe(
      'Outcome unknown — inspect the pane before sending again.'
    )
  })

  it('formats standard error message when outcome is not unknown', () => {
    expect(formatActionErrorMessage(new Error('Permission denied'))).toBe('Permission denied')
    expect(formatActionErrorMessage({ outcome: 'rejected', message: 'Pane busy' })).toBe('Pane busy')
  })
})

describe('canSubmitNewTab', () => {
  it('allows submission when not creating, has choices, and outcome is null or acknowledged', () => {
    expect(
      canSubmitNewTab({
        isCreatingTab: false,
        hasChoices: true,
        createTabOutcome: null
      })
    ).toBe(true)

    expect(
      canSubmitNewTab({
        isCreatingTab: false,
        hasChoices: true,
        createTabOutcome: 'observed'
      })
    ).toBe(true)
  })

  it('disallows submission while isCreatingTab is true', () => {
    expect(
      canSubmitNewTab({
        isCreatingTab: true,
        hasChoices: true,
        createTabOutcome: null
      })
    ).toBe(false)
  })

  it('disallows submission when hasChoices is false', () => {
    expect(
      canSubmitNewTab({
        isCreatingTab: false,
        hasChoices: false,
        createTabOutcome: null
      })
    ).toBe(false)
  })

  it('strictly disallows submission when createTabOutcome is unknown to prevent duplicate retries', () => {
    expect(
      canSubmitNewTab({
        isCreatingTab: false,
        hasChoices: true,
        createTabOutcome: 'unknown'
      })
    ).toBe(false)
  })
})

describe('resolveAttentionCloseFocusTarget', () => {
  it('returns actionTriggerEl when present and connected', () => {
    const triggerEl = { isConnected: true } as HTMLElement
    const fallbackEl = { isConnected: true } as HTMLElement
    expect(resolveAttentionCloseFocusTarget(triggerEl, fallbackEl)).toBe(triggerEl)
  })

  it('returns fallbackEl when actionTriggerEl is null or disconnected', () => {
    const fallbackEl = { isConnected: true } as HTMLElement
    expect(resolveAttentionCloseFocusTarget(null, fallbackEl)).toBe(fallbackEl)

    const disconnectedTrigger = { isConnected: false } as HTMLElement
    expect(resolveAttentionCloseFocusTarget(disconnectedTrigger, fallbackEl)).toBe(fallbackEl)
  })

  it('returns null when neither trigger nor fallback are valid/connected', () => {
    expect(resolveAttentionCloseFocusTarget(null, null)).toBeNull()
    const disconnectedFallback = { isConnected: false } as HTMLElement
    expect(resolveAttentionCloseFocusTarget(null, disconnectedFallback)).toBeNull()
  })
})
