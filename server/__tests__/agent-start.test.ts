import { describe, expect, it } from 'bun:test'
import { createServer } from '../index.ts'
import { executeAgentStart } from '../herdr-adapter.ts'
import { HerdrSocketError } from '../herdr-socket.ts'
import { validateActionRequest } from '../security.ts'
import {
  OperationCoordinator,
  computePayloadFingerprint
} from '../operation-coordinator.ts'
import type { IAgentStartAction, ISnapshotResult } from '../types.ts'

describe.each(['letta', 'pi'] as const)('%s native launch', (kind) => {
  const newArgs = kind === 'letta' ? ['--new'] : []
  const expectedArgv = [kind, ...newArgs]
  const action: IAgentStartAction = {
    type: 'agent-start',
    operationId: 'start-1',
    target: { paneId: 'pane:test', terminalId: 'term_test' },
    kind,
    name: 'test-agent'
  }
  const shell: ISnapshotResult = {
    protocol: 22,
    version: '0.9.4',
    workspaces: [],
    tabs: [],
    panes: [
      {
        pane_id: 'pane:test',
        terminal_id: 'term_test',
        workspace_id: 'ws_test',
        tab_id: 'tab_test',
        agent_status: 'idle',
        cwd: null,
        focused: false
      }
    ]
  }
  const agent = {
    ...shell.panes[0],
    revision: 1,
    agent: kind,
    name: action.name,
    agent_session: {
      source: 'test',
      agent: kind,
      kind: 'id',
      value: 'session_test'
    },
    interactive_ready: true,
    launch_pending: false
  }
  const launched = { ...shell, panes: [agent] }
  const setup = (
    response: unknown = {
      type: 'agent_started',
      agent,
      argv: [...expectedArgv]
    },
    post = launched
  ) => {
    let reads = 0
    const calls: unknown[][] = []
    const deps = {
      fetchSnapshot: async () => (++reads <= 2 ? shell : post),
      fetchProcessInfo: async () => ({
        pane_id: 'pane:test',
        shell_pid: 123,
        foreground_process_group_id: 123,
        foreground_processes: [{ pid: 123 }]
      }),
      sendSocketRequest: async (...args: any[]) => {
        calls.push(args)
        if (response instanceof Error) throw response
        return response as any
      }
    }
    return { deps, calls }
  }

  describe('native agent start checkpoint (all dispatch mocked)', () => {
    it('verifies native UNKNOWN shell process before explicit dispatch', async () => {
      const fixture = setup()
      let reads = 0
      const unknownShell = {
        ...shell,
        panes: [{ ...shell.panes[0], agent_status: 'unknown' }]
      }
      const result = await executeAgentStart(action, {
        deps: {
          ...fixture.deps,
          fetchSnapshot: async () => (++reads <= 2 ? unknownShell : launched),
          fetchProcessInfo: async () => ({
            pane_id: action.target.paneId,
            shell_pid: 60667,
            foreground_process_group_id: 60667,
            foreground_processes: [{ pid: 60667, name: '-zsh' }]
          })
        }
      })
      expect(result.outcome).toBe('acknowledged')
      expect(result.result?.ready).toBe(true)
      expect(fixture.calls).toHaveLength(1)
    })

    it('rejects UNKNOWN non-shell process without dispatch', async () => {
      const fixture = setup()
      const result = await executeAgentStart(action, {
        deps: {
          ...fixture.deps,
          fetchSnapshot: async () => ({
            ...shell,
            panes: [{ ...shell.panes[0], agent_status: 'unknown' }]
          }),
          fetchProcessInfo: async () => ({
            pane_id: action.target.paneId,
            shell_pid: 60667,
            foreground_process_group_id: 60668,
            foreground_processes: [{ pid: 60668, name: 'busy-process' }]
          })
        }
      })
      expect(result.outcome).toBe('rejected')
      expect(fixture.calls).toHaveLength(0)
    })

    it('rejects an agent appearing after shell verification without dispatch', async () => {
      const fixture = setup()
      let reads = 0
      const result = await executeAgentStart(action, {
        deps: {
          ...fixture.deps,
          fetchSnapshot: async () => (++reads === 1 ? shell : launched)
        }
      })
      expect(result.outcome).toBe('rejected')
      expect(fixture.calls).toHaveLength(0)
    })
    it('POST fences auth/exact terminal, caches unknown and passes adapter snapshot options without native redispatch', async () => {
      const fixture = setup(new Error('timeout'))
      const fetchSnapshot = async () => shell
      let executions = 0
      const coordinator = new OperationCoordinator()
      const server = createServer(0, '127.0.0.1', {
        startPushBridge: false,
        deps: {
          coordinator,
          fetchSnapshot,
          executeAgentStart: async (request, options) => {
            executions++
            expect(options?.deps?.fetchSnapshot).toBe(fetchSnapshot)
            return executeAgentStart(request, fixture)
          }
        }
      })
      const post = (
        body = action,
        origin: string | null = `http://127.0.0.1:${server.port}`
      ) =>
        fetch(`http://127.0.0.1:${server.port}/api/action`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(origin ? { origin } : {})
          },
          body: JSON.stringify(body)
        })
      try {
        expect((await post(action, null)).status).toBe(403)
        expect(
          (
            await post({
              ...action,
              operationId: 'replaced',
              target: { ...action.target, terminalId: 'other' }
            })
          ).status
        ).toBe(409)
        expect(executions).toBe(0)
        const control = coordinator.claimPaneForControl(
          action.target.paneId,
          'lease-test'
        )
        expect(control.ok).toBe(true)
        expect((await post()).status).toBe(409)
        expect(executions).toBe(0)
        if (control.ok) coordinator.releaseControlPane(control.token)
        const first = await post()
        expect(first.status).toBe(504)
        expect((await first.json()).outcome).toBe('unknown')
        expect((await post()).status).toBe(504)
        expect((await post({ ...action, name: 'changed' })).status).toBe(409)
        expect(executions).toBe(1)
        expect(fixture.calls.length).toBe(1)
      } finally {
        server.stop(true)
      }
    })
    it('POST holds pending launch admission against duplicate and competing lifecycle intent', async () => {
      let release!: () => void
      let entered!: () => void
      const active = new Promise<void>((resolve) => {
        entered = resolve
      })
      const deferred = new Promise<void>((resolve) => {
        release = resolve
      })
      const server = createServer(0, '127.0.0.1', {
        startPushBridge: false,
        deps: {
          coordinator: new OperationCoordinator(),
          fetchSnapshot: async () => shell,
          executeAgentStart: async () => {
            entered()
            await deferred
            return {
              ok: true,
              status: 200,
              outcome: 'acknowledged',
              result: {
                paneId: action.target.paneId,
                terminalId: action.target.terminalId,
                ready: false
              }
            }
          }
        }
      })
      const post = (body: unknown) =>
        fetch(`http://127.0.0.1:${server.port}/api/action`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: `http://127.0.0.1:${server.port}`
          },
          body: JSON.stringify(body)
        })
      const pending = post(action)
      try {
        await active
        expect((await post(action)).status).toBe(409)
        expect(
          (await post({ type: 'workspace-create', operationId: 'another' }))
            .status
        ).toBe(409)
        release()
        expect((await pending).status).toBe(200)
      } finally {
        release()
        await pending
        server.stop(true)
      }
    })
    it('allows only trusted kind intent without client launch overrides', () => {
      expect(validateActionRequest(action).valid).toBe(true)
      for (const override of [
        { args: [] },
        { args: ['--new'] },
        { backend: 'local' },
        { unexpected: true },
        { model: 'x' },
        { kind: 'agy' },
        { name: 'x;sh' },
        { target: { ...action.target, agentSessionId: 'old' } }
      ])
        expect(validateActionRequest({ ...action, ...override }).valid).toBe(
          false
        )
    })
    it('sends server-owned new-conversation args and correlates fresh session/status, not argv to browser', async () => {
      const { deps, calls } = setup()
      const result = await executeAgentStart(action, { deps })
      expect(calls).toEqual([
        [
          'agent.start',
          {
            name: action.name,
            kind,
            pane_id: 'pane:test',
            args: newArgs
          },
          { timeoutMs: 35000 }
        ]
      ])
      expect(result).toMatchObject({
        ok: true,
        outcome: 'acknowledged',
        result: {
          ready: true,
          agentSessionId: 'session_test',
          agentStatus: 'idle'
        }
      })
      expect(JSON.stringify(result)).not.toContain('argv')
    })
    it('acknowledges schema-shaped nullable/omitted kind, name and session without readiness proof', async () => {
      for (const optional of [
        {},
        { agent: null, name: null, agent_session: null }
      ]) {
        // Exact required AgentInfo fields from the tracked success-response schema.
        const nativeAgent = { ...shell.panes[0], revision: 1, ...optional }
        const fixture = setup({
          type: 'agent_started',
          agent: nativeAgent,
          argv: [...expectedArgv]
        })
        const result = await executeAgentStart(action, fixture)
        expect(result).toEqual({
          ok: true,
          status: 200,
          outcome: 'acknowledged',
          result: { ...action.target, ready: false }
        })
        // Even a post-read showing an agent/session cannot manufacture a returned session.
        expect(fixture.calls.length).toBe(1)
      }
    })
    it('keeps missing required identity and provided mismatching identity unknown', async () => {
      for (const [identity, diagnostic] of [
        [{ ...agent, terminal_id: undefined }, 'missing_identity'],
        [{ ...agent, pane_id: undefined }, 'missing_identity'],
        [{ ...agent, terminal_id: 'other' }, 'identity_mismatch'],
        [{ ...agent, pane_id: 'other' }, 'identity_mismatch'],
        [{ ...agent, agent: 'codex' }, 'identity_mismatch'],
        [{ ...agent, name: 'other' }, 'identity_mismatch'],
        [{ ...agent, name: '' }, 'identity_mismatch']
      ] as const) {
        const fixture = setup({
          type: 'agent_started',
          agent: identity,
          argv: [...expectedArgv]
        })
        expect(await executeAgentStart(action, fixture)).toMatchObject({
          ok: false,
          outcome: 'unknown',
          diagnostic
        })
        expect(fixture.calls.length).toBe(1)
      }
    })
    it('rejects replaced terminals and busy foreground without dispatch', async () => {
      const first = setup()
      first.deps.fetchSnapshot = async () => ({
        ...shell,
        panes: [{ ...shell.panes[0], terminal_id: 'replaced' }]
      })
      expect((await executeAgentStart(action, first)).outcome).toBe('rejected')
      expect(first.calls.length).toBe(0)
      const second = setup()
      second.deps.fetchProcessInfo = async () => ({
        pane_id: 'pane:test',
        shell_pid: 123,
        foreground_process_group_id: 456,
        foreground_processes: [{ pid: 456 }]
      })
      expect((await executeAgentStart(action, second)).outcome).toBe('rejected')
      expect(second.calls.length).toBe(0)
    })
    it('keeps timeout and wrong correlation unknown with one dispatch', async () => {
      for (const response of [
        new Error('timeout'),
        { type: 'ok' },
        {
          type: 'agent_started',
          agent: { ...agent, terminal_id: 'wrong' },
          argv: [...expectedArgv]
        }
      ]) {
        const fixture = setup(response)
        expect((await executeAgentStart(action, fixture)).outcome).toBe(
          'unknown'
        )
        expect(fixture.calls.length).toBe(1)
      }
    })
    it('returns bounded diagnostic phases without raw native details or redispatch', async () => {
      const cases = [
        [
          new Error(
            'Herdr socket request timed out after 35000ms (method: agent.start)'
          ),
          'transport_timeout'
        ],
        [new Error('secret/path/token'), 'transport_error'],
        [
          new HerdrSocketError('timeout', 'secret/path/token'),
          'native_timeout'
        ],
        [
          new HerdrSocketError('agent_pane_busy', 'secret/path/token'),
          'native_rejection'
        ],
        [{ type: 'ok' }, 'malformed_reply'],
        [{ type: 'agent_started', agent, argv: ['letta'] }, 'argv_mismatch'],
        [
          {
            type: 'agent_started',
            agent,
            argv: ['letta', '--new', '--model', 'secret']
          },
          'argv_mismatch'
        ],
        [
          { type: 'agent_started', agent: {}, argv: [...expectedArgv] },
          'missing_identity'
        ],
        [
          {
            type: 'agent_started',
            agent: { ...agent, name: 'other' },
            argv: [...expectedArgv]
          },
          'identity_mismatch'
        ]
      ] as const
      for (const [response, diagnostic] of cases) {
        const fixture = setup(response)
        const result = await executeAgentStart(action, fixture)
        expect(result).toMatchObject({ outcome: 'unknown', diagnostic })
        expect(JSON.stringify(result)).not.toContain('secret')
        expect(fixture.calls.length).toBe(1)
      }
    })
    it('rejects extra, blank, resume and cross-kind argv as unknown without retry', async () => {
      for (const argv of [
        [],
        [''],
        [kind, ''],
        [kind, '--continue'],
        [kind, '--resume'],
        [kind, '--session', 'old'],
        [kind, '--new', '--extra'],
        [kind === 'pi' ? 'letta' : 'pi', ...newArgs]
      ]) {
        const fixture = setup({ type: 'agent_started', agent, argv })
        expect(await executeAgentStart(action, fixture)).toMatchObject({
          outcome: 'unknown',
          diagnostic: 'argv_mismatch'
        })
        expect(fixture.calls).toHaveLength(1)
      }
    })
    it('keeps initializing native ACK not ready', async () => {
      for (const flags of [
        { interactive_ready: false },
        { launch_pending: true }
      ]) {
        const fixture = setup({
          type: 'agent_started',
          agent: { ...agent, ...flags },
          argv: expectedArgv
        })
        expect((await executeAgentStart(action, fixture)).result?.ready).toBe(
          false
        )
      }
    })
    it('never calls ACK alone ready on session replacement or unknown status', async () => {
      for (const pane of [
        { ...agent, agent_session: { ...agent.agent_session, value: 'other' } },
        { ...agent, agent_status: 'unknown' }
      ]) {
        const fixture = setup(undefined, { ...shell, panes: [pane] })
        expect((await executeAgentStart(action, fixture)).result?.ready).toBe(
          false
        )
      }
    })
    it('coordinates topology/control collision, replay and changed name conflict', () => {
      const coordinator = new OperationCoordinator()
      const fingerprint = computePayloadFingerprint(action)
      const first = coordinator.beginAction(
        action.operationId,
        { topology: 'exclusive', paneId: 'pane:test' },
        fingerprint
      )
      expect(first.kind).toBe('admitted')
      expect(
        coordinator.beginAction(
          'other',
          { topology: 'shared', paneId: 'pane:test' },
          'other'
        ).kind
      ).toBe('contention')
      expect(
        coordinator.beginAction(
          action.operationId,
          { topology: 'exclusive' },
          fingerprint
        ).kind
      ).toBe('in_flight')
      if (first.kind === 'admitted')
        coordinator.completeAction(first.token, 504, { outcome: 'unknown' })
      expect(
        coordinator.beginAction(action.operationId, {}, fingerprint).kind
      ).toBe('replay')
      expect(
        coordinator.beginAction(
          action.operationId,
          {},
          computePayloadFingerprint({ ...action, name: 'changed' })
        ).kind
      ).toBe('conflict')
    })
  })
})
