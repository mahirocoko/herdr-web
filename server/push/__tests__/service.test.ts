import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createECDH } from 'node:crypto'
import { PushService } from '../service.ts'
import { PushSubscriptionStore } from '../store.ts'
import { PushTransitionDetector } from '../transition-detector.ts'
import type { IPushConfig, IPushSubscription } from '../types.ts'

describe('server/push/service: push orchestration and test dispatch', () => {
  const curve = createECDH('prime256v1')
  const p256dh = curve.generateKeys().toString('base64url')
  const authKey = 'A'.repeat(22)

  const mockConfig: IPushConfig = {
    ownerLogin: 'test-owner',
    publicKey: 'BK1234567890123456789012345678901234567890',
    privateKey: 'mock-synthetic-private-key-test',
    subject: 'mailto:test@example.com'
  }

  test('reports public config safely without disclosing privateKey', () => {
    const service = new PushService({ config: mockConfig })
    const pub = service.getPublicConfig()

    expect(pub.ok).toBe(true)
    expect(pub.enabled).toBe(true)
    expect(pub.publicKey).toBe(mockConfig.publicKey)
    expect((pub as any).privateKey).toBeUndefined()
  })

  test('reports disabled state truthfully when unconfigured', () => {
    const service = new PushService({ config: null })
    const pub = service.getPublicConfig()

    expect(pub.ok).toBe(true)
    expect(pub.enabled).toBe(false)
    expect(pub.publicKey).toBeUndefined()
  })

  test('sends test alert only to persisted exact endpoint in store', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-push-service-'))
    const storePath = path.join(tmpDir, 'push-subscriptions.json')

    try {
      const store = new PushSubscriptionStore(storePath)
      const detector = new PushTransitionDetector()

      let sentEndpoint: string | null = null
      const mockClient = {
        setVapidDetails: () => {},
        sendNotification: async (sub: any) => {
          sentEndpoint = sub.endpoint
          return { statusCode: 201 }
        }
      }

      const service = new PushService({
        config: mockConfig,
        store,
        detector,
        webPushClient: mockClient as any
      })

      const sub: IPushSubscription = {
        endpoint: 'https://push.example.com/send/persisted-user',
        keys: { p256dh, auth: authKey }
      }

      // Test sending to non-existent endpoint -> rejected
      const failRes = await service.sendTest('https://push.example.com/send/not-in-store')
      expect(failRes.ok).toBe(false)
      expect(failRes.error).toContain('Subscription not found in store')

      // Register subscription
      await service.registerSubscription(sub)

      // Test sending to persisted endpoint -> succeeds
      const successRes = await service.sendTest('https://push.example.com/send/persisted-user')
      expect(successRes.ok).toBe(true)
      expect(sentEndpoint as string | null).toBe('https://push.example.com/send/persisted-user')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('handleSnapshot triggers delivery and cleans up 410 expired subscriptions', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-push-service-snap-'))
    const storePath = path.join(tmpDir, 'push-subscriptions.json')

    try {
      const store = new PushSubscriptionStore(storePath)
      const detector = new PushTransitionDetector()

      let callsCount = 0
      const mockClient = {
        setVapidDetails: () => {},
        sendNotification: async (sub: any) => {
          callsCount++
          if (sub.endpoint === 'https://push.example.com/sub/expired') {
            const err: any = new Error('Gone')
            err.statusCode = 410
            throw err
          }
          return { statusCode: 201 }
        }
      }

      const service = new PushService({
        config: mockConfig,
        store,
        detector,
        webPushClient: mockClient as any
      })

      // Add two subscriptions: one active, one that will 410
      await store.addSubscription({
        endpoint: 'https://push.example.com/sub/active',
        keys: { p256dh, auth: authKey }
      })
      await store.addSubscription({
        endpoint: 'https://push.example.com/sub/expired',
        keys: { p256dh, auth: authKey }
      })

      // First snapshot: baseline establishment -> no delivery
      await service.handleSnapshot({
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws1', label: 'Main Space', number: 0, agent_status: 'working', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't1', workspace_id: 'ws1', label: 'Tab 1', number: 0, pane_count: 1, focused: true, agent_status: 'working' }],
        panes: [{
          pane_id: 'p1',
          workspace_id: 'ws1',
          tab_id: 't1',
          agent_status: 'working',
          cwd: '/',
          focused: false
        }]
      })
      expect(callsCount).toBe(0)

      // Second snapshot: transition to blocked -> triggers delivery to both
      await service.handleSnapshot({
        protocol: 22,
        version: '0.9.1',
        workspaces: [{ workspace_id: 'ws1', label: 'Main Space', number: 0, agent_status: 'working', tab_count: 1, pane_count: 1, focused: true }],
        tabs: [{ tab_id: 't1', workspace_id: 'ws1', label: 'Tab 1', number: 0, pane_count: 1, focused: true, agent_status: 'blocked' }],
        panes: [{
          pane_id: 'p1',
          workspace_id: 'ws1',
          tab_id: 't1',
          agent_status: 'blocked',
          cwd: '/',
          focused: false
        }]
      })

      expect(callsCount).toBe(2)

      // The 410 subscription must have been removed from store
      const remaining = await store.getSubscriptions()
      expect(remaining.length).toBe(1)
      expect(remaining[0].endpoint).toBe('https://push.example.com/sub/active')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test('unreadable or corrupt store does not consume transition; preserves state and logs sanitized diagnostic without error message or path', async () => {
    const detector = new PushTransitionDetector()
    let storeThrows = false
    const activeSub: IPushSubscription = {
      endpoint: 'https://push.example.com/sub/recovered-user',
      keys: { p256dh, auth: authKey }
    }

    const mockStore = {
      getSubscriptions: async () => {
        if (storeThrows) {
          throw new Error('Push subscription store is corrupt at /secret/path/store.json')
        }
        return [activeSub]
      },
      removeSubscription: async () => true
    }

    const dispatchedPayloads: any[] = []
    const mockClient = {
      setVapidDetails: () => {},
      sendNotification: async (_sub: any, payloadStr: string) => {
        dispatchedPayloads.push(JSON.parse(payloadStr))
        return { statusCode: 201 }
      }
    }

    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: any[]) => {
      warnings.push(args.join(' '))
    }

    try {
      const service = new PushService({
        config: mockConfig,
        store: mockStore as any,
        detector,
        webPushClient: mockClient as any
      })

      const canonicalWorkspaces = [
        { workspace_id: 'ws-1', label: 'Alpha Space', number: 0, agent_status: 'working', tab_count: 1, pane_count: 1, focused: true }
      ]
      const canonicalTabs = [
        { tab_id: 't1', workspace_id: 'ws-1', label: 'Tab 1', number: 0, pane_count: 1, focused: true, agent_status: 'working' }
      ]

      // 1. Initial snapshot establishes baseline
      await service.handleSnapshot({
        protocol: 22,
        version: '0.9.1',
        workspaces: canonicalWorkspaces,
        tabs: canonicalTabs,
        panes: [{ pane_id: 'p1', workspace_id: 'ws-1', tab_id: 't1', agent_status: 'working', cwd: '/', focused: true }]
      })
      expect(dispatchedPayloads.length).toBe(0)

      // 2. Store becomes unreadable / corrupt during state transition
      storeThrows = true
      await service.handleSnapshot({
        protocol: 22,
        version: '0.9.1',
        workspaces: canonicalWorkspaces,
        tabs: canonicalTabs.map((tab) => ({ ...tab, agent_status: 'blocked' })),
        panes: [{ pane_id: 'p1', workspace_id: 'ws-1', tab_id: 't1', agent_status: 'blocked', cwd: '/', focused: true }]
      })
      // No push dispatched because store was corrupt
      expect(dispatchedPayloads.length).toBe(0)

      // Diagnostic must be sanitized: must not contain path or raw error
      const storeWarn = warnings.find((w) => w.includes('[herdr-push] Store read failed'))
      expect(storeWarn).toBeDefined()
      expect(storeWarn).toBe('[herdr-push] Store read failed during snapshot check; preserving transition state')
      expect(storeWarn).not.toContain('/secret/path')
      expect(storeWarn).not.toContain('store is corrupt')

      // 3. Store recovers! Next snapshot arrives with the pane in blocked status
      storeThrows = false
      await service.handleSnapshot({
        protocol: 22,
        version: '0.9.1',
        workspaces: canonicalWorkspaces,
        tabs: canonicalTabs.map((tab) => ({ ...tab, agent_status: 'blocked' })),
        panes: [{ pane_id: 'p1', workspace_id: 'ws-1', tab_id: 't1', agent_status: 'blocked', cwd: '/', focused: true }]
      })

      // The transition must NOT have been consumed when store failed, so it emits now!
      expect(dispatchedPayloads.length).toBe(1)
      expect(dispatchedPayloads[0].type).toBe('needs_input')
      expect(dispatchedPayloads[0].body).toBe('Space: Alpha Space')
      expect(dispatchedPayloads[0].url).toBe('/spaces/ws-1')
    } finally {
      console.warn = originalWarn
    }
  })

  test('unreadable or corrupt tab policy store does not consume transition; preserves state and logs sanitized diagnostic', async () => {
    const detector = new PushTransitionDetector()
    let policyThrows = false
    const activeSub: IPushSubscription = {
      endpoint: 'https://push.example.com/sub/recovered-tab-user',
      keys: { p256dh, auth: authKey }
    }

    const mockSubStore = {
      getSubscriptions: async () => [activeSub],
      removeSubscription: async () => true
    }

    const mockTabPolicyStore = {
      getOverrides: async () => {
        if (policyThrows) {
          throw new Error('Tab policy store is corrupt at /secret/path/push-tab-policy.json')
        }
        return []
      }
    }

    const dispatchedPayloads: any[] = []
    const mockClient = {
      setVapidDetails: () => {},
      sendNotification: async (_sub: any, payloadStr: string) => {
        dispatchedPayloads.push(JSON.parse(payloadStr))
        return { statusCode: 201 }
      }
    }

    const service = new PushService({
      config: mockConfig,
      store: mockSubStore as any,
      tabPolicyStore: mockTabPolicyStore as any,
      detector,
      webPushClient: mockClient as any
    })

    const originalWarn = console.warn
    const warnings: string[] = []
    console.warn = (...args: any[]) => {
      warnings.push(args.join(' '))
    }

    try {
      const canonicalWorkspaces = [
        { workspace_id: 'ws-1', label: 'Alpha Space', number: 0, agent_status: 'working', tab_count: 1, pane_count: 1, focused: true }
      ]
      const canonicalTabs = [
        { tab_id: 't1', workspace_id: 'ws-1', label: 'Tab 1', number: 0, pane_count: 1, focused: true, agent_status: 'working' }
      ]

      // 1. Initial baseline
      await service.handleSnapshot({
        protocol: 22,
        version: '0.9.1',
        workspaces: canonicalWorkspaces,
        tabs: canonicalTabs,
        panes: [{ pane_id: 'p1', workspace_id: 'ws-1', tab_id: 't1', agent_status: 'working', cwd: '/', focused: true }]
      })

      // 2. Corrupt tab policy store throws
      policyThrows = true
      await service.handleSnapshot({
        protocol: 22,
        version: '0.9.1',
        workspaces: canonicalWorkspaces,
        tabs: canonicalTabs.map((tab) => ({ ...tab, agent_status: 'blocked' })),
        panes: [{ pane_id: 'p1', workspace_id: 'ws-1', tab_id: 't1', agent_status: 'blocked', cwd: '/', focused: true }]
      })

      // Zero pushes dispatched
      expect(dispatchedPayloads.length).toBe(0)

      // Warning logged without paths
      const tabWarn = warnings.find((w) => w.includes('[herdr-push] Tab policy store read failed'))
      expect(tabWarn).toBeDefined()
      expect(tabWarn).toBe('[herdr-push] Tab policy store read failed during snapshot check; preserving transition state')
      expect(tabWarn).not.toContain('/secret/path')

      // 3. Tab policy store recovers! Next snapshot emits
      policyThrows = false
      await service.handleSnapshot({
        protocol: 22,
        version: '0.9.1',
        workspaces: canonicalWorkspaces,
        tabs: canonicalTabs.map((tab) => ({ ...tab, agent_status: 'blocked' })),
        panes: [{ pane_id: 'p1', workspace_id: 'ws-1', tab_id: 't1', agent_status: 'blocked', cwd: '/', focused: true }]
      })

      expect(dispatchedPayloads.length).toBe(1)
      expect(dispatchedPayloads[0].type).toBe('needs_input')
      expect(dispatchedPayloads[0].body).toBe('Space: Alpha Space')
      expect(dispatchedPayloads[0].url).toBe('/spaces/ws-1')
      // Must not contain any tab field
      expect((dispatchedPayloads[0] as any).tabId).toBeUndefined()
      expect((dispatchedPayloads[0] as any).sourceTabId).toBeUndefined()
    } finally {
      console.warn = originalWarn
    }
  })

  test('delivery error logs sanitized diagnostic without endpoint, raw error, or secret', async () => {
    const detector = new PushTransitionDetector()
    const activeSub: IPushSubscription = {
      endpoint: 'https://push.example.com/send/secret-token-12345',
      keys: { p256dh, auth: authKey }
    }

    const mockStore = {
      getSubscriptions: async () => [activeSub],
      removeSubscription: async () => true
    }

    const mockClient = {
      setVapidDetails: () => {},
      sendNotification: async () => {
        const err: any = new Error(`Connection reset by provider to ${activeSub.endpoint} auth=${authKey} p256dh=${p256dh}`)
        err.code = 'ECONNRESET'
        throw err
      }
    }

    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: any[]) => {
      warnings.push(args.join(' '))
    }

    try {
      const service = new PushService({
        config: mockConfig,
        store: mockStore as any,
        detector,
        webPushClient: mockClient as any
      })

      const canonicalWorkspaces = [
        { workspace_id: 'ws-1', label: 'Beta Space', number: 0, agent_status: 'working', tab_count: 1, pane_count: 1, focused: true }
      ]
      const canonicalTabs = [
        { tab_id: 't1', workspace_id: 'ws-1', label: 'Tab 1', number: 0, pane_count: 1, focused: true, agent_status: 'working' }
      ]

      await service.handleSnapshot({
        protocol: 22,
        version: '0.9.1',
        workspaces: canonicalWorkspaces,
        tabs: canonicalTabs,
        panes: [{ pane_id: 'p1', workspace_id: 'ws-1', tab_id: 't1', agent_status: 'working', cwd: '/', focused: true }]
      })

      await service.handleSnapshot({
        protocol: 22,
        version: '0.9.1',
        workspaces: canonicalWorkspaces,
        tabs: canonicalTabs.map((tab) => ({ ...tab, agent_status: 'done' })),
        panes: [{ pane_id: 'p1', workspace_id: 'ws-1', tab_id: 't1', agent_status: 'done', cwd: '/', focused: true }]
      })

      const deliveryWarn = warnings.find((w) => w.includes('[herdr-push] Nonterminal delivery error'))
      expect(deliveryWarn).toBeDefined()
      expect(deliveryWarn).toContain('done')
      expect(deliveryWarn).not.toContain('secret-token-12345')
      expect(deliveryWarn).not.toContain('Connection reset')
      expect(deliveryWarn).not.toContain(authKey)
      expect(deliveryWarn).not.toContain(p256dh)
    } finally {
      console.warn = originalWarn
    }
  })

  test('handleSnapshot swallows and reports unexpected background processing rejections', async () => {
    const detector = new PushTransitionDetector()
    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: any[]) => {
      warnings.push(args.join(' '))
    }

    try {
      const activeSub: IPushSubscription = {
        endpoint: 'https://push.example.com/send/user-1',
        keys: { p256dh, auth: authKey }
      }

      const mockStore = {
        getSubscriptions: async () => [activeSub],
        removeSubscription: async () => true
      }

      const service = new PushService({
        config: mockConfig,
        store: mockStore as any,
        detector
      })

      const canonicalWorkspaces = [
        { workspace_id: 'ws-1', label: 'Space', number: 0, agent_status: 'working', tab_count: 1, pane_count: 1, focused: true }
      ]
      const canonicalTabs = [
        { tab_id: 't1', workspace_id: 'ws-1', label: 'Tab 1', number: 0, pane_count: 1, focused: true, agent_status: 'working' }
      ]

      // 1. Initial snapshot establishes baseline
      await service.handleSnapshot({
        protocol: 22,
        version: '0.9.1',
        workspaces: canonicalWorkspaces,
        tabs: canonicalTabs,
        panes: [{ pane_id: 'p1', workspace_id: 'ws-1', tab_id: 't1', agent_status: 'working', cwd: '/', focused: true }]
      })

      // 2. Second snapshot has a transition, and throwingOptions throws during option resolution
      const throwingOptions = {
        get timeoutMs(): number {
          throw new Error('Unexpected crash with /secret/path/to/crash')
        }
      }

      // Must NOT throw: rejection is swallowed and reported through fixed sanitized diagnostic
      await service.handleSnapshot(
        {
          protocol: 22,
          version: '0.9.1',
          workspaces: canonicalWorkspaces,
          tabs: canonicalTabs.map((tab) => ({ ...tab, agent_status: 'blocked' })),
          panes: [{ pane_id: 'p1', workspace_id: 'ws-1', tab_id: 't1', agent_status: 'blocked', cwd: '/', focused: true }]
        },
        throwingOptions as any
      )

      const bgWarn = warnings.find((w) => w.includes('[herdr-push] Unexpected background snapshot processing error'))
      expect(bgWarn).toBeDefined()
      expect(bgWarn).toBe('[herdr-push] Unexpected background snapshot processing error')
      expect(bgWarn).not.toContain('/secret/path')
      expect(bgWarn).not.toContain('Unexpected crash')
    } finally {
      console.warn = originalWarn
    }
  })
})
