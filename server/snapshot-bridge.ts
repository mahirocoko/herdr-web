import * as net from 'node:net'
import { StringDecoder } from 'node:string_decoder'
import { resolveHerdrSocketPath, generateRequestId } from './herdr-socket.ts'
import { getHerdrSnapshot } from './herdr-adapter.ts'
import type { ISnapshotResult } from './types.ts'

export type BridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export interface ISnapshotBridgeOptions {
  socketPath?: string
  initialBackoffMs?: number
  maxBackoffMs?: number
  snapshotTimeoutMs?: number
  connectTimeoutMs?: number
  ackTimeoutMs?: number
  maxEventLineBytes?: number
  snapshotFetcher?: (timeoutMs?: number) => Promise<ISnapshotResult>
}

export const LIFECYCLE_SUBSCRIPTIONS = [
  { type: 'workspace.created' },
  { type: 'workspace.updated' },
  { type: 'workspace.metadata_updated' },
  { type: 'workspace.renamed' },
  { type: 'workspace.moved' },
  { type: 'workspace.reordered' },
  { type: 'workspace.closed' },
  { type: 'workspace.focused' },
  { type: 'worktree.created' },
  { type: 'worktree.opened' },
  { type: 'worktree.removed' },
  { type: 'tab.created' },
  { type: 'tab.closed' },
  { type: 'tab.focused' },
  { type: 'tab.renamed' },
  { type: 'tab.moved' },
  { type: 'pane.created' },
  { type: 'pane.closed' },
  { type: 'pane.updated' },
  { type: 'pane.focused' },
  { type: 'pane.moved' },
  { type: 'pane.exited' },
  { type: 'pane.agent_detected' },
  { type: 'layout.updated' }
]

export const paneIdsFromSnapshot = (snapshot: ISnapshotResult): string[] => {
  return [...new Set((snapshot.panes || []).map((pane) => pane.pane_id))].sort()
}

export const buildSnapshotSubscriptions = (paneIds: string[]): Array<Record<string, string>> => {
  return [
    ...LIFECYCLE_SUBSCRIPTIONS,
    ...[...new Set(paneIds)].sort().map((paneId) => ({
      type: 'pane.agent_status_changed',
      pane_id: paneId
    }))
  ]
}

