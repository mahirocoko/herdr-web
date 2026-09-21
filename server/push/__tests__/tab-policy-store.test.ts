import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ITab, IWorkspace } from '../../types.ts'
import {
  computeTabFingerprint,
  matchesFingerprint,
  PushTabPolicyStore,
  resolveEffectiveTabPolicy
} from '../tab-policy-store.ts'

describe('PushTabPolicyStore and resolveEffectiveTabPolicy', () => {
  let tmpDir: string
  let storePath: string
  let store: PushTabPolicyStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-tab-policy-test-'))
    storePath = path.join(tmpDir, 'push-tab-policy.json')
    store = new PushTabPolicyStore(storePath)
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  it('computes and compares topology fingerprints accurately', () => {
    const ws = { number: 1, label: 'Main Space' }
    const tab = { number: 2, label: 'Tab 2' }
    const fp1 = computeTabFingerprint(ws, tab)
    expect(fp1).toEqual({
      workspaceNumber: 1,
      workspaceLabel: 'Main Space',
      tabNumber: 2,
      tabLabel: 'Tab 2'
    })

    const fp2 = computeTabFingerprint(ws, tab)
    expect(matchesFingerprint(fp1, fp2)).toBe(true)

    const fpMismatch = computeTabFingerprint({ number: 1, label: 'Different Space' }, tab)
    expect(matchesFingerprint(fp1, fpMismatch)).toBe(false)
  })

  it('defaults first canonical tab to enabled and other tabs to disabled', () => {
    const workspaces: IWorkspace[] = [
      {
        workspace_id: 'ws-1',
        label: 'Space 1',
        number: 1,
        agent_status: 'idle',
        tab_count: 2,
        pane_count: 2,
        focused: true
      }
    ]
    const tabs: ITab[] = [
      {
        tab_id: 'tab-1',
        workspace_id: 'ws-1',
        label: 'First Tab',
        number: 1,
        pane_count: 1,
        focused: true,
        agent_status: 'idle'
      },
      {
        tab_id: 'tab-2',
        workspace_id: 'ws-1',
        label: 'Second Tab',
        number: 2,
        pane_count: 1,
        focused: false,
        agent_status: 'idle'
      }
    ]

    const effective = resolveEffectiveTabPolicy(workspaces, tabs, [])
    expect(effective).toHaveLength(2)

    expect(effective[0]).toMatchObject({
      tabId: 'tab-1',
      enabled: true,
      isDefaultOwner: true,
      source: 'default'
    })
    expect(effective[1]).toMatchObject({
      tabId: 'tab-2',
      enabled: false,
      isDefaultOwner: false,
      source: 'default'
    })
  })

  it('matching explicit override wins over default', () => {
    const workspaces: IWorkspace[] = [
      {
        workspace_id: 'ws-1',
        label: 'Space 1',
        number: 1,
        agent_status: 'idle',
        tab_count: 2,
        pane_count: 2,
        focused: true
      }
    ]
    const tabs: ITab[] = [
      {
        tab_id: 'tab-1',
        workspace_id: 'ws-1',
        label: 'First Tab',
        number: 1,
        pane_count: 1,
        focused: true,
        agent_status: 'idle'
      },
      {
        tab_id: 'tab-2',
        workspace_id: 'ws-1',
        label: 'Second Tab',
        number: 2,
        pane_count: 1,
        focused: false,
        agent_status: 'idle'
      }
    ]

    const overrides = [
      {
        workspaceId: 'ws-1',
        tabId: 'tab-1',
        enabled: false,
        fingerprint: computeTabFingerprint(workspaces[0], tabs[0])
      },
      {
        workspaceId: 'ws-1',
        tabId: 'tab-2',
        enabled: true,
        fingerprint: computeTabFingerprint(workspaces[0], tabs[1])
      }
    ]

    const effective = resolveEffectiveTabPolicy(workspaces, tabs, overrides)
    expect(effective[0]).toMatchObject({
      tabId: 'tab-1',
      enabled: false,
      isDefaultOwner: true,
      source: 'override'
    })
    expect(effective[1]).toMatchObject({
      tabId: 'tab-2',
      enabled: true,
      isDefaultOwner: false,
      source: 'override'
    })
  })

  it('stale override with mismatched fingerprint is ignored fail-safe', () => {
    const workspaces: IWorkspace[] = [
      {
        workspace_id: 'ws-1',
        label: 'Current Space',
        number: 1,
        agent_status: 'idle',
        tab_count: 1,
        pane_count: 1,
        focused: true
      }
    ]
    const tabs: ITab[] = [
      {
        tab_id: 'tab-1',
        workspace_id: 'ws-1',
        label: 'First Tab',
        number: 1,
        pane_count: 1,
        focused: true,
        agent_status: 'idle'
      },
      {
        tab_id: 'tab-2',
        workspace_id: 'ws-1',
        label: 'Current Tab 2',
        number: 2,
        pane_count: 1,
        focused: false,
        agent_status: 'idle'
      }
    ]

    // Override was created for a previous session with different space/tab numbers or labels
    const staleOverrides = [
      {
        workspaceId: 'ws-1',
        tabId: 'tab-2',
        enabled: true,
        fingerprint: {
          workspaceNumber: 999, // mismatch
          workspaceLabel: 'Old Space',
          tabNumber: 999,
          tabLabel: 'Old Tab'
        }
      }
    ]

    const effective = resolveEffectiveTabPolicy(workspaces, tabs, staleOverrides)
    expect(effective[1]).toMatchObject({
      tabId: 'tab-2',
      enabled: false, // stale override ignored!
      source: 'default'
    })
  })

  it('setting a tab to default removes the override from store', async () => {
    const ws = { workspace_id: 'ws-1', number: 1, label: 'Space 1' }
    const tab2 = { tab_id: 'tab-2', number: 2, label: 'Tab 2' }

    // 1. Set non-default override (tab 2 enabled = true)
    let records = await store.setTabOverride(ws, tab2, true, false)
    expect(records).toHaveLength(1)
    expect(records[0].tabId).toBe('tab-2')
    expect(records[0].enabled).toBe(true)

    // 2. Set back to default (tab 2 enabled = false)
    records = await store.setTabOverride(ws, tab2, false, false)
    expect(records).toHaveLength(0) // Removed!

    // Verify written file
    const loaded = await store.getOverrides()
    expect(loaded).toHaveLength(0)
  })

  it('setting first tab to disabled stores override, and re-enabling removes it', async () => {
    const ws = { workspace_id: 'ws-1', number: 1, label: 'Space 1' }
    const tab1 = { tab_id: 'tab-1', number: 1, label: 'Tab 1' }

    // 1. Explicitly disable first tab (default is true)
    let records = await store.setTabOverride(ws, tab1, false, true)
    expect(records).toHaveLength(1)
    expect(records[0].tabId).toBe('tab-1')
    expect(records[0].enabled).toBe(false)

    // 2. Re-enable first tab (matches default true)
    records = await store.setTabOverride(ws, tab1, true, true)
    expect(records).toHaveLength(0) // Removed!
  })

  it('enforces secure file (0600) and directory (0700) permissions', async () => {
    if (process.platform === 'win32') return

    const ws = { workspace_id: 'ws-1', number: 1, label: 'Space 1' }
    const tab = { tab_id: 'tab-2', number: 2, label: 'Tab 2' }
    await store.setTabOverride(ws, tab, true, false)

    const fileStat = fs.statSync(storePath)
    expect((fileStat.mode & 0o777) & 0o077).toBe(0)

    // Insecure permissions trigger failure
    fs.chmodSync(storePath, 0o666)
    expect(() => new PushTabPolicyStore(storePath).getOverrides()).toThrow('permissions are insecure')
  })

  it('rejects malformed or corrupt store fail closed without leaking raw data', async () => {
    fs.writeFileSync(storePath, 'not-json', { mode: 0o600 })
    expect(() => store.getOverrides()).toThrow('invalid or corrupt')

    fs.writeFileSync(storePath, JSON.stringify({ version: 2, overrides: [] }), { mode: 0o600 })
    expect(() => store.getOverrides()).toThrow('invalid or corrupt')

    fs.writeFileSync(storePath, JSON.stringify({ version: 1, overrides: 'not-an-array' }), { mode: 0o600 })
    expect(() => store.getOverrides()).toThrow('invalid or corrupt')

    // Reject duplicate tab in overrides
    const dup = {
      version: 1,
      overrides: [
        {
          workspaceId: 'ws-1',
          tabId: 'tab-1',
          enabled: true,
          fingerprint: { workspaceNumber: 1, workspaceLabel: 'w', tabNumber: 1, tabLabel: 't' }
        },
        {
          workspaceId: 'ws-1',
          tabId: 'tab-1',
          enabled: false,
          fingerprint: { workspaceNumber: 1, workspaceLabel: 'w', tabNumber: 1, tabLabel: 't' }
        }
      ]
    }
    fs.writeFileSync(storePath, JSON.stringify(dup), { mode: 0o600 })
    expect(() => store.getOverrides()).toThrow('invalid or corrupt')
  })
})
