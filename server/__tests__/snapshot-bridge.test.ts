import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { SnapshotBridge, buildSnapshotSubscriptions, type BridgeStatus } from '../snapshot-bridge.ts'
import type { ISnapshotResult } from '../types.ts'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const createMockBridgeServer = (
  handler: (socket: net.Socket, line: string) => void
): { socketPath: string; close: () => Promise<void> } => {
  const socketPath = path.join(os.tmpdir(), `herdr-bridge-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sock`)
  if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath)

  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    let buffer = ''
    socket.on('data', (data) => {
      buffer += data.toString('utf8')
      while (buffer.includes('\n')) {
        const index = buffer.indexOf('\n')
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line) handler(socket, line)
      }
    })
  })
  server.listen(socketPath)

  return {
    socketPath,
    close: async () => new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy()
      server.close(() => {
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath)
        resolve()
      })
    })
  }
}

const createSnapshot = (paneIds: string[] = ['w1:p1'], revision = 1): ISnapshotResult => ({
  protocol: 22,
  version: '0.9.1',
  workspaces: [],
  tabs: [],
  panes: paneIds.map((paneId) => ({
    pane_id: paneId,
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: paneId === paneIds[0],
    agent_status: 'idle',
    cwd: '/test',
    revision
  }))
})

const ackSubscription = (socket: net.Socket, request: any) => {
  socket.write(JSON.stringify({ id: request.id, result: { type: 'subscription_started' } }) + '\n')
}

describe('snapshot-bridge subscription protocol', () => {
  it('builds global lifecycle plus exact per-pane agent status subscriptions', () => {
    const subscriptions = buildSnapshotSubscriptions(['w1:p2', 'w1:p1', 'w1:p1'])
    expect(subscriptions).toContainEqual({ type: 'pane.created' })
    expect(subscriptions.filter((item) => item.type === 'pane.agent_status_changed')).toEqual([
      { type: 'pane.agent_status_changed', pane_id: 'w1:p1' },
      { type: 'pane.agent_status_changed', pane_id: 'w1:p2' }
    ])
  })

  it('preflights pane ids, waits for ack, then publishes an authoritative snapshot', async () => {
    let request: any
    let fetchCount = 0
    const { socketPath, close } = createMockBridgeServer((socket, line) => {
      request = JSON.parse(line)
      ackSubscription(socket, request)
    })
    const statuses: BridgeStatus[] = []
    const bridge = new SnapshotBridge({
      socketPath,
      snapshotFetcher: async () => createSnapshot(['w1:p1'], ++fetchCount)
    })
    bridge.onStatus((status) => statuses.push(status))

    try {
      bridge.start()
      await wait(80)
      expect(fetchCount).toBe(2)
      expect(request.params.subscriptions).toContainEqual({ type: 'pane.agent_status_changed', pane_id: 'w1:p1' })
      expect(bridge.getLatestSnapshot()?.panes[0]?.revision).toBe(2)
      expect(statuses).toContain('connected')
    } finally {
      bridge.stop()
      await close()
    }
  })

  it('refreshes on pane.agent_status_changed and serializes an event arriving during fetch', async () => {
    let subscriptionSocket: net.Socket | null = null
    let fetchCount = 0
    let inFlight = 0
    let maxInFlight = 0
    const { socketPath, close } = createMockBridgeServer((socket, line) => {
      subscriptionSocket = socket
      ackSubscription(socket, JSON.parse(line))
    })
    const bridge = new SnapshotBridge({
      socketPath,
      snapshotFetcher: async () => {
        fetchCount++
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await wait(25)
        inFlight--
        return createSnapshot(['w1:p1'], fetchCount)
      }
    })

    try {
      bridge.start()
      await wait(90)
      expect(fetchCount).toBe(2)
      const event = JSON.stringify({ event: 'pane.agent_status_changed', data: { pane_id: 'w1:p1', status: 'blocked', label: 'สถานะ' } }) + '\n'
      const bytes = Buffer.from(event)
      const splitAt = bytes.indexOf(Buffer.from('ส')) + 1
      ;(subscriptionSocket as unknown as net.Socket).write(bytes.subarray(0, splitAt))
      ;(subscriptionSocket as unknown as net.Socket).write(bytes.subarray(splitAt))
      await wait(5)
      ;(subscriptionSocket as unknown as net.Socket).write(event)
      await wait(100)
      expect(fetchCount).toBeGreaterThanOrEqual(4)
      expect(maxInFlight).toBe(1)
    } finally {
      bridge.stop()
      await close()
    }
  })

  it('rebuilds subscriptions when the authoritative pane topology changes', async () => {
    const requests: any[] = []
    let fetchCount = 0
    const { socketPath, close } = createMockBridgeServer((socket, line) => {
      const request = JSON.parse(line)
      requests.push(request)
      ackSubscription(socket, request)
    })
    const bridge = new SnapshotBridge({
      socketPath,
      snapshotFetcher: async () => {
        fetchCount++
        return fetchCount === 1 ? createSnapshot(['w1:p1'], fetchCount) : createSnapshot(['w1:p1', 'w1:p2'], fetchCount)
      }
    })

    try {
      bridge.start()
      await wait(140)
      expect(requests.length).toBe(2)
      expect(requests[0].params.subscriptions).not.toContainEqual({ type: 'pane.agent_status_changed', pane_id: 'w1:p2' })
      expect(requests[1].params.subscriptions).toContainEqual({ type: 'pane.agent_status_changed', pane_id: 'w1:p2' })
      expect(fetchCount).toBe(4)
      expect(bridge.getStatus()).toBe('connected')
    } finally {
      bridge.stop()
      await close()
    }
  })

  it('reconnects after malformed or oversized event lines', async () => {
    let subscriptions = 0
    const { socketPath, close } = createMockBridgeServer((socket, line) => {
      const request = JSON.parse(line)
      subscriptions++
      ackSubscription(socket, request)
      if (subscriptions === 1) socket.write('{bad json\n')
      if (subscriptions === 2) socket.write('x'.repeat(65))
    })
    const bridge = new SnapshotBridge({
      socketPath,
      initialBackoffMs: 10,
      maxBackoffMs: 10,
      maxEventLineBytes: 64,
      snapshotFetcher: async () => createSnapshot()
    })

    try {
      bridge.start()
      await wait(120)
      expect(subscriptions).toBeGreaterThanOrEqual(3)
    } finally {
      bridge.stop()
      await close()
    }
  })

  it('bounds missing subscription acknowledgements with a reconnect timeout', async () => {
    let subscriptions = 0
    const { socketPath, close } = createMockBridgeServer((_socket, _line) => {
      subscriptions++
    })
    const bridge = new SnapshotBridge({
      socketPath,
      ackTimeoutMs: 15,
      initialBackoffMs: 10,
      maxBackoffMs: 10,
      snapshotFetcher: async () => createSnapshot()
    })

    try {
      bridge.start()
      await wait(90)
      expect(subscriptions).toBeGreaterThanOrEqual(2)
      expect(bridge.getStatus()).not.toBe('connected')
    } finally {
      bridge.stop()
      await close()
    }
  })
})
