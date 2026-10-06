import type { ICatalogItem } from '@/types/herdr.ts'
import {
  CANONICAL_TERMINAL_KEYS_SET,
  DEFAULT_PRIMARY_KEYS,
} from './terminal-keys.ts'

export const CUSTOM_ACTIONS_STORAGE_KEY = 'herdr_custom_actions_v1'
export const MAX_STORAGE_BYTES = 32768 // 32 KiB bounded localStorage limit
export const MAX_ACTIONS_PER_SCOPE = 50
export const MAX_LABEL_LENGTH = 100
export const MAX_FILL_VALUE_LENGTH = 1000
export const MAX_DESCRIPTION_LENGTH = 250
export const MAX_CATEGORY_LENGTH = 50
export const MAX_KEYS_PER_ACTION = 16

export type ActionKind = 'draft-fill' | 'terminal-key'
export type ActionProvenance = 'user' | 'repo-config' | 'preset'
export type ActionScopeType = 'global' | 'space'

// Backwards-compatible aliases
export type IActionKind = ActionKind
export type IActionProvenance = ActionProvenance
export type IActionScopeType = ActionScopeType

export interface IUserCustomAction {
  id: string
  label: string
  kind: ActionKind
  fillValue?: string
  keys?: string[]
  category?: string
  description?: string
  pinned?: boolean
  order?: number
  scope: ActionScopeType
  spaceId?: string
  createdAt: number
  updatedAt: number
  provenance: 'user'
}

export interface ICustomActionsStoreData {
  version: 1
  actions: IUserCustomAction[]
  railByScope: Record<string, string[]>
}

export interface IMergedCatalogItem {
  id: string
  label: string
  kind: ActionKind
  fillValue?: string
  keys?: string[]
  description?: string
  category?: string
  pinned?: boolean
  order?: number
  mode?: 'agent' | 'shell' | 'both'
  provenance: ActionProvenance
  userAction?: IUserCustomAction
}

export const CUSTOM_ACTIONS_CHANGE_EVENT = 'herdr:custom-actions-changed'

export const getUtf8ByteLength = (str: string): number => {
  try {
    return new TextEncoder().encode(str).length
  } catch {
    return str.length
  }
}

export const notifyChange = (): void => {
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.dispatchEvent === 'function'
    ) {
      window.dispatchEvent(new CustomEvent(CUSTOM_ACTIONS_CHANGE_EVENT))
    }
  } catch {
    // ignore
  }
  try {
    if (
      typeof globalThis !== 'undefined' &&
      typeof (
        globalThis as unknown as { dispatchEvent?: (e: Event) => boolean }
      ).dispatchEvent === 'function'
    ) {
      ;(
        globalThis as unknown as { dispatchEvent: (e: Event) => boolean }
      ).dispatchEvent(new Event(CUSTOM_ACTIONS_CHANGE_EVENT))
    }
  } catch {
    // ignore
  }
}

const createDefaultStore = (): ICustomActionsStoreData => ({
  version: 1,
  actions: [],
  railByScope: {},
})

export const getStorageScopeKey = (
  scope: ActionScopeType,
  spaceId?: string | null,
): string => {
  if (scope === 'space' && spaceId && spaceId.trim().length > 0) {
    return `space:${spaceId.trim()}`
  }
  return 'global'
}

