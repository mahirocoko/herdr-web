import type { SnapshotBridge } from '../snapshot-bridge.ts'
import type { ISnapshotResult } from '../types.ts'
import { loadPushConfig } from './config.ts'
import {
  createDonePayload,
  createNeedsInputPayload,
  createTestPayload,
  sendPushNotification,
  type ISendPushOptions
} from './sender.ts'
import { PushSubscriptionStore } from './store.ts'
import { PushTabPolicyStore, resolveEffectiveTabPolicy } from './tab-policy-store.ts'
import { PushTransitionDetector } from './transition-detector.ts'
import type { IPushConfig, IPushConfigResponse, IPushSendResult, IPushSubscription } from './types.ts'

export interface IPushServiceOptions {
  config?: IPushConfig | null
  configPath?: string
  store?: PushSubscriptionStore
  storePath?: string
  tabPolicyStore?: PushTabPolicyStore
  tabPolicyStorePath?: string
  detector?: PushTransitionDetector
  webPushClient?: ISendPushOptions['webPushClient']
}

export class PushService {
  private config: IPushConfig | null
  private store: PushSubscriptionStore
  private tabPolicyStore: PushTabPolicyStore
  private detector: PushTransitionDetector
  private webPushClient?: ISendPushOptions['webPushClient']
  private unsubscribeBridge: (() => void) | null = null
  private deliveryQueue: Promise<void> = Promise.resolve()

  constructor(options: IPushServiceOptions = {}) {
    this.config = options.config !== undefined ? options.config : loadPushConfig(options.configPath)
    this.store = options.store || new PushSubscriptionStore(options.storePath)
    this.tabPolicyStore = options.tabPolicyStore || new PushTabPolicyStore(options.tabPolicyStorePath)
    this.detector = options.detector || new PushTransitionDetector()
    this.webPushClient = options.webPushClient
  }

  public getTabPolicyStore(): PushTabPolicyStore {
    return this.tabPolicyStore
  }

  public isEnabled(): boolean {
    return Boolean(this.config)
  }

  public getConfig(): IPushConfig | null {
    return this.config
  }

  public getPublicConfig(): IPushConfigResponse {
    if (!this.config) {
      return {
        ok: true,
        enabled: false
      }
    }

    return {
      ok: true,
      enabled: true,
      publicKey: this.config.publicKey
    }
  }

  public async registerSubscription(sub: IPushSubscription): Promise<void> {
    await this.store.addSubscription(sub)
  }

  public async removeSubscription(endpoint: string): Promise<boolean> {
    return this.store.removeSubscription(endpoint)
  }

  public async getSubscription(endpoint: string): Promise<IPushSubscription | null> {
    return this.store.getSubscription(endpoint)
  }

  public async getSubscriptions(): Promise<IPushSubscription[]> {
    return this.store.getSubscriptions()
  }

  public async sendTest(endpoint: string, options: ISendPushOptions = {}): Promise<IPushSendResult> {
    if (!this.config) {
      return {
        ok: false,
        error: 'Push service not configured'
      }
    }

    const sub = await this.store.getSubscription(endpoint)
    if (!sub) {
      return {
        ok: false,
        error: 'Subscription not found in store'
      }
    }

    const sendOptions: ISendPushOptions = {
      ...options,
      webPushClient: options.webPushClient || this.webPushClient
    }

    const payload = createTestPayload()
    const result = await sendPushNotification(sub, payload, this.config, sendOptions)

    if (result.shouldRemove) {
      await this.store.removeSubscription(endpoint)
    }

    return result
  }

  public async handleSnapshot(snapshot: ISnapshotResult, options: ISendPushOptions = {}): Promise<void> {
    this.deliveryQueue = this.deliveryQueue
      .catch(() => {})
      .then(() => this.processSnapshot(snapshot, options))
      .catch(() => {
        console.warn('[herdr-push] Unexpected background snapshot processing error')
      })
    return this.deliveryQueue
  }

  private async processSnapshot(snapshot: ISnapshotResult, options: ISendPushOptions = {}): Promise<void> {
    if (!this.config) {
      return
    }

    // 1. Read and validate store BEFORE mutating detector so store failure does not consume a transition.
    let subs: IPushSubscription[]
    try {
      subs = await this.store.getSubscriptions()
    } catch {
      console.warn(
        '[herdr-push] Store read failed during snapshot check; preserving transition state'
      )
      return
    }

    // 2. Read and validate tab policy store BEFORE mutating detector so store failure does not consume a transition.
    let enabledTabIds: Set<string> | undefined = undefined
    try {
      const overrides = await this.tabPolicyStore.getOverrides()
      const effectivePolicies = resolveEffectiveTabPolicy(
        snapshot.workspaces || [],
        snapshot.tabs || [],
        overrides
      )
      enabledTabIds = new Set(
        effectivePolicies.filter((p) => p.enabled).map((p) => p.tabId)
      )
    } catch {
      console.warn(
        '[herdr-push] Tab policy store read failed during snapshot check; preserving transition state'
      )
      return
    }

    const transitions = this.detector.diffSnapshot(snapshot, enabledTabIds)
    if (transitions.length === 0 || subs.length === 0) {
      return
    }

    const sendOptions: ISendPushOptions = {
      ...options,
      webPushClient: options.webPushClient || this.webPushClient,
      timeoutMs: options.timeoutMs ?? 10000
    }

    for (const transition of transitions) {
      const payload =
        transition.type === 'needs_input'
          ? createNeedsInputPayload(transition.workspaceId, transition.workspaceLabel)
          : createDonePayload(transition.workspaceId, transition.workspaceLabel)

      for (const sub of subs) {
        try {
          const result = await sendPushNotification(sub, payload, this.config, sendOptions)
          if (result.shouldRemove) {
            try {
              await this.store.removeSubscription(sub.endpoint)
            } catch {
              console.warn('[herdr-push] Failed to remove expired subscription from store')
            }
          } else if (!result.ok) {
            console.warn(
              `[herdr-push] Nonterminal delivery error for event "${transition.type}": ${result.error || 'delivery_failed'}`
            )
          }
        } catch {
          console.warn(
            `[herdr-push] Unexpected delivery error for event "${transition.type}"`
          )
        }
      }
    }
  }

  public attachToBridge(bridge: SnapshotBridge): () => void {
    if (this.unsubscribeBridge) {
      this.unsubscribeBridge()
      this.unsubscribeBridge = null
    }

    if (!this.isEnabled()) {
      return () => {}
    }

    const unsub = bridge.onSnapshot((snapshot) => {
      this.handleSnapshot(snapshot).catch(() => {
        console.warn('[herdr-push] Unexpected background snapshot processing error')
      })
    })

    this.unsubscribeBridge = unsub
    return unsub
  }

  public stop(): void {
    if (this.unsubscribeBridge) {
      this.unsubscribeBridge()
      this.unsubscribeBridge = null
    }
    this.detector.reset()
  }
}

let sharedPushService: PushService | null = null

export const getSharedPushService = (): PushService => {
  if (!sharedPushService) {
    sharedPushService = new PushService()
  }
  return sharedPushService
}

export const resetSharedPushService = (): void => {
  if (sharedPushService) {
    sharedPushService.stop()
    sharedPushService = null
  }
}
