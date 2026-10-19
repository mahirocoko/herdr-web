import { describe, expect, it } from 'bun:test'
import type { IPane, ISnapshotResult, ITab, IWorkspace } from '@/types/herdr.ts'
import {
  nativeLaunchStatusCopy,
  ownsIndexCreatePresentation,
  shouldPreserveEmptyCreateSelection,
  LIFECYCLE_CLOSE_UNKNOWN_COPY,
  LIFECYCLE_CREATE_UNKNOWN_COPY,
  deriveWorkspaceSourceChoices,
  freezeTabCloseConfirmation,
  freezeWorkspaceCloseConfirmation,
  initialLifecycleState,
  lifecycleReducer,
  getLifecycleUnknownCopy,
  resolveWorkspaceSourceSelection,
  shouldApplyCreateResultNavigation,
  snapshotConfirmsCreatedTarget,
  tabConfirmationChanged,
  workspaceConfirmationChanged
} from '../lifecycle-operations.ts'
import { reconcileSnapshotSelection } from '../workspace-helpers.ts'

it.each([
  'pending',
  'unknown',
  'rejected',
  'observed',
  'reconciliation-failed'
] as const)(
  'keeps snapshot-first empty-index create presentation owned during %s',
  (phase) => {
    const ticket = {
      requestIdentity: 'create',
      operationId: 'one-post',
      type: 'workspace-create' as const,
      target: {},
      phase,
      reconciliationAttempt: 0,
      error: null,
      result: null
    }
    expect(ownsIndexCreatePresentation(true, null)).toBe(true)
    expect(ownsIndexCreatePresentation(false, ticket)).toBe(true)
    expect(shouldPreserveEmptyCreateSelection(true, null, null)).toBe(true)
    expect(
      shouldPreserveEmptyCreateSelection(true, 'existing', 'existing:pane')
    ).toBe(false)
    const navigation = {
      origin: {
        requestIdentity: 'create',
        pathname: '/',
        workspaceId: null,
        paneId: null
      },
      requestIdentity: 'create',
      attempt: 0,
      currentTicket: ticket,
      currentPathname: '/',
      currentWorkspaceId: null,
      currentPaneId: null
    }
    expect(shouldApplyCreateResultNavigation(navigation)).toBe(
      phase === 'observed'
    )
    expect(
      shouldApplyCreateResultNavigation({
        ...navigation,
        currentPathname: '/spaces/user-selected'
      })
    ).toBe(false)
    expect(ownsIndexCreatePresentation(false, null)).toBe(false)
    expect(shouldPreserveEmptyCreateSelection(false, null, null)).toBe(false)
  }
)

it('escaped native name pattern compiles under v semantics and matches server ASCII contract', () => {
  const htmlPattern = new RegExp('^(?:[a-zA-Z][a-zA-Z0-9_\\-]{0,63})$', 'v')
  const serverPattern = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
  for (const value of [
    'agent_name-1',
    'a'.repeat(64),
    'a'.repeat(65),
    'ไทย',
    '-agent',
    'a;sh',
    ''
  ])
    expect(htmlPattern.test(value)).toBe(serverPattern.test(value))
})

