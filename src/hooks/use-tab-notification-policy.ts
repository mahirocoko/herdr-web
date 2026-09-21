import { useCallback, useEffect, useRef, useState } from 'react'
import type { ITab } from '@/types/herdr.ts'
import {
  fetchTabPolicy,
  updateTabPolicy,
  type ILiveTabPolicy
} from '@/services/push-client.ts'

export type TabPolicyServiceStatus = 'loading' | 'ready' | 'unavailable' | 'error'

/**
 * Computes a deterministic topology key from live tabs.
 * Captures all tab-level fingerprint fields available to the hook: workspace_id, tab_id, number, and label.
 * Note: Workspace-level label changes are not captured because workspaces are not supplied to this hook.
 */
export const computeTabTopologyKey = (tabs: ITab[] = []): string =>
  tabs
    .map((t) => `${t.workspace_id}:${t.tab_id}:${t.number}:${t.label}`)
    .sort()
    .join('|')

/**
 * Distinguishes configured-unavailable (409 CLI mode, 503 Push unconfigured)
 * from real network/server load errors.
 */
export function classifyTabPolicyError(err: unknown): {
  status: 'unavailable' | 'error'
  error: string | null
} {
  const msg = err instanceof Error ? err.message : String(err)
  if (
    msg.includes('503') ||
    msg.includes('409') ||
    msg.includes('not_configured') ||
    msg.includes('service_unavailable')
  ) {
    return { status: 'unavailable', error: null }
  }
  return { status: 'error', error: 'Failed to load notification settings' }
}

/**
 * Merges fresh server tabs on initial/refresh load into current policies,
 * preserving any currently in-flight optimistic policy for pending tabs.
 */
export function mergeInitialPolicies(
  currentPolicies: Map<string, ILiveTabPolicy>,
  serverTabs: ILiveTabPolicy[],
  pendingTabIds: Set<string>
): Map<string, ILiveTabPolicy> {
  const nextMap = new Map<string, ILiveTabPolicy>()
  for (const item of serverTabs) {
    if (item && typeof item.tabId === 'string') {
      if (pendingTabIds.has(item.tabId) && currentPolicies.has(item.tabId)) {
        // Retain in-flight optimistic state for this specific pending tab
        nextMap.set(item.tabId, currentPolicies.get(item.tabId)!)
      } else {
        nextMap.set(item.tabId, item)
      }
    }
  }
  return nextMap
}

/**
 * Applies an optimistic update ONLY to the target tab.
 * Does not touch any other tab in the map.
 * Returns the original map if targetTabId is not found (prevents guessed mutations).
 */
export function applyOptimisticUpdate(
  policies: Map<string, ILiveTabPolicy>,
  targetTabId: string,
  nextEnabled: boolean
): Map<string, ILiveTabPolicy> {
  const current = policies.get(targetTabId)
  if (!current) return policies
  const next = new Map(policies)
  next.set(targetTabId, { ...current, enabled: nextEnabled })
  return next
}

/**
 * Merges ONLY the target tab's policy from a mutation response into current policies.
 * Guarantees that an out-of-order or concurrent response from another tab
 * does not overwrite newer successful states of other tabs.
 */
export function applyTargetPolicyMerge(
  policies: Map<string, ILiveTabPolicy>,
  targetTabId: string,
  serverTabs: ILiveTabPolicy[]
): Map<string, ILiveTabPolicy> {
  const serverTarget = serverTabs.find((t) => t && t.tabId === targetTabId)
  if (!serverTarget) return policies
  const next = new Map(policies)
  next.set(targetTabId, serverTarget)
  return next
}

/**
 * Reverts ONLY the target tab to its previous policy upon mutation failure.
 * Leaves all other tabs completely untouched.
 */
