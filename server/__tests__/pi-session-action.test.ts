import { describe, it, expect } from 'bun:test'
import { createServer } from '../index.ts'
import { OperationCoordinator } from '../operation-coordinator.ts'
import type { ISnapshotResult } from '../types.ts'

const session = '/Users/fixture/.pi/agent/sessions/project/2026_session.jsonl'
const action = (value = session) => ({
  type: 'prompt',
  operationId: crypto.randomUUID(),
  target: {
    paneId: 'w1:p1',
    terminalId: 'term1',
    expectedMode: 'agent',
    agentSessionId: value
  },
  text: 'synthetic fixture only'
})
const fixture = () => {
  const snapshot: ISnapshotResult = {
    protocol: 22,
    version: '0.9.4',
    workspaces: [],
    tabs: [],
    panes: [
      {
        pane_id: 'w1:p1',
        terminal_id: 'term1',
        workspace_id: 'w1',
        tab_id: 't1',
        agent: 'pi',
        agent_status: 'working',
        cwd: '/fixture',
        focused: false,
        agent_session: {
          kind: 'path',
          agent: 'pi',
          source: 'herdr:pi',
          value: session
        }
      }
    ]
  }
  let writes = 0
  const server = createServer(0, '127.0.0.1', {
    startPushBridge: false,
    deps: {
      coordinator: new OperationCoordinator(),
      fetchSnapshot: async () => snapshot,
      executePrompt: async () => {
        writes++
        return { ok: true } as any
      }
    }
  })
  const request = (body: unknown, origin?: string) =>
    fetch(`http://127.0.0.1:${server.port}/api/action`, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${server.port}`,
        origin: origin ?? `http://127.0.0.1:${server.port}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })
  return { snapshot, server, request, writes: () => writes }
}

describe('native Pi path is an opaque action identity, not filesystem authority', () => {
  it('accepts exact official native Pi path Send through HTTP', async () => {
    const f = fixture()
    try {
      const response = await f.request(action())
      expect(response.status, await response.text()).toBe(200)
      expect(f.writes()).toBe(1)
    } finally {
      f.server.stop(true)
    }
  })
  it.each(['value', 'kind', 'source', 'terminal', 'missing', 'provider'])(
    'rejects changed %s before dispatch',
    async (change) => {
      const f = fixture()
      if (change === 'value') f.snapshot.panes[0].agent_session!.value += 'x'
      if (change === 'kind') f.snapshot.panes[0].agent_session!.kind = 'id'
      if (change === 'source')
        f.snapshot.panes[0].agent_session!.source = 'other'
      if (change === 'terminal') f.snapshot.panes[0].terminal_id = 'replacement'
      if (change === 'missing') f.snapshot.panes[0].agent_session = null
      if (change === 'provider') f.snapshot.panes[0].agent = 'letta'
      try {
        const response = await f.request(action())
        expect(response.status, await response.text()).toBe(409)
        expect(f.writes()).toBe(0)
      } finally {
        f.server.stop(true)
      }
    }
  )
  it.each([
    'relative/session.jsonl',
    '/tmp/../session.jsonl',
    '/tmp/./session.jsonl',
    '/tmp//session.jsonl',
    '/tmp/a\u0000.jsonl',
    '/tmp/a\n.jsonl',
    '/' + 'a'.repeat(4096) + '.jsonl'
  ])('rejects malformed reference %s without dispatch', async (value) => {
    const f = fixture()
    try {
      expect([400, 413]).toContain((await f.request(action(value))).status)
      expect(f.writes()).toBe(0)
    } finally {
      f.server.stop(true)
    }
  })
  it('preserves Letta token sessions', async () => {
    const f = fixture()
    Object.assign(f.snapshot.panes[0], {
      agent: 'letta',
      agent_session: {
        kind: 'id',
        source: 'native',
        agent: 'letta',
        value: 'agent-123'
      }
    })
    try {
      expect((await f.request(action('agent-123'))).status).toBe(200)
      expect(f.writes()).toBe(1)
    } finally {
      f.server.stop(true)
    }
  })
  it('rejects foreign Origin before Send', async () => {
    const f = fixture()
    try {
      expect((await f.request(action(), 'https://evil.example')).status).toBe(
        403
      )
      expect(f.writes()).toBe(0)
    } finally {
      f.server.stop(true)
    }
  })
})