it.each(['letta', 'pi', 'codex', 'agy', 'cursor'])(
  'keeps %s launch ACK distinct, gates duplicate intent and clears only explicit inspection',
  (kind) => {
    const ticket = {
      requestIdentity: 'start',
      operationId: 'op',
      type: 'agent-start' as const,
      target: Object.freeze({
        paneId: 'ws:pane',
        terminalId: 'term',
        name: 'agent',
        kind
      }),
      phase: 'pending' as const,
      reconciliationAttempt: 0,
      error: null,
      result: null
    }
    const pending = lifecycleReducer(initialLifecycleState, {
      type: 'BEGIN',
      ticket
    })
    expect(nativeLaunchStatusCopy(ticket)).toContain(
      `Starting ${{ letta: 'Letta', pi: 'Pi', codex: 'Codex', agy: 'Agy', cursor: 'Cursor' }[kind]}`
    )
    expect(getLifecycleUnknownCopy('agent-start')).not.toContain('Letta')
    expect(
      lifecycleReducer(pending, {
        type: 'BEGIN',
        ticket: { ...ticket, requestIdentity: 'duplicate' }
      })
    ).toBe(pending)
    const ack = lifecycleReducer(pending, {
      type: 'SETTLE',
      requestIdentity: 'start',
      phase: 'acknowledged',
      result: { paneId: 'ws:pane', terminalId: 'term', ready: false }
    })
    expect(
      lifecycleReducer(pending, {
        type: 'SETTLE',
        requestIdentity: 'stale-launch',
        phase: 'acknowledged',
        result: { ready: true }
      })
    ).toBe(pending)
    const unknown = lifecycleReducer(pending, {
      type: 'SETTLE',
      requestIdentity: 'start',
      phase: 'unknown'
    })
    expect(lifecycleReducer(unknown, { type: 'BEGIN', ticket })).toBe(unknown)
    expect(nativeLaunchStatusCopy(ack.ticket!)).toContain(
      'readiness was not corroborated'
    )
    expect(
      lifecycleReducer(ack, {
        type: 'CLEAR_OBSERVED',
        requestIdentity: 'start'
      })
    ).toBe(ack)
    expect(lifecycleReducer(ack, { type: 'BEGIN', ticket })).toBe(ack)
    expect(
      lifecycleReducer(ack, { type: 'CLEAR_UNKNOWN_AFTER_REFRESH' }).ticket
    ).toBeNull()
    expect(
      nativeLaunchStatusCopy({
        ...ack.ticket!,
        result: { ready: true, agentSessionId: 'same', agentStatus: 'idle' }
      })
    ).toContain('at the server snapshot')
  }
)

const workspace = (id: string): IWorkspace => ({
  workspace_id: id,
  label: id,
  number: 1,
  agent_status: 'idle',
  tab_count: 1,
  pane_count: 1,
  focused: false
})
const tab = (id: string, workspaceId: string): ITab => ({
  tab_id: id,
  workspace_id: workspaceId,
  label: id,
  number: 1,
  pane_count: 1,
  focused: false,
  agent_status: 'idle'
})
const pane = (id: string, workspaceId: string, tabId: string): IPane => ({
  pane_id: id,
  workspace_id: workspaceId,
  tab_id: tabId,
  terminal_id: `term-${id}`,
  agent_status: 'idle',
  cwd: '/repo',
  focused: false
})

const makeSnapshot = (): ISnapshotResult => ({
  protocol: 22,
  version: '0.9.1',
  workspaces: [workspace('ws-1'), workspace('ws-2')],
  tabs: [tab('tab-1', 'ws-1'), tab('tab-2', 'ws-1'), tab('tab-3', 'ws-2')],
  panes: [
    pane('ws-1:p1', 'ws-1', 'tab-1'),
    pane('ws-1:p2', 'ws-1', 'tab-2'),
    pane('ws-2:p1', 'ws-2', 'tab-3')
  ]
})