const validateActionItem = (raw: unknown): IUserCustomAction | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>

  if (
    typeof obj.id !== 'string' ||
    obj.id.trim().length === 0 ||
    obj.id.length > 64
  ) {
    return null
  }
  const id = obj.id.trim()

  if (
    typeof obj.label !== 'string' ||
    obj.label.trim().length === 0 ||
    obj.label.length > MAX_LABEL_LENGTH
  ) {
    return null
  }
  const label = obj.label.trim()

  if (obj.kind !== 'draft-fill' && obj.kind !== 'terminal-key') {
    return null
  }
  const kind = obj.kind as ActionKind

  let fillValue: string | undefined
  if (kind === 'draft-fill') {
    if (
      typeof obj.fillValue !== 'string' ||
      obj.fillValue.trim().length === 0 ||
      obj.fillValue.length > MAX_FILL_VALUE_LENGTH
    ) {
      return null
    }
    fillValue = obj.fillValue
  }

  let keys: string[] | undefined
  if (kind === 'terminal-key') {
    if (
      !Array.isArray(obj.keys) ||
      obj.keys.length === 0 ||
      obj.keys.length > MAX_KEYS_PER_ACTION
    ) {
      return null
    }
    const cleanKeys: string[] = []
    for (const k of obj.keys) {
      if (typeof k !== 'string') return null
      const lower = k.toLowerCase().trim()
      if (!CANONICAL_TERMINAL_KEYS_SET.has(lower)) {
        return null
      }
      cleanKeys.push(lower)
    }
    keys = cleanKeys
  }

  let category: string | undefined
  if (obj.category !== undefined && obj.category !== null) {
    if (
      typeof obj.category !== 'string' ||
      obj.category.length > MAX_CATEGORY_LENGTH
    ) {
      return null
    }
    const trimmed = obj.category.trim()
    if (trimmed.length > 0) category = trimmed
  }

  let description: string | undefined
  if (obj.description !== undefined && obj.description !== null) {
    if (
      typeof obj.description !== 'string' ||
      obj.description.length > MAX_DESCRIPTION_LENGTH
    ) {
      return null
    }
    const trimmed = obj.description.trim()
    if (trimmed.length > 0) description = trimmed
  }

  const pinned = typeof obj.pinned === 'boolean' ? obj.pinned : false
  const order =
    typeof obj.order === 'number' && Number.isFinite(obj.order) ? obj.order : 0

  const scope: ActionScopeType = obj.scope === 'space' ? 'space' : 'global'
  let spaceId: string | undefined
  if (
    scope === 'space' &&
    typeof obj.spaceId === 'string' &&
    obj.spaceId.trim().length > 0
  ) {
    spaceId = obj.spaceId.trim()
  }

  const createdAt =
    typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt)
      ? obj.createdAt
      : Date.now()
  const updatedAt =
    typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt)
      ? obj.updatedAt
      : createdAt

  return {
    id,
    label,
    kind,
    ...(fillValue !== undefined ? { fillValue } : {}),
    ...(keys !== undefined ? { keys } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(description !== undefined ? { description } : {}),
    pinned,
    order,
    scope,
    ...(spaceId !== undefined ? { spaceId } : {}),
    createdAt,
    updatedAt,
    provenance: 'user',
  }
}

export const getLocalStorage = (): Storage | null => {
  try {
    return window.localStorage ?? null
  } catch {
    // window is undeclared or window.localStorage access threw SecurityError
  }
  try {
    return (
      (globalThis as unknown as { localStorage?: Storage }).localStorage ?? null
    )
  } catch {
    // globalThis.localStorage threw
  }
  return null
}

export const getStorageIntegrityStatus = (): {
  corrupt: boolean
  oversized: boolean
  bytes: number
  raw?: string
} => {
  try {
    const storage = getLocalStorage()
    if (!storage) return { corrupt: false, oversized: false, bytes: 0 }
    const raw = storage.getItem(CUSTOM_ACTIONS_STORAGE_KEY)
    if (raw === null || raw === undefined || raw === '') {
      return { corrupt: false, oversized: false, bytes: 0 }
    }
    const bytes = getUtf8ByteLength(raw)
    if (bytes > MAX_STORAGE_BYTES) {
      return { corrupt: false, oversized: true, bytes, raw }
    }
    try {
      const parsed = JSON.parse(raw)
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        parsed.version !== 1
      ) {
        return { corrupt: true, oversized: false, bytes, raw }
      }
    } catch {
      return { corrupt: true, oversized: false, bytes, raw }
    }
    return { corrupt: false, oversized: false, bytes, raw }
  } catch {
    return { corrupt: false, oversized: false, bytes: 0 }
  }
}

/**
 * Loads and validates the custom actions store from browser localStorage.
 * Guaranteed safe: handles missing, corrupted, or schema-invalid data without throwing.
 */
