import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import webpush from 'web-push'
import { createServer } from '../index.ts'
import { resetSharedPushService } from '../push/service.ts'

describe('server: push tab policy API routes integration', () => {
  const originalConfigEnv = process.env.HERDR_PUSH_CONFIG_PATH
  const originalSubsEnv = process.env.HERDR_PUSH_SUBSCRIPTIONS_PATH
  const originalPolicyEnv = process.env.HERDR_PUSH_TAB_POLICY_PATH
  const originalTransportEnv = process.env.HERDR_TRANSPORT
  const originalSocketEnv = process.env.HERDR_SOCKET_PATH

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-tab-policy-routes-'))
  const configPath = path.join(tmpDir, 'push-config.json')
  const subsPath = path.join(tmpDir, 'push-subscriptions.json')
  const policyPath = path.join(tmpDir, 'push-tab-policy.json')
  const mockSocketPath = path.join(tmpDir, 'mock-herdr.sock')

  const vapidKeys = webpush.generateVAPIDKeys()

  const validConfig = {
    ownerLogin: 'owner@example.com',
    publicKey: vapidKeys.publicKey,
    privateKey: vapidKeys.privateKey,
    subject: 'mailto:owner@example.com'
  }
  fs.writeFileSync(configPath, JSON.stringify(validConfig), { mode: 0o600 })

  process.env.HERDR_PUSH_CONFIG_PATH = configPath
  process.env.HERDR_PUSH_SUBSCRIPTIONS_PATH = subsPath
  process.env.HERDR_PUSH_TAB_POLICY_PATH = policyPath
  process.env.HERDR_SOCKET_PATH = mockSocketPath
  delete process.env.HERDR_TRANSPORT
  resetSharedPushService()

  let mockSocketServer: net.Server
  let appServer: ReturnType<typeof createServer>
  let baseUrl: string

  const mockSnapshotData = {
    protocol: 22,
    version: '0.9.1',
    workspaces: [
      {
        workspace_id: 'ws-1',
        label: 'Workspace One',
        number: 1,
        agent_status: 'working',
        tab_count: 2,
        pane_count: 2,
        focused: true
      }
    ],
    tabs: [
      {
        tab_id: 'tab-1',
        workspace_id: 'ws-1',
        label: 'Tab 1',
        number: 1,
        pane_count: 1,
        focused: true,
        agent_status: 'working'
      },
      {
        tab_id: 'tab-2',
        workspace_id: 'ws-1',
        label: 'Tab 2',
        number: 2,
        pane_count: 1,
        focused: false,
        agent_status: 'working'
      }
    ],
    panes: [
      {
        pane_id: 'p1',
        workspace_id: 'ws-1',
        tab_id: 'tab-1',
        agent_status: 'working',
        cwd: '/test',
        focused: true
      },
      {
        pane_id: 'p2',
        workspace_id: 'ws-1',
        tab_id: 'tab-2',
        agent_status: 'working',
        cwd: '/test',
        focused: false
      }
    ]
  }

  beforeAll(async () => {
    // Start mock Herdr socket server handling session.ping and session.snapshot
    mockSocketServer = net.createServer((socket) => {
      let buffer = ''
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8')
        while (buffer.includes('\n')) {
          const idx = buffer.indexOf('\n')
          const line = buffer.slice(0, idx).trim()
          buffer = buffer.slice(idx + 1)
          if (!line) continue

          try {
            const req = JSON.parse(line)
            if (req.method === 'session.ping') {
              socket.write(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: req.id,
                  result: { protocol: 22, version: '0.9.1', server: 'mock' }
                }) + '\n'
              )
            } else if (req.method === 'session.snapshot') {
              socket.write(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: req.id,
                  result: mockSnapshotData
                }) + '\n'
              )
            } else {
              socket.write(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: req.id,
                  result: {}
                }) + '\n'
              )
            }
          } catch {}
        }
      })
    })

    await new Promise<void>((resolve) => {
      mockSocketServer.listen(mockSocketPath, () => resolve())
    })

    appServer = createServer(0, '127.0.0.1', { startPushBridge: false })
    baseUrl = `http://127.0.0.1:${appServer.port}`
  })

  afterAll(async () => {
    if (appServer) {
      appServer.stop(true)
    }
    if (mockSocketServer) {
      await new Promise<void>((resolve) => mockSocketServer.close(() => resolve()))
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}

    if (originalConfigEnv !== undefined) process.env.HERDR_PUSH_CONFIG_PATH = originalConfigEnv
    else delete process.env.HERDR_PUSH_CONFIG_PATH

    if (originalSubsEnv !== undefined) process.env.HERDR_PUSH_SUBSCRIPTIONS_PATH = originalSubsEnv
    else delete process.env.HERDR_PUSH_SUBSCRIPTIONS_PATH

    if (originalPolicyEnv !== undefined) process.env.HERDR_PUSH_TAB_POLICY_PATH = originalPolicyEnv
    else delete process.env.HERDR_PUSH_TAB_POLICY_PATH

    if (originalTransportEnv !== undefined) process.env.HERDR_TRANSPORT = originalTransportEnv
    else delete process.env.HERDR_TRANSPORT

    if (originalSocketEnv !== undefined) process.env.HERDR_SOCKET_PATH = originalSocketEnv
    else delete process.env.HERDR_SOCKET_PATH

    resetSharedPushService()
  })

  test('GET /api/push/tab-policy rejects unauthorized host or origin', async () => {
    // 1. Bad host
    const badHost = await fetch(`${baseUrl}/api/push/tab-policy`, {
      headers: { host: 'evil.com' }
    })
    expect(badHost.status).toBe(403)

    // 2. Bad origin
    const badOrigin = await fetch(`${baseUrl}/api/push/tab-policy`, {
      headers: {
        host: `127.0.0.1:${appServer.port}`,
        origin: 'http://evil.com'
      }
    })
    expect(badOrigin.status).toBe(403)
  })

  test('GET /api/push/tab-policy returns default policy for live tabs without overrides', async () => {
    const res = await fetch(`${baseUrl}/api/push/tab-policy`, {
      headers: {
        host: `127.0.0.1:${appServer.port}`,
        origin: `http://127.0.0.1:${appServer.port}`
      }
    })
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.tabs)).toBe(true)
    expect(body.tabs).toHaveLength(2)

    // First canonical tab is enabled by default
    expect(body.tabs[0]).toEqual({
      workspaceId: 'ws-1',
      tabId: 'tab-1',
      workspaceLabel: 'Workspace One',
      workspaceNumber: 1,
      tabLabel: 'Tab 1',
      tabNumber: 1,
      enabled: true,
      isDefaultOwner: true,
      source: 'default'
    })

    // Second tab is disabled by default
    expect(body.tabs[1]).toEqual({
      workspaceId: 'ws-1',
      tabId: 'tab-2',
      workspaceLabel: 'Workspace One',
      workspaceNumber: 1,
      tabLabel: 'Tab 2',
      tabNumber: 2,
      enabled: false,
      isDefaultOwner: false,
      source: 'default'
    })
  })

  test('PUT /api/push/tab-policy mutation requires strict origin and validates payload', async () => {
    // 1. Missing or unauthorized origin
    const noOrigin = await fetch(`${baseUrl}/api/push/tab-policy`, {
      method: 'PUT',
      headers: {
        host: `127.0.0.1:${appServer.port}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ tabId: 'tab-2', enabled: true })
    })
    expect(noOrigin.status).toBe(403)

    const evilOrigin = await fetch(`${baseUrl}/api/push/tab-policy`, {
      method: 'PUT',
      headers: {
        host: `127.0.0.1:${appServer.port}`,
        origin: 'http://evil.com',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ tabId: 'tab-2', enabled: true })
    })
    expect(evilOrigin.status).toBe(403)

    // 2. Malformed payload
    const headers = {
      host: `127.0.0.1:${appServer.port}`,
      origin: `http://127.0.0.1:${appServer.port}`,
      'content-type': 'application/json'
    }

    const missingTabId = await fetch(`${baseUrl}/api/push/tab-policy`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ enabled: true })
    })
    expect(missingTabId.status).toBe(400)

    const invalidEnabled = await fetch(`${baseUrl}/api/push/tab-policy`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ tabId: 'tab-2', enabled: 'yes' })
    })
    expect(invalidEnabled.status).toBe(400)

    // 3. Tab not found in live topology
    const notFound = await fetch(`${baseUrl}/api/push/tab-policy`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ tabId: 'non-existent-tab', enabled: true })
    })
    expect(notFound.status).toBe(404)
  })

  test('PUT /api/push/tab-policy enables non-first tab and removes override when set to default', async () => {
    const headers = {
      host: `127.0.0.1:${appServer.port}`,
      origin: `http://127.0.0.1:${appServer.port}`,
      'content-type': 'application/json'
    }

    // 1. Enable tab-2 (non-first tab override)
    const enableRes = await fetch(`${baseUrl}/api/push/tab-policy`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ tabId: 'tab-2', enabled: true })
    })
    expect(enableRes.status).toBe(200)
    const enableBody: any = await enableRes.json()
    expect(enableBody.ok).toBe(true)

    const tab2Policy = enableBody.tabs.find((t: any) => t.tabId === 'tab-2')
    expect(tab2Policy).toMatchObject({
      tabId: 'tab-2',
      enabled: true,
      isDefaultOwner: false,
      source: 'override'
    })

    // Store file has 1 record
    const storeRecords = JSON.parse(fs.readFileSync(policyPath, 'utf8'))
    expect(storeRecords.overrides).toHaveLength(1)
    expect(storeRecords.overrides[0].tabId).toBe('tab-2')
    expect(storeRecords.overrides[0].enabled).toBe(true)

    // 2. Disable tab-2 (matches default) -> override is removed from store
    const disableRes = await fetch(`${baseUrl}/api/push/tab-policy`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ tabId: 'tab-2', enabled: false })
    })
    expect(disableRes.status).toBe(200)
    const disableBody: any = await disableRes.json()
    const tab2Reverted = disableBody.tabs.find((t: any) => t.tabId === 'tab-2')
    expect(tab2Reverted).toMatchObject({
      tabId: 'tab-2',
      enabled: false,
      isDefaultOwner: false,
      source: 'default'
    })

    // Store file is now empty
    const clearedRecords = JSON.parse(fs.readFileSync(policyPath, 'utf8'))
    expect(clearedRecords.overrides).toHaveLength(0)
  })

  test('PUT /api/push/tab-policy allows explicitly disabling the first canonical tab', async () => {
    const headers = {
      host: `127.0.0.1:${appServer.port}`,
      origin: `http://127.0.0.1:${appServer.port}`,
      'content-type': 'application/json'
    }

    // 1. Disable tab-1 (first canonical tab)
    const disableRes = await fetch(`${baseUrl}/api/push/tab-policy`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ tabId: 'tab-1', enabled: false })
    })
    expect(disableRes.status).toBe(200)
    const disableBody: any = await disableRes.json()
    const tab1Policy = disableBody.tabs.find((t: any) => t.tabId === 'tab-1')
    expect(tab1Policy).toMatchObject({
      tabId: 'tab-1',
      enabled: false,
      isDefaultOwner: true,
      source: 'override'
    })

    // 2. Re-enable tab-1 (matches default true) -> override removed
    const enableRes = await fetch(`${baseUrl}/api/push/tab-policy`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ tabId: 'tab-1', enabled: true })
    })
    expect(enableRes.status).toBe(200)
    const enableBody: any = await enableRes.json()
    const tab1Reverted = enableBody.tabs.find((t: any) => t.tabId === 'tab-1')
    expect(tab1Reverted).toMatchObject({
      tabId: 'tab-1',
      enabled: true,
      isDefaultOwner: true,
      source: 'default'
    })
  })
})
