import { expect, test, spyOn } from 'bun:test'
import { createServer } from '../index.ts'
import { OperationCoordinator } from '../operation-coordinator.ts'
import type { ISnapshotResult } from '../types.ts'
const target = {
  paneId: 'ws:p1',
  terminalId: 't1',
  expectedMode: 'agent' as const,
  agentSessionId: 's1'
}
const cap = 'a'.repeat(64)
const fixture = () => {
  let reads = 0,
    writes = 0,
    failSnapshot = false,
    failPrompt = false
  let gate: Promise<void> | null = null
  const snapshot: ISnapshotResult = {
    protocol: 22,
    version: '0.9.3',
    workspaces: [],
    tabs: [],
    panes: [
      {
        pane_id: 'ws:p1',
        terminal_id: 't1',
        workspace_id: 'ws',
        tab_id: 'tab',
        agent: 'codex',
        agent_status: 'working',
        agent_session: {
          source: 'native',
          agent: 'codex',
          kind: 'id',
          value: 's1'
        },
        cwd: '/synthetic',
        focused: false
      }
    ]
  }
  const coordinator = new OperationCoordinator({ maxEntries: 1 })
  const server = createServer(0, '127.0.0.1', {
    startPushBridge: false,
    deps: {
      coordinator,
      fetchSnapshot: async () => {
        reads++
        if (failSnapshot) throw new Error('snapshot unavailable')
        if (gate) await gate
        return snapshot
      },
      promptDeps: { readScreen: async () => 'Working on the task' },
      executePrompt: async () => {
        writes++
        if (failPrompt) throw new Error('lost acknowledgment')
        return {}
      }
    }
  })
  const request = (
    route: string,
    body: unknown,
    capability = cap,
    origin = `http://127.0.0.1:${server.port}`
  ) =>
    fetch(`http://127.0.0.1:${server.port}${route}`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'X-Herdr-Held-Capability': capability
      },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
  const enqueue = (operationId: string = crypto.randomUUID()) =>
    request('/api/action', {
      type: 'held-enqueue',
      operationId,
      target,
      text: 'immutable held text'
    })
  return {
    server,
    coordinator,
    request,
    enqueue,
    reads: () => reads,
    writes: () => writes,
    failSnapshot: (value: boolean) => {
      failSnapshot = value
    },
    failPrompt: () => {
      failPrompt = true
    },
    gate: (value: Promise<void> | null) => {
      gate = value
    }
  }
}
test('HTTP auth/Origin precede malformed body and snapshot; capability required, bounded read no-store', async () => {
  const f = fixture()
  try {
    for (const route of ['/api/action', '/api/held/read']) {
      expect(
        (await f.request(route, '{invalid', cap, 'https://evil.example')).status
      ).toBe(403)
      expect(f.reads()).toBe(0)
    }
    expect(
      (
        await f.request(
          '/api/action',
          { type: 'held-enqueue', operationId: 'no-cap', target, text: 'x' },
          ''
        )
      ).status
    ).toBe(403)
    expect(f.reads()).toBe(0)
    const accepted = await f.enqueue('read-op')
    const heldId = (await accepted.json()).result.heldId
    const read = await f.request('/api/held/read', {
      operationIds: ['read-op']
    })
    expect(read.headers.get('cache-control')).toBe('no-store')
    expect((await read.json()).records[0].heldId).toBe(heldId)
    const other = await f.request(
      '/api/held/read',
      { operationIds: ['read-op'] },
      'b'.repeat(64)
    )
    expect((await other.json()).records).toEqual([])
    expect(
      (
        await f.request('/api/held/read', {
          operationIds: Array(33).fill('read-op')
        })
      ).status
    ).toBe(400)
    expect(f.writes()).toBe(0)
  } finally {
    f.server.stop(true)
  }
})
test('HTTP snapshot failures abandon same-operation attempts, create no orphans and preserve original held send', async () => {
  const f = fixture()
  try {
    f.failSnapshot(true)
    for (let i = 0; i < 34; i++)
      expect((await f.enqueue(`failed-${i}`)).status).toBe(502)
    expect(
      f.coordinator.getCachedOperationForTesting('failed-0')
    ).toBeUndefined()
    expect(f.coordinator.getActiveAttemptsCountForTesting()).toBe(0)
    expect(
      (
        await (
          await f.request('/api/held/read', { operationIds: ['failed-0'] })
        ).json()
      ).records
    ).toEqual([])
    f.failSnapshot(false)
    const success = await f.enqueue('failed-0')
    expect(success.status).toBe(200)
    const heldId = (await success.json()).result.heldId
    f.failSnapshot(true)
    const send = { type: 'held-send', operationId: 'same-send', heldId }
    expect((await f.request('/api/action', send)).status).toBe(502)
    expect(
      f.coordinator.getCachedOperationForTesting('same-send')
    ).toBeUndefined()
    f.failSnapshot(false)
    expect((await f.request('/api/action', send)).status).toBe(200)
    expect(f.writes()).toBe(1)
  } finally {
    f.server.stop(true)
  }
})
test('HTTP lost-enqueue-response reconciliation is read-only and does not allocate again after cache eviction; unknown stays consumed', async () => {
  const f = fixture()
  try {
    await f.enqueue('lost-enqueue') // original document did not consume this receipt
    await f.enqueue('evict')
    const recovered = await f.request('/api/held/read', {
      operationIds: ['lost-enqueue']
    })
    const record = (await recovered.json()).records[0]
    expect(record.text).toBe('immutable held text')
    expect(record.state).toBe('held')
    expect(f.writes()).toBe(0)
    const replay = await f.enqueue('lost-enqueue')
    expect((await replay.json()).result.heldId).toBe(record.heldId)
    f.failPrompt()
    expect(
      (
        await f.request('/api/action', {
          type: 'held-send',
          operationId: 'unknown',
          heldId: record.heldId
        })
      ).status
    ).toBe(502)
    await f.enqueue('evict-unknown')
    expect(
      (
        await f.request('/api/action', {
          type: 'held-send',
          operationId: 'new-id',
          heldId: record.heldId
        })
      ).status
    ).toBe(409)
    expect(f.writes()).toBe(1)
    expect(
      (
        await (
          await f.request('/api/held/read', { operationIds: ['lost-enqueue'] })
        ).json()
      ).records[0].state
    ).toBe('uncertain')
  } finally {
    f.server.stop(true)
  }
})
test('HTTP global bound and expired IDs fail closed; projection cannot recover expiry', async () => {
  const f = fixture()
  let heldId = ''
  try {
    for (let i = 0; i < 256; i++) {
      const response = await f.request(
        '/api/action',
        {
          type: 'held-enqueue',
          operationId: `bound-${i}`,
          target,
          text: 'held'
        },
        Math.floor(i / 32)
          .toString(16)
          .repeat(64)
      )
      expect(response.status).toBe(200)
      if (i === 0) heldId = (await response.json()).result.heldId
    }
    expect(
      (
        await f.request(
          '/api/action',
          {
            type: 'held-enqueue',
            operationId: 'global-overflow',
            target,
            text: 'held'
          },
          'f'.repeat(64)
        )
      ).status
    ).toBe(409)
    const clock = spyOn(Date, 'now').mockReturnValue(
      Date.now() + 30 * 60 * 1000 + 1000
    )
    try {
      expect(
        (
          await f.request(
            '/api/action',
            { type: 'held-send', operationId: 'expired-send', heldId },
            '0'.repeat(64)
          )
        ).status
      ).toBe(404)
      expect(
        (
          await (
            await f.request(
              '/api/held/read',
              { operationIds: ['bound-0'] },
              '0'.repeat(64)
            )
          ).json()
        ).records
      ).toEqual([])
      expect(f.writes()).toBe(0)
    } finally {
      clock.mockRestore()
    }
  } finally {
    f.server.stop(true)
  }
})

test('HTTP held send and discard race admits one winner', async () => {
  const f = fixture()
  try {
    const heldId = (await (await f.enqueue('race-enqueue')).json()).result
      .heldId
    let release!: () => void
    f.gate(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const before = f.reads()
    const send = f.request('/api/action', {
      type: 'held-send',
      operationId: 'race-send',
      heldId
    })
    for (let i = 0; i < 50 && f.reads() === before; i++) await Bun.sleep(1)
    expect(f.reads()).toBeGreaterThan(before)
    expect(
      (
        await f.request('/api/action', {
          type: 'held-discard',
          operationId: 'race-discard',
          heldId
        })
      ).status
    ).toBe(409)
    f.gate(null)
    release()
    expect((await send).status).toBe(200)
    expect(f.writes()).toBe(1)
  } finally {
    f.server.stop(true)
  }
})