export const loadStore = (): ICustomActionsStoreData => {
  try {
    const storage = getLocalStorage()
    if (!storage) {
      return createDefaultStore()
    }

    const raw = storage.getItem(CUSTOM_ACTIONS_STORAGE_KEY)
    if (!raw) return createDefaultStore()

    if (getUtf8ByteLength(raw) > MAX_STORAGE_BYTES) {
      // Storage content is oversized in UTF-8 bytes, return safe baseline
      return createDefaultStore()
    }

    const parsed = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      parsed.version !== 1
    ) {
      return createDefaultStore()
    }

    const actions: IUserCustomAction[] = []
    if (Array.isArray(parsed.actions)) {
      for (const item of parsed.actions) {
        const validated = validateActionItem(item)
        if (validated) {
          actions.push(validated)
        }
      }
    }

    const railByScope: Record<string, string[]> = {}
    if (
      parsed.railByScope &&
      typeof parsed.railByScope === 'object' &&
      !Array.isArray(parsed.railByScope)
    ) {
      for (const [scopeKey, rawKeys] of Object.entries(parsed.railByScope)) {
        if (Array.isArray(rawKeys)) {
          const validKeys: string[] = []
          for (const k of rawKeys) {
            if (
              typeof k === 'string' &&
              CANONICAL_TERMINAL_KEYS_SET.has(k.toLowerCase().trim())
            ) {
              validKeys.push(k.toLowerCase().trim())
            }
          }
          if (validKeys.length > 0) {
            railByScope[scopeKey] = validKeys
          }
        }
      }
    }

    return {
      version: 1,
      actions,
      railByScope,
    }
  } catch {
    return createDefaultStore()
  }
}

/**
 * Persists data to localStorage with strict byte bounds and safe quota handling.
 * Returns true on success, false if save was skipped or threw an error.
 */
export const saveStore = (data: ICustomActionsStoreData): boolean => {
  try {
    const storage = getLocalStorage()
    if (!storage) {
      return false
    }

    const serialized = JSON.stringify(data)
    if (getUtf8ByteLength(serialized) > MAX_STORAGE_BYTES) {
      return false
    }
    storage.setItem(CUSTOM_ACTIONS_STORAGE_KEY, serialized)
    notifyChange()
    return true
  } catch {
    return false
  }
}

/**
 * Returns user actions partitioned by scope for the currently viewed space.
 */
export const getActionsForScope = (
  workspaceId?: string | null,
): { global: IUserCustomAction[]; space: IUserCustomAction[] } => {
  const store = loadStore()
  const globalActions: IUserCustomAction[] = []
  const spaceActions: IUserCustomAction[] = []

  const trimmedWs = workspaceId?.trim()

  for (const action of store.actions) {
    if (action.scope === 'global') {
      globalActions.push(action)
    } else if (
      action.scope === 'space' &&
      trimmedWs &&
      action.spaceId === trimmedWs
    ) {
      spaceActions.push(action)
    }
  }

  return { global: globalActions, space: spaceActions }
}

/**
 * Creates or updates a user custom action in browser storage.
 */