export function applyRollback(
  policies: Map<string, ILiveTabPolicy>,
  targetTabId: string,
  previousPolicy: ILiveTabPolicy
): Map<string, ILiveTabPolicy> {
  const next = new Map(policies)
  next.set(targetTabId, previousPolicy)
  return next
}

export interface IUseTabNotificationPolicyOptions {
  isOpen: boolean
  tabs?: ITab[]
}

export interface IUseTabNotificationPolicyResult {
  policies: Map<string, ILiveTabPolicy>
  status: TabPolicyServiceStatus
  pendingTabIds: Set<string>
  error: string | null
  isTabReady: (tabId: string) => boolean
  toggleTabPolicy: (tabId: string) => Promise<void>
  refresh: () => Promise<void>
}

export const useTabNotificationPolicy = ({
  isOpen,
  tabs = []
}: IUseTabNotificationPolicyOptions): IUseTabNotificationPolicyResult => {
  const [policies, setPolicies] = useState<Map<string, ILiveTabPolicy>>(new Map())
  const [status, setStatus] = useState<TabPolicyServiceStatus>('loading')
  const [pendingTabIds, setPendingTabIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const tabGenerationsRef = useRef<Map<string, number>>(new Map())
  const pendingTabIdsRef = useRef<Set<string>>(pendingTabIds)
  pendingTabIdsRef.current = pendingTabIds

  const tabTopologyKey = computeTabTopologyKey(tabs)

  const refresh = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const res = await fetchTabPolicy(controller.signal)
      if (res.ok && Array.isArray(res.tabs)) {
        setPolicies((prev) => mergeInitialPolicies(prev, res.tabs, pendingTabIdsRef.current))
        setStatus('ready')
        setError(null)
      } else {
        throw new Error(res.error || 'Failed to load notification settings')
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return
      const classified = classifyTabPolicyError(err)
      setStatus(classified.status)
      setError(classified.error)
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    setStatus('loading')
    refresh()

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [isOpen, tabTopologyKey, refresh])

  const isTabReady = useCallback(
    (tabId: string): boolean => {
      return status === 'ready' && policies.has(tabId)
    },
    [status, policies]
  )

  const toggleTabPolicy = useCallback(
    async (tabId: string) => {
      // Truthful guard: Never send a guessed mutation if policy is unknown or service not ready!
      if (status !== 'ready') return
      const current = policies.get(tabId)
      if (!current) return

      const nextEnabled = !current.enabled
      const nextGen = (tabGenerationsRef.current.get(tabId) ?? 0) + 1
      tabGenerationsRef.current.set(tabId, nextGen)

      // Optimistic update ONLY on target tab
      setError(null)
      setPendingTabIds((prev) => new Set(prev).add(tabId))
      setPolicies((prev) => applyOptimisticUpdate(prev, tabId, nextEnabled))

      try {
        const res = await updateTabPolicy(tabId, nextEnabled)
        // Stale response check: If a newer mutation was triggered for this tab, discard this response
        if (tabGenerationsRef.current.get(tabId) !== nextGen) return

        if (res.ok && Array.isArray(res.tabs)) {
          // Merge ONLY the matching target policy from the response
          setPolicies((prev) => applyTargetPolicyMerge(prev, tabId, res.tabs))
          setError(null)
        } else {
          throw new Error(res.error || 'Failed to update notification setting')
        }
      } catch (err: unknown) {
        // Stale error check
        if (tabGenerationsRef.current.get(tabId) !== nextGen) return

        // Rollback ONLY target tab
        setPolicies((prev) => applyRollback(prev, tabId, current))
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg || 'Failed to update notification setting')
      } finally {
        if (tabGenerationsRef.current.get(tabId) === nextGen) {
          setPendingTabIds((prev) => {
            const next = new Set(prev)
            next.delete(tabId)
            return next
          })
        }
      }
    },
    [status, policies]
  )

  return {
    policies,
    status,
    pendingTabIds,
    error,
    isTabReady,
    toggleTabPolicy,
    refresh
  }
}