const paneIdSetsEqual = (left: string[], right: string[]): boolean => {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export class SnapshotBridge {
  private status: BridgeStatus = 'disconnected'
  private latestSnapshot: ISnapshotResult | null = null
  private socketPath: string
  private socket: net.Socket | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private connectionTimer: NodeJS.Timeout | null = null
  private backoffMs: number
  private readonly initialBackoffMs: number
  private readonly maxBackoffMs: number
  private readonly snapshotTimeoutMs: number
  private readonly connectTimeoutMs: number
  private readonly ackTimeoutMs: number
  private readonly maxEventLineBytes: number
  private readonly fetchSnapshot: (timeoutMs?: number) => Promise<ISnapshotResult>

  private isStarted = false
  private isStopped = false
  private subscriptionActive = false
  private isFetchingSnapshot = false
  private isDirty = false
  private connectionGeneration = 0
  private subscribedPaneIds: string[] = []

  private snapshotListeners = new Set<(snapshot: ISnapshotResult) => void>()
  private statusListeners = new Set<(status: BridgeStatus) => void>()

  constructor(options: ISnapshotBridgeOptions = {}) {
    this.socketPath = resolveHerdrSocketPath(options.socketPath)
    this.initialBackoffMs = options.initialBackoffMs ?? 500
    this.maxBackoffMs = options.maxBackoffMs ?? 5000
    this.backoffMs = this.initialBackoffMs
    this.snapshotTimeoutMs = options.snapshotTimeoutMs ?? 5000
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5000
    this.ackTimeoutMs = options.ackTimeoutMs ?? 5000
    this.maxEventLineBytes = options.maxEventLineBytes ?? 1024 * 1024
    this.fetchSnapshot = options.snapshotFetcher ?? getHerdrSnapshot
  }

  public getStatus(): BridgeStatus {
    return this.status
  }

  public getLatestSnapshot(): ISnapshotResult | null {
    return this.latestSnapshot
  }

  public onSnapshot(listener: (snapshot: ISnapshotResult) => void): () => void {
    this.snapshotListeners.add(listener)
    return () => this.snapshotListeners.delete(listener)
  }

  public onStatus(listener: (status: BridgeStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private setStatus(newStatus: BridgeStatus) {
    if (this.status === newStatus) return
    this.status = newStatus
    for (const listener of this.statusListeners) {
      try {
        listener(newStatus)
      } catch {}
    }
  }

  private emitSnapshot(snapshot: ISnapshotResult) {
    this.latestSnapshot = snapshot
    for (const listener of this.snapshotListeners) {
      try {
        listener(snapshot)
      } catch {}
    }
  }

  public start() {
    if (this.isStarted) return
    this.isStarted = true
    this.isStopped = false
    void this.connect()
  }

  public stop() {
    this.isStopped = true
    this.isStarted = false
    this.connectionGeneration++
    this.subscriptionActive = false
    this.isFetchingSnapshot = false
    this.isDirty = false
    this.clearTimers()
    this.destroySocket()
    this.setStatus('disconnected')
  }

  private clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer)
      this.connectionTimer = null
    }
  }

  private destroySocket() {
    if (!this.socket) return
    this.socket.removeAllListeners()
    if (!this.socket.destroyed) this.socket.destroy()
    this.socket = null
  }

  private async connect() {
    if (this.isStopped) return

    this.clearTimers()
    this.destroySocket()
    this.subscriptionActive = false
    this.isDirty = false
    const generation = ++this.connectionGeneration
    this.setStatus(this.latestSnapshot ? 'reconnecting' : 'connecting')

    let preflight: ISnapshotResult
    try {
      preflight = await this.fetchSnapshot(this.snapshotTimeoutMs)
    } catch {
      if (generation === this.connectionGeneration) this.handleConnectionLoss()
      return
    }
    if (this.isStopped || generation !== this.connectionGeneration) return

    this.subscribedPaneIds = paneIdsFromSnapshot(preflight)
    const subReqId = generateRequestId('sub')
    const decoder = new StringDecoder('utf8')
    let buffer = ''
    let subscriptionAcknowledged = false

    try {
      this.socket = net.createConnection({ path: this.socketPath })
    } catch {
      this.handleConnectionLoss()
      return
    }

    this.connectionTimer = setTimeout(() => this.handleConnectionLoss(), this.connectTimeoutMs)
    this.connectionTimer.unref?.()

    this.socket.on('connect', () => {
      if (this.isStopped || generation !== this.connectionGeneration || !this.socket) return
      if (this.connectionTimer) clearTimeout(this.connectionTimer)
      this.connectionTimer = setTimeout(() => this.handleConnectionLoss(), this.ackTimeoutMs)
      this.connectionTimer.unref?.()
      this.socket.write(JSON.stringify({
        id: subReqId,
        method: 'events.subscribe',
        params: { subscriptions: buildSnapshotSubscriptions(this.subscribedPaneIds) }
      }) + '\n')
    })

    this.socket.on('data', (chunk: Buffer) => {
      if (this.isStopped || generation !== this.connectionGeneration) return
      buffer += decoder.write(chunk)
      if (Buffer.byteLength(buffer, 'utf8') > this.maxEventLineBytes && !buffer.includes('\n')) {
        this.handleConnectionLoss()
        return
      }

      while (buffer.includes('\n')) {
        const newlineIndex = buffer.indexOf('\n')
        const line = buffer.slice(0, newlineIndex).trim()
        buffer = buffer.slice(newlineIndex + 1)
        if (Buffer.byteLength(line, 'utf8') > this.maxEventLineBytes) {
          this.handleConnectionLoss()
          return
        }
        if (line.length === 0) continue

        let envelope: any
        try {
          envelope = JSON.parse(line)
        } catch {
          this.handleConnectionLoss()
          return
        }

        if (!subscriptionAcknowledged && envelope.id === subReqId) {
          if (envelope.error || envelope.result?.type !== 'subscription_started') {
            this.handleConnectionLoss()
            return
          }
          subscriptionAcknowledged = true
          this.subscriptionActive = true
          if (this.connectionTimer) {
            clearTimeout(this.connectionTimer)
            this.connectionTimer = null
          }
          this.backoffMs = this.initialBackoffMs
          this.triggerSnapshotRefresh()
          continue
        }

        if (subscriptionAcknowledged) this.triggerSnapshotRefresh()
      }
    })

    this.socket.on('error', () => this.handleConnectionLoss())
    this.socket.on('end', () => this.handleConnectionLoss())
    this.socket.on('close', () => this.handleConnectionLoss())
  }

  private triggerSnapshotRefresh() {
    if (this.isStopped || !this.subscriptionActive) return
    if (this.isFetchingSnapshot) {
      this.isDirty = true
      return
    }

    this.isFetchingSnapshot = true
    const generation = this.connectionGeneration
    const runRefreshLoop = async () => {
      try {
        do {
          this.isDirty = false
          const snapshot = await this.fetchSnapshot(this.snapshotTimeoutMs)
          if (this.isStopped || !this.subscriptionActive || generation !== this.connectionGeneration) return

          const authoritativePaneIds = paneIdsFromSnapshot(snapshot)
          if (!paneIdSetsEqual(authoritativePaneIds, this.subscribedPaneIds)) {
            this.isFetchingSnapshot = false
            this.rebuildSubscription()
            return
          }

          this.setStatus('connected')
          this.emitSnapshot(snapshot)
        } while (this.isDirty && !this.isStopped && this.subscriptionActive)
      } catch {
        if (!this.isStopped && generation === this.connectionGeneration) this.handleConnectionLoss()
      } finally {
        if (generation === this.connectionGeneration) this.isFetchingSnapshot = false
      }
    }
    void runRefreshLoop()
  }

  private rebuildSubscription() {
    if (this.isStopped) return
    this.subscriptionActive = false
    this.connectionGeneration++
    this.destroySocket()
    void this.connect()
  }

  private handleConnectionLoss() {
    if (this.isStopped) return
    this.connectionGeneration++
    this.subscriptionActive = false
    this.isFetchingSnapshot = false
    this.isDirty = false
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer)
      this.connectionTimer = null
    }
    this.destroySocket()
    this.setStatus('reconnecting')
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)

    const waitTime = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 1.5, this.maxBackoffMs)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.isStopped) void this.connect()
    }, waitTime)
    this.reconnectTimer.unref?.()
  }
}

let sharedBridge: SnapshotBridge | null = null

export const getSharedSnapshotBridge = (): SnapshotBridge => {
  if (!sharedBridge) sharedBridge = new SnapshotBridge()
  return sharedBridge
}
