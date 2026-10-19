import { expect, test } from 'bun:test'
import { createServer } from '../index.ts'
import { OperationCoordinator } from '../operation-coordinator.ts'
import type { ISnapshotResult } from '../types.ts'

for (const provider of ['cursor', 'cursor-agent', 'owner-only']) {
  test(`Cursor plain Send is a cached zero-write rejection: ${provider}`, async () => {
    const paneId = 'cursor-fixture:p1'
    const snapshot = {
      protocol: 22,
      version: 'fixture',
      workspaces: [],
      tabs: [],
      panes: [
        {
          pane_id: paneId,
          terminal_id: 'cursor-fixture-terminal',
          workspace_id: 'cursor-fixture',
          tab_id: 'cursor-fixture-tab',
          agent: provider === 'owner-only' ? undefined : provider,
          agent_status: 'idle',
          cwd: '/fixture',
          focused: false
        }
      ],
      agents:
        provider === 'owner-only' ? [{ target: paneId, agent: 'cursor' }] : []
    } as unknown as ISnapshotResult
    let writes = 0
    const server = createServer(0, '127.0.0.1', {
      startPushBridge: false,
      deps: {
        coordinator: new OperationCoordinator(),
        fetchSnapshot: async () => snapshot,
        executePrompt: async () => {
          writes++
          return { ok: true, output: 'fixture-only' }
        }
      }
    })
    const request = () =>
      fetch(`http://127.0.0.1:${server.port}/api/action`, {
        method: 'POST',
        headers: {
          origin: `http://127.0.0.1:${server.port}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          type: 'prompt',
          operationId: `cursor-input-fixture-${provider}`,
          target: {
            paneId,
            terminalId: 'cursor-fixture-terminal',
            expectedMode: 'agent'
          },
          text: 'fixture only; never submitted to a native process'
        })
      })
    try {
      const first = await request()
      expect(first.status).toBe(409)
      const body = await first.json()
      expect(body.outcome).toBe('rejected')
      expect(body.error).toContain('native input focus')
      const repeated = await request()
      expect(repeated.status).toBe(409)
      expect(await repeated.json()).toEqual(body)
      expect(writes).toBe(0)
    } finally {
      server.stop(true)
    }
  })
}