describe('lifecycle operation contracts', () => {
  it('keeps pending and unknown tickets across unrelated drawer lifetime and ignores stale completion', () => {
    const ticket = {
      requestIdentity: 'request-new',
      operationId: 'op-1',
      type: 'workspace-close' as const,
      target: { workspaceId: 'ws-1' },
      phase: 'pending' as const,
      reconciliationAttempt: 0,
      error: null,
      result: null
    }
    const pending = lifecycleReducer(initialLifecycleState, {
      type: 'BEGIN',
      ticket
    })
    const stale = lifecycleReducer(pending, {
      type: 'SETTLE',
      requestIdentity: 'request-old',
      phase: 'observed',
      result: { workspaceId: 'ws-old' }
    })
    expect(stale).toEqual(pending)

    const unknown = lifecycleReducer(pending, {
      type: 'SETTLE',
      requestIdentity: 'request-new',
      phase: 'unknown',
      error: LIFECYCLE_CLOSE_UNKNOWN_COPY
    })
    expect(unknown.ticket?.phase).toBe('unknown')
    expect(lifecycleReducer(unknown, { type: 'BEGIN', ticket })).toEqual(
      unknown
    )
    expect(
      lifecycleReducer(unknown, { type: 'CLEAR_UNKNOWN_AFTER_REFRESH' }).ticket
    ).toBeNull()
  })

  it('detects workspace and tab membership changes before dispatch', () => {
    const snapshot = makeSnapshot()
    const frozenWorkspace = freezeWorkspaceCloseConfirmation(
      snapshot.workspaces[0],
      snapshot.tabs,
      snapshot.panes
    )
    const frozenTab = freezeTabCloseConfirmation(
      snapshot.tabs[0],
      snapshot.panes
    )
    expect(frozenWorkspace.expected).toEqual({
      tabIds: ['tab-1', 'tab-2'],
      paneIds: ['ws-1:p1', 'ws-1:p2']
    })
    expect(frozenTab.expected).toEqual({ paneIds: ['ws-1:p1'] })
    expect(
      workspaceConfirmationChanged(
        frozenWorkspace,
        snapshot.tabs,
        snapshot.panes
      )
    ).toBe(false)
    expect(tabConfirmationChanged(frozenTab, snapshot.panes)).toBe(false)
    expect(
      workspaceConfirmationChanged(frozenWorkspace, snapshot.tabs, [
        ...snapshot.panes,
        pane('ws-1:p3', 'ws-1', 'tab-1')
      ])
    ).toBe(true)
    expect(
      tabConfirmationChanged(frozenTab, [
        ...snapshot.panes,
        pane('ws-1:p3', 'ws-1', 'tab-1')
      ])
    ).toBe(true)
  })

  it('offers only Herdr default or terminal-backed panes as workspace sources', () => {
    const snapshot = makeSnapshot()
    snapshot.panes.push({
      ...pane('ws-2:p-no-terminal', 'ws-2', 'tab-3'),
      terminal_id: undefined
    })
    const choices = deriveWorkspaceSourceChoices(
      snapshot.workspaces,
      snapshot.panes
    )
    expect(choices[0]).toEqual({
      key: 'herdr-default',
      label: 'Herdr default directory'
    })
    expect(choices.some((choice) => choice.key === 'ws-2:p-no-terminal')).toBe(
      false
    )
    expect(
      choices.slice(1).every((choice) => Boolean(choice.source?.terminalId))
    ).toBe(true)
    expect(resolveWorkspaceSourceSelection(choices, 'herdr-default')).toEqual({
      kind: 'default'
    })
    expect(resolveWorkspaceSourceSelection(choices, 'ws-1:p1')).toMatchObject({
      kind: 'source'
    })
    expect(
      resolveWorkspaceSourceSelection(
        choices.filter((choice) => choice.key !== 'ws-1:p1'),
        'ws-1:p1'
      )
    ).toEqual({ kind: 'missing' })
  })

  it('uses operation-specific unknown copy', () => {
    expect(getLifecycleUnknownCopy('workspace-create')).toBe(
      LIFECYCLE_CREATE_UNKNOWN_COPY
    )
    expect(getLifecycleUnknownCopy('workspace-close')).toBe(
      LIFECYCLE_CLOSE_UNKNOWN_COPY
    )
    expect(getLifecycleUnknownCopy('tab-close')).toBe(
      LIFECYCLE_CLOSE_UNKNOWN_COPY
    )
  })

  it('gates reconciliation failure and retries without replaying the mutation', () => {
    const ticket = {
      requestIdentity: 'request-reconcile',
      operationId: 'op-reconcile',
      type: 'workspace-create' as const,
      target: {},
      phase: 'observed' as const,
      reconciliationAttempt: 0,
      error: null,
      result: { workspaceId: 'ws-new', tabId: 'tab-new', paneId: 'pane-new' }
    }
    const observed = { ticket, latestRequestIdentity: ticket.requestIdentity }
    const failed = lifecycleReducer(observed, {
      type: 'RECONCILE_FAILED',
      requestIdentity: ticket.requestIdentity,
      attempt: 0,
      error: 'not confirmed'
    })
    expect(failed.ticket?.phase).toBe('reconciliation-failed')
    expect(lifecycleReducer(failed, { type: 'BEGIN', ticket })).toEqual(failed)
    const retrying = lifecycleReducer(failed, {
      type: 'RETRY_RECONCILIATION',
      requestIdentity: ticket.requestIdentity
    })
    expect(retrying.ticket?.phase).toBe('observed')
    expect(retrying.ticket?.reconciliationAttempt).toBe(1)
    expect(retrying.ticket?.operationId).toBe('op-reconcile')
  })

  it('prevents create-result navigation when user navigation changes during refresh', () => {
    const ticket = {
      requestIdentity: 'request-nav',
      operationId: 'op-nav',
      type: 'workspace-create' as const,
      target: {},
      phase: 'observed' as const,
      reconciliationAttempt: 0,
      error: null,
      result: { workspaceId: 'ws-new', tabId: 'tab-new', paneId: 'pane-new' }
    }
    const origin = {
      requestIdentity: ticket.requestIdentity,
      pathname: '/spaces/ws-old',
      workspaceId: 'ws-old',
      paneId: 'pane-old'
    }
    expect(
      shouldApplyCreateResultNavigation({
        origin,
        requestIdentity: ticket.requestIdentity,
        attempt: 0,
        currentTicket: ticket,
        currentPathname: '/spaces/ws-old',
        currentWorkspaceId: 'ws-old',
        currentPaneId: 'pane-old'
      })
    ).toBe(true)
    expect(
      shouldApplyCreateResultNavigation({
        origin,
        requestIdentity: ticket.requestIdentity,
        attempt: 0,
        currentTicket: ticket,
        currentPathname: '/spaces/ws-user-selected',
        currentWorkspaceId: 'ws-user-selected',
        currentPaneId: 'pane-user-selected'
      })
    ).toBe(false)
    expect(
      shouldApplyCreateResultNavigation({
        origin,
        requestIdentity: ticket.requestIdentity,
        attempt: 0,
        currentTicket: { ...ticket, requestIdentity: 'newer-request' },
        currentPathname: origin.pathname,
        currentWorkspaceId: origin.workspaceId,
        currentPaneId: origin.paneId
      })
    ).toBe(false)
    expect(
      shouldApplyCreateResultNavigation({
        origin,
        requestIdentity: ticket.requestIdentity,
        attempt: 0,
        currentTicket: { ...ticket, reconciliationAttempt: 1 },
        currentPathname: origin.pathname,
        currentWorkspaceId: origin.workspaceId,
        currentPaneId: origin.paneId
      })
    ).toBe(false)
  })

  it('confirms observed create identity only when workspace, tab, and pane relationships exist', () => {
    const snapshot = makeSnapshot()
    expect(
      snapshotConfirmsCreatedTarget(snapshot, {
        workspaceId: 'ws-1',
        tabId: 'tab-1',
        paneId: 'ws-1:p1'
      })
    ).toBe(true)
    expect(
      snapshotConfirmsCreatedTarget(snapshot, {
        workspaceId: 'ws-2',
        tabId: 'tab-1',
        paneId: 'ws-1:p1'
      })
    ).toBe(false)
  })

  it('preserves selection, falls back within a Space after Tab removal, then globally and finally clears', () => {
    const snapshot = makeSnapshot()
    expect(reconcileSnapshotSelection(snapshot, 'ws-1', 'ws-1:p1')).toEqual({
      workspaceId: 'ws-1',
      paneId: 'ws-1:p1'
    })

    const withoutSelectedTab = {
      ...snapshot,
      tabs: snapshot.tabs.filter((item) => item.tab_id !== 'tab-1'),
      panes: snapshot.panes.filter((item) => item.tab_id !== 'tab-1')
    }
    expect(
      reconcileSnapshotSelection(withoutSelectedTab, 'ws-1', 'ws-1:p1')
    ).toEqual({ workspaceId: 'ws-1', paneId: 'ws-1:p2' })

    const onlySecond = {
      ...snapshot,
      workspaces: snapshot.workspaces.filter(
        (item) => item.workspace_id === 'ws-2'
      ),
      tabs: snapshot.tabs.filter((item) => item.workspace_id === 'ws-2'),
      panes: snapshot.panes.filter((item) => item.workspace_id === 'ws-2')
    }
    expect(reconcileSnapshotSelection(onlySecond, 'ws-1', 'ws-1:p1')).toEqual({
      workspaceId: 'ws-2',
      paneId: 'ws-2:p1'
    })
    expect(
      reconcileSnapshotSelection(
        { ...snapshot, workspaces: [], tabs: [], panes: [] },
        'ws-1',
        'ws-1:p1'
      )
    ).toEqual({ workspaceId: null, paneId: null })
  })
})