export const saveCustomAction = (
  action: {
    id?: string
    label: string
    kind: ActionKind
    fillValue?: string
    keys?: string[]
    category?: string
    description?: string
    pinned?: boolean
    order?: number
    scope: ActionScopeType
    spaceId?: string
  },
  currentWorkspaceId?: string | null,
): { ok: boolean; action?: IUserCustomAction; error?: string } => {
  const integrity = getStorageIntegrityStatus()
  if (integrity.oversized) {
    return {
      ok: false,
      error:
        'Existing storage is oversized; refusing to overwrite existing data',
    }
  }
  if (integrity.corrupt) {
    return {
      ok: false,
      error: 'Existing storage is corrupt; refusing to overwrite existing data',
    }
  }

  const store = loadStore()

  const id =
    action.id?.trim() ||
    `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const targetScope = action.scope === 'space' ? 'space' : 'global'
  const spaceId =
    targetScope === 'space'
      ? action.spaceId?.trim() || currentWorkspaceId?.trim() || undefined
      : undefined

  if (targetScope === 'space' && !spaceId) {
    return { ok: false, error: 'Space scope requires an active Space ID' }
  }

  const scopeKey = getStorageScopeKey(targetScope, spaceId)
  const existingIndex = store.actions.findIndex((a) => a.id === id)

  // Enforce item limit per scope for new items
  if (existingIndex === -1) {
    const existingInScope = store.actions.filter(
      (a) => getStorageScopeKey(a.scope, a.spaceId) === scopeKey,
    )
    if (existingInScope.length >= MAX_ACTIONS_PER_SCOPE) {
      return {
        ok: false,
        error: `Maximum of ${MAX_ACTIONS_PER_SCOPE} actions reached for this scope`,
      }
    }
  }

  const validated = validateActionItem({
    ...action,
    id,
    scope: targetScope,
    spaceId,
    createdAt:
      existingIndex !== -1
        ? store.actions[existingIndex].createdAt
        : Date.now(),
    updatedAt: Date.now(),
  })

  if (!validated) {
    return { ok: false, error: 'Invalid action fields' }
  }

  if (existingIndex !== -1) {
    store.actions[existingIndex] = validated
  } else {
    store.actions.push(validated)
  }

  const saved = saveStore(store)
  if (!saved) {
    return { ok: false, error: 'Storage quota exceeded or storage unavailable' }
  }

  return { ok: true, action: validated }
}

/**
 * Deletes a user custom action by ID from browser storage.
 */
export const deleteCustomAction = (
  id: string,
): { ok: boolean; error?: string } => {
  const integrity = getStorageIntegrityStatus()
  if (integrity.oversized) {
    return {
      ok: false,
      error:
        'Existing storage is oversized; refusing to overwrite existing data',
    }
  }
  if (integrity.corrupt) {
    return {
      ok: false,
      error: 'Existing storage is corrupt; refusing to overwrite existing data',
    }
  }

  const store = loadStore()
  const initialLen = store.actions.length
  store.actions = store.actions.filter((a) => a.id !== id)

  if (store.actions.length === initialLen) {
    return { ok: false, error: 'Action not found' }
  }

  const saved = saveStore(store)
  if (!saved) {
    return { ok: false, error: 'Storage failed to persist deletion' }
  }
  return { ok: true }
}

/**
 * Returns active key rail keys for a workspace or global fallback.
 */
export const getRailKeys = (workspaceId?: string | null): string[] => {
  const store = loadStore()
  if (workspaceId && workspaceId.trim().length > 0) {
    const spaceKey = `space:${workspaceId.trim()}`
    if (store.railByScope[spaceKey] && store.railByScope[spaceKey].length > 0) {
      return store.railByScope[spaceKey]
    }
  }

  if (store.railByScope.global && store.railByScope.global.length > 0) {
    return store.railByScope.global
  }

  return [...DEFAULT_PRIMARY_KEYS]
}

/**
 * Updates rail key choices for a specific scope (global or current Space).
 */
export const setRailKeys = (
  keys: string[],
  workspaceId?: string | null,
  scope: ActionScopeType = 'global',
): { ok: boolean; error?: string } => {
  const integrity = getStorageIntegrityStatus()
  if (integrity.oversized) {
    return {
      ok: false,
      error:
        'Existing storage is oversized; refusing to overwrite existing data',
    }
  }
  if (integrity.corrupt) {
    return {
      ok: false,
      error: 'Existing storage is corrupt; refusing to overwrite existing data',
    }
  }

  const validKeys: string[] = []
  for (const k of keys) {
    const lower = k.toLowerCase().trim()
    if (CANONICAL_TERMINAL_KEYS_SET.has(lower) && !validKeys.includes(lower)) {
      validKeys.push(lower)
    }
  }

  if (validKeys.length === 0) {
    return { ok: false, error: 'Rail must contain at least one valid key' }
  }

  const store = loadStore()
  const scopeKey = getStorageScopeKey(scope, workspaceId)
  store.railByScope[scopeKey] = validKeys

  const saved = saveStore(store)
  if (!saved) {
    return { ok: false, error: 'Failed to persist rail configuration' }
  }
  return { ok: true }
}

/**
 * Resets rail keys for a scope to the default 6 keys.
 */
export const resetRailKeys = (
  workspaceId?: string | null,
  scope: ActionScopeType = 'global',
): { ok: boolean; error?: string } => {
  const integrity = getStorageIntegrityStatus()
  if (integrity.oversized) {
    return {
      ok: false,
      error:
        'Existing storage is oversized; refusing to overwrite existing data',
    }
  }
  if (integrity.corrupt) {
    return {
      ok: false,
      error: 'Existing storage is corrupt; refusing to overwrite existing data',
    }
  }

  const store = loadStore()
  const scopeKey = getStorageScopeKey(scope, workspaceId)
  delete store.railByScope[scopeKey]
  const saved = saveStore(store)
  if (!saved) {
    return { ok: false, error: 'Failed to reset rail configuration' }
  }
  return { ok: true }
}

/**
 * Merges repo catalog commands (read-only, provenance: 'repo-config')
 * with user custom actions (provenance: 'user').
 * Preserves repo commands strictly without overwriting.
 */
export const mergeCatalogWithUserActions = (
  repoItems: ICatalogItem[],
  userActions: IUserCustomAction[],
  mode: 'agent' | 'shell',
  searchQuery?: string,
): IMergedCatalogItem[] => {
  const merged: IMergedCatalogItem[] = []

  // 1. Repo catalog items always keep provenance 'repo-config'
  for (const item of repoItems) {
    if (item.mode && item.mode !== 'both' && item.mode !== mode) {
      continue
    }
    merged.push({
      id: item.id,
      label: item.label,
      kind: 'draft-fill',
      fillValue: item.fillValue,
      ...(item.description ? { description: item.description } : {}),
      ...(item.category ? { category: item.category } : {}),
      ...(item.mode ? { mode: item.mode } : {}),
      provenance: 'repo-config',
    })
  }

  // 2. User custom actions with provenance 'user'
  for (const u of userActions) {
    // Check if ID collides with existing repo item; if so namespace it so repo items are never overwritten
    const isCollision = merged.some((m) => m.id === u.id)
    const effectiveId = isCollision ? `user_${u.id}` : u.id

    merged.push({
      id: effectiveId,
      label: u.label,
      kind: u.kind,
      ...(u.fillValue !== undefined ? { fillValue: u.fillValue } : {}),
      ...(u.keys !== undefined ? { keys: u.keys } : {}),
      ...(u.category ? { category: u.category } : {}),
      ...(u.description ? { description: u.description } : {}),
      pinned: u.pinned,
      order: u.order,
      provenance: 'user',
      userAction: u,
    })
  }

  // 3. Search query filter
  const query = searchQuery?.trim().toLowerCase()
  let filtered = merged
  if (query) {
    filtered = merged.filter((item) => {
      const matchLabel = item.label.toLowerCase().includes(query)
      const matchDesc = item.description
        ? item.description.toLowerCase().includes(query)
        : false
      const matchCat = item.category
        ? item.category.toLowerCase().includes(query)
        : false
      const matchFill = item.fillValue
        ? item.fillValue.toLowerCase().includes(query)
        : false
      const matchKeys = item.keys
        ? item.keys.join(' ').toLowerCase().includes(query)
        : false
      return matchLabel || matchDesc || matchCat || matchFill || matchKeys
    })
  }

  // 4. Sort: pinned items first, then by category and order/label
  return filtered.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1
    }
    const catA = a.category || 'Commands'
    const catB = b.category || 'Commands'
    if (catA !== catB) {
      return catA.localeCompare(catB)
    }
    const orderA = a.order ?? 0
    const orderB = b.order ?? 0
    if (orderA !== orderB) {
      return orderA - orderB
    }
    return a.label.localeCompare(b.label)
  })
}
