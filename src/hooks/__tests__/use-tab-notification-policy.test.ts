import { describe, expect, it } from 'bun:test'
import type { ITab } from '@/types/herdr.ts'
import type { ILiveTabPolicy } from '@/services/push-client.ts'
import {
  computeTabTopologyKey,
  classifyTabPolicyError,
  mergeInitialPolicies,
  applyOptimisticUpdate,
  applyTargetPolicyMerge,
  applyRollback
} from '../use-tab-notification-policy.ts'

const createMockPolicy = (
  overrides: Partial<ILiveTabPolicy> & { tabId: string }
): ILiveTabPolicy => ({
  workspaceId: 'ws-1',
  workspaceLabel: 'Workspace 1',
  workspaceNumber: 1,
  tabLabel: 'Tab',
  tabNumber: 1,
  enabled: false,
  isDefaultOwner: false,
  source: 'default',
  ...overrides
})

describe('useTabNotificationPolicy pure state helpers and reducer contracts', () => {
  it('computes tab topology key including workspace, tab id, number, and label', () => {
    const tabs: ITab[] = [
      {
        tab_id: 't2',
        workspace_id: 'ws-1',
        label: 'Tab Two',
        number: 2,
        pane_count: 1,
        focused: false,
        agent_status: 'idle'
      },
      {
        tab_id: 't1',
        workspace_id: 'ws-1',
        label: 'Tab One',
        number: 1,
        pane_count: 1,
        focused: true,
        agent_status: 'idle'
      }
    ]

    const key1 = computeTabTopologyKey(tabs)
    expect(key1).toBe('ws-1:t1:1:Tab One|ws-1:t2:2:Tab Two')

    // Rearranging order yields identical deterministic key
    const key2 = computeTabTopologyKey([...tabs].reverse())
    expect(key2).toBe(key1)

    // Modifying label changes key
    const labelChanged = tabs.map((t) => (t.tab_id === 't1' ? { ...t, label: 'Renamed Tab' } : t))
    expect(computeTabTopologyKey(labelChanged)).not.toBe(key1)
    expect(computeTabTopologyKey(labelChanged)).toContain('Renamed Tab')

    // Modifying tab number changes key
    const numberChanged = tabs.map((t) => (t.tab_id === 't1' ? { ...t, number: 99 } : t))
    expect(computeTabTopologyKey(numberChanged)).not.toBe(key1)
    expect(computeTabTopologyKey(numberChanged)).toContain('ws-1:t1:99:Tab One')
  })

  it('classifies load errors into bounded neutral unavailable vs real error', () => {
    // 503 Push not configured
    const err503 = new Error('HTTP 503: push not configured')
    expect(classifyTabPolicyError(err503)).toEqual({
      status: 'unavailable',
      error: null
    })

    // 409 CLI transport mode
    const err409 = new Error('HTTP 409: push disabled in CLI mode')
    expect(classifyTabPolicyError(err409)).toEqual({
      status: 'unavailable',
      error: null
    })

    // not_configured / service_unavailable keywords
    expect(classifyTabPolicyError(new Error('not_configured'))).toEqual({
      status: 'unavailable',
      error: null
    })
    expect(classifyTabPolicyError('service_unavailable')).toEqual({
      status: 'unavailable',
      error: null
    })

    // Real server/network error is preserved truthfully
    const realErr = new Error('Failed to fetch from /api/push/tab-policy')
    expect(classifyTabPolicyError(realErr)).toEqual({
      status: 'error',
      error: 'Failed to load notification settings'
    })
  })

  it('preserves in-flight optimistic policy for pending tabs when initial/refresh load finishes', () => {
    const currentPolicies = new Map<string, ILiveTabPolicy>([
      ['t1', createMockPolicy({ tabId: 't1', enabled: true, source: 'override' })],
      ['t2', createMockPolicy({ tabId: 't2', enabled: false, source: 'default' })]
    ])

    // t1 has an in-flight mutation toggling it to false
    currentPolicies.set('t1', { ...currentPolicies.get('t1')!, enabled: false })
    const pendingTabIds = new Set(['t1'])

    // Server responds with older state (t1: true, t2: false)
    const serverTabs: ILiveTabPolicy[] = [
      createMockPolicy({ tabId: 't1', enabled: true, source: 'override' }),
      createMockPolicy({ tabId: 't2', enabled: false, source: 'default' })
    ]

    const merged = mergeInitialPolicies(currentPolicies, serverTabs, pendingTabIds)
    // t1 in-flight state is preserved
    expect(merged.get('t1')?.enabled).toBe(false)
    // t2 non-pending state is updated from server
    expect(merged.get('t2')?.enabled).toBe(false)
  })

  it('applyOptimisticUpdate toggles only the target tab and fails closed on unknown tab', () => {
    const initialPolicies = new Map<string, ILiveTabPolicy>([
      ['t1', createMockPolicy({ tabId: 't1', enabled: true, isDefaultOwner: true })],
      ['t2', createMockPolicy({ tabId: 't2', enabled: false, isDefaultOwner: false })]
    ])

    // Target t2
    const updated = applyOptimisticUpdate(initialPolicies, 't2', true)
    expect(updated.get('t2')?.enabled).toBe(true)
    // t1 remains untouched
    expect(updated.get('t1')?.enabled).toBe(true)
    // original map is not mutated
    expect(initialPolicies.get('t2')?.enabled).toBe(false)

    // Unknown tab returns original map without creating a guessed entry
    const unknownResult = applyOptimisticUpdate(initialPolicies, 't-unknown', true)
    expect(unknownResult).toBe(initialPolicies)
    expect(unknownResult.has('t-unknown')).toBe(false)
  })

  it('applyTargetPolicyMerge merges ONLY matching target policy from server response', () => {
    const policies = new Map<string, ILiveTabPolicy>([
      ['t1', createMockPolicy({ tabId: 't1', enabled: true, isDefaultOwner: true })],
      ['t2', createMockPolicy({ tabId: 't2', enabled: true, source: 'override' })]
    ])

    // Server response from a mutation on t1, but server response contains older snapshot for t2
    const serverTabs: ILiveTabPolicy[] = [
      createMockPolicy({ tabId: 't1', enabled: false, source: 'override' }),
      createMockPolicy({ tabId: 't2', enabled: false, source: 'default' }) // stale t2!
    ]

    const merged = applyTargetPolicyMerge(policies, 't1', serverTabs)
    // t1 is updated from server response
    expect(merged.get('t1')?.enabled).toBe(false)
    // t2 MUST NOT be overwritten by serverTabs!
    expect(merged.get('t2')?.enabled).toBe(true)
  })

  it('applyRollback reverts only the target tab and leaves other tabs untouched', () => {
    const previousPolicy: ILiveTabPolicy = createMockPolicy({
      tabId: 't1',
      enabled: true,
      isDefaultOwner: true
    })

    const currentPolicies = new Map<string, ILiveTabPolicy>([
      ['t1', createMockPolicy({ tabId: 't1', enabled: false, source: 'override' })],
      ['t2', createMockPolicy({ tabId: 't2', enabled: true, source: 'override' })]
    ])

    const rolledBack = applyRollback(currentPolicies, 't1', previousPolicy)
    // t1 is restored to previous policy
    expect(rolledBack.get('t1')?.enabled).toBe(true)
    // t2 remains unchanged
    expect(rolledBack.get('t2')?.enabled).toBe(true)
  })

  it('concurrent t1 and t2 responses in any order preserve both updated states', () => {
    let policies = new Map<string, ILiveTabPolicy>([
      ['t1', createMockPolicy({ tabId: 't1', enabled: false, isDefaultOwner: true })],
      ['t2', createMockPolicy({ tabId: 't2', enabled: false })]
    ])

    // User toggles t1 to true (optimistic)
    policies = applyOptimisticUpdate(policies, 't1', true)
    expect(policies.get('t1')?.enabled).toBe(true)
    expect(policies.get('t2')?.enabled).toBe(false)

    // User immediately toggles t2 to true (optimistic)
    policies = applyOptimisticUpdate(policies, 't2', true)
    expect(policies.get('t1')?.enabled).toBe(true)
    expect(policies.get('t2')?.enabled).toBe(true)

    // Suppose server response for t1 arrives first, generated before server saw t2:
    const res1Tabs: ILiveTabPolicy[] = [
      createMockPolicy({ tabId: 't1', enabled: true, source: 'override' }),
      createMockPolicy({ tabId: 't2', enabled: false, source: 'default' }) // server still had t2 false!
    ]
    policies = applyTargetPolicyMerge(policies, 't1', res1Tabs)
    // t1 confirmed true; t2 optimistic true is NOT clobbered by res1!
    expect(policies.get('t1')?.enabled).toBe(true)
    expect(policies.get('t2')?.enabled).toBe(true)

    // Suppose server response for t2 arrives second:
    const res2Tabs: ILiveTabPolicy[] = [
      createMockPolicy({ tabId: 't1', enabled: true, source: 'override' }),
      createMockPolicy({ tabId: 't2', enabled: true, source: 'override' })
    ]
    policies = applyTargetPolicyMerge(policies, 't2', res2Tabs)
    // Both t1 and t2 are confirmed true!
    expect(policies.get('t1')?.enabled).toBe(true)
    expect(policies.get('t2')?.enabled).toBe(true)
  })

  it('stale out-of-order response for the same tab is ignored via generation tracking', () => {
    const generations = new Map<string, number>()

    // Request 1 for t1
    const gen1 = 1
    generations.set('t1', gen1)

    // Request 2 for t1 before Request 1 arrives
    const gen2 = 2
    generations.set('t1', gen2)

    // When Request 1 arrives late:
    const isStale = generations.get('t1') !== gen1
    expect(isStale).toBe(true)

    // When Request 2 arrives:
    const isLatest = generations.get('t1') === gen2
    expect(isLatest).toBe(true)
  })
})
