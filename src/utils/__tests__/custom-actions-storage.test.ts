import { beforeEach, describe, expect, test } from 'bun:test'
import {
  CUSTOM_ACTIONS_STORAGE_KEY,
  deleteCustomAction,
  getActionsForScope,
  getLocalStorage,
  getRailKeys,
  getStorageIntegrityStatus,
  getUtf8ByteLength,
  loadStore,
  MAX_STORAGE_BYTES,
  mergeCatalogWithUserActions,
  resetRailKeys,
  saveCustomAction,
  saveStore,
  setRailKeys,
  type ICustomActionsStoreData,
  type IUserCustomAction,
} from '../custom-actions-storage.ts'
import { DEFAULT_PRIMARY_KEYS } from '../terminal-keys.ts'
import type { IInteractionCatalog } from '@/types/herdr.ts'

// In-memory mock for localStorage
class LocalStorageMock {
  private store: Record<string, string> = {}

  getItem(key: string): string | null {
    return this.store[key] ?? null
  }

  setItem(key: string, value: string): void {
    this.store[key] = value
  }

  removeItem(key: string): void {
    delete this.store[key]
  }

  clear(): void {
    this.store = {}
  }
}

describe('custom-actions-storage: lifecycle, corruption recovery, byte bounds, and provenance', () => {
  beforeEach(() => {
    const mock = new LocalStorageMock()
    Object.defineProperty(globalThis, 'localStorage', {
      value: mock as unknown as Storage,
      writable: true,
      configurable: true,
    })
  })

  test('loadStore returns default store when localStorage is empty', () => {
    const store = loadStore()
    expect(store.version).toBe(1)
    expect(store.actions).toEqual([])
    expect(store.railByScope).toEqual({})
    expect(getRailKeys(null)).toEqual([...DEFAULT_PRIMARY_KEYS])
  })

  test('loadStore recovers safely from malformed JSON without crashing', () => {
    localStorage.setItem(CUSTOM_ACTIONS_STORAGE_KEY, 'not-json-at-all{{invalid')
    const store = loadStore()
    expect(store.version).toBe(1)
    expect(store.actions).toEqual([])
  })

  test('loadStore recovers safely from corrupted schema without crashing', () => {
    localStorage.setItem(
      CUSTOM_ACTIONS_STORAGE_KEY,
      JSON.stringify({ version: 99, badField: true }),
    )
    const store = loadStore()
    expect(store.version).toBe(1)
    expect(store.actions).toEqual([])
  })

  test('CRUD lifecycle: create, read, update, delete custom actions', () => {
    // 1. Create a draft-fill action
    const createRes = saveCustomAction({
      label: 'Deploy Staging',
      kind: 'draft-fill',
      fillValue: 'npm run deploy:staging',
      scope: 'global',
      category: 'Deployment',
      pinned: true,
    })
    expect(createRes.ok).toBe(true)
    expect(createRes.action).toBeDefined()
    const actionId = createRes.action!.id
    expect(actionId).toBeTruthy()
    expect(createRes.action!.provenance).toBe('user')

    // 2. Read actions
    const scoped = getActionsForScope(null)
    expect(scoped.global.length).toBe(1)
    expect(scoped.global[0].label).toBe('Deploy Staging')
    expect(scoped.global[0].pinned).toBe(true)

    // 3. Update action
    const updateRes = saveCustomAction({
      id: actionId,
      label: 'Deploy Production',
      kind: 'draft-fill',
      fillValue: 'npm run deploy:prod',
      scope: 'global',
      category: 'Deployment',
      pinned: false,
    })
    expect(updateRes.ok).toBe(true)
    expect(updateRes.action!.label).toBe('Deploy Production')
    expect(updateRes.action!.id).toBe(actionId)

    // Read again to verify update
    const updatedScoped = getActionsForScope(null)
    expect(updatedScoped.global[0].label).toBe('Deploy Production')
    expect(updatedScoped.global[0].pinned).toBe(false)

    // 4. Delete action
    const deleteRes = deleteCustomAction(actionId)
    expect(deleteRes.ok).toBe(true)
    const afterDelete = getActionsForScope(null)
    expect(afterDelete.global.length).toBe(0)
  })

  test('CRUD lifecycle for terminal-key actions with canonical keys validation', () => {
    const res = saveCustomAction({
      label: 'Send Sigint and Clear',
      kind: 'terminal-key',
      keys: ['ctrl+c', 'ctrl+l'],
      scope: 'global',
    })
    expect(res.ok).toBe(true)
    expect(res.action!.kind).toBe('terminal-key')
    expect(res.action!.keys).toEqual(['ctrl+c', 'ctrl+l'])

    // Rejects unsupported key 'delete'
    const invalidRes = saveCustomAction({
      label: 'Try Delete Key',
      kind: 'terminal-key',
      keys: ['delete'],
      scope: 'global',
    })
    expect(invalidRes.ok).toBe(false)
    expect(invalidRes.error).toBeDefined()
  })

  test('validates required fields and lengths', () => {
    const emptyLabel = saveCustomAction({
      label: '   ',
      kind: 'draft-fill',
      fillValue: 'echo hello',
      scope: 'global',
    })
    expect(emptyLabel.ok).toBe(false)

    const emptyDraft = saveCustomAction({
      label: 'No draft text',
      kind: 'draft-fill',
      fillValue: '   ',
      scope: 'global',
    })
    expect(emptyDraft.ok).toBe(false)

    const emptyKeys = saveCustomAction({
      label: 'No keys',
      kind: 'terminal-key',
      keys: [],
      scope: 'global',
    })
    expect(emptyKeys.ok).toBe(false)
  })

  test('scope partitioning: global vs space-scoped actions', () => {
    saveCustomAction({
      label: 'Global Tool',
      kind: 'draft-fill',
      fillValue: 'tool global',
      scope: 'global',
    })
    saveCustomAction({
      label: 'Space Tool A',
      kind: 'draft-fill',
      fillValue: 'tool space A',
      scope: 'space',
      spaceId: 'sp-alpha',
    })
    saveCustomAction({
      label: 'Space Tool B',
      kind: 'draft-fill',
      fillValue: 'tool space B',
      scope: 'space',
      spaceId: 'sp-beta',
    })

    // Query for sp-alpha
    const alphaActions = getActionsForScope('sp-alpha')
    expect(alphaActions.global.length).toBe(1)
    expect(alphaActions.global[0].label).toBe('Global Tool')
    expect(alphaActions.space.length).toBe(1)
    expect(alphaActions.space[0].label).toBe('Space Tool A')

    // Query for sp-beta
    const betaActions = getActionsForScope('sp-beta')
    expect(betaActions.global.length).toBe(1)
    expect(betaActions.space.length).toBe(1)
    expect(betaActions.space[0].label).toBe('Space Tool B')

    // Query with no workspace
    const noSpaceActions = getActionsForScope(null)
    expect(noSpaceActions.global.length).toBe(1)
    expect(noSpaceActions.space.length).toBe(0)
  })

  test('getUtf8ByteLength correctly counts UTF-8 bytes for ASCII and multibyte Thai text', () => {
    expect(getUtf8ByteLength('hello')).toBe(5)
    // Thai character ก is 3 bytes (0xE0, 0xB8, 0x81)
    expect(getUtf8ByteLength('ก')).toBe(3)
    // 'สวัสดี' has 6 characters, but 18 UTF-8 bytes
    expect(getUtf8ByteLength('สวัสดี')).toBe(18)
    // Mixed text
    expect(getUtf8ByteLength('คำสั่ง test')).toBe(18 + 5) // 23 bytes
  })

  test('exact Thai boundary at MAX_STORAGE_BYTES: saves immediately below, rejects immediately above without overwriting', () => {
    // 1. Establish an initial valid store
    const initialAction = {
      label: 'Initial Safe Action',
      kind: 'draft-fill' as const,
      fillValue: 'initial',
      scope: 'global' as const,
    }
    const saveInit = saveCustomAction(initialAction)
    expect(saveInit.ok).toBe(true)
    const initialRaw = localStorage.getItem(CUSTOM_ACTIONS_STORAGE_KEY)
    expect(initialRaw).toBeTruthy()

    // 2. Build a store that fits right below MAX_STORAGE_BYTES (32768)
    const validActions = Array.from({ length: 11 }, (_, i) => ({
      id: `usr_${i}`,
      label: `Action ${i}`,
      kind: 'draft-fill' as const,
      fillValue: 'สวัสดี'.repeat(150),
      scope: 'global' as const,
      pinned: false,
      order: i,
      createdAt: 1000 + i,
      updatedAt: 1000 + i,
      provenance: 'user' as const,
    }))
    const baseStore: ICustomActionsStoreData = {
      version: 1,
      actions: validActions,
      railByScope: {},
    }
    const baseBytes = getUtf8ByteLength(JSON.stringify(baseStore))
    expect(baseBytes).toBeLessThanOrEqual(MAX_STORAGE_BYTES)

    // Saving at <= MAX_STORAGE_BYTES succeeds
    expect(saveStore(baseStore)).toBe(true)

    // 3. Immediately above boundary: adding 1 more large valid action pushes total store past 32768
    const oversizedStore: ICustomActionsStoreData = {
      version: 1,
      actions: [
        ...validActions,
        {
          id: 'usr_extra',
          label: 'Action Extra',
          kind: 'draft-fill',
          fillValue: 'สวัสดี'.repeat(150),
          scope: 'global',
          pinned: false,
          order: 99,
          createdAt: 2000,
          updatedAt: 2000,
          provenance: 'user',
        },
      ],
      railByScope: {},
    }
    const overBoundaryBytes = getUtf8ByteLength(JSON.stringify(oversizedStore))
    expect(overBoundaryBytes).toBeGreaterThan(MAX_STORAGE_BYTES)

    // saveStore must return false
    expect(saveStore(oversizedStore)).toBe(false)

    // 4. Test saveCustomAction with Thai text: when new action pushes store over 32768 bytes,
    // it rejects with quota error AND the old stored data is NOT overwritten
    const storeBeforeOversized = localStorage.getItem(
      CUSTOM_ACTIONS_STORAGE_KEY,
    )
    const oversizedThaiRes = saveCustomAction({
      label: 'ล้นโควต้า',
      kind: 'draft-fill',
      fillValue: 'สวัสดี'.repeat(150),
      scope: 'global',
    })
    expect(oversizedThaiRes.ok).toBe(false)
    expect(oversizedThaiRes.error).toContain('Storage quota exceeded')
    // Verifies old value in localStorage was NOT overwritten
    expect(localStorage.getItem(CUSTOM_ACTIONS_STORAGE_KEY)).toBe(
      storeBeforeOversized,
    )
  })

  test('rejects corrupt storage on save/delete/rail mutations without silently overwriting the old value', () => {
    const corruptPayload =
      '{"version": 999, "corrupted": "bad_data_do_not_overwrite"}'
    localStorage.setItem(CUSTOM_ACTIONS_STORAGE_KEY, corruptPayload)

    // saveCustomAction must fail and protect existing corrupt data
    const saveRes = saveCustomAction({
      label: 'Should Not Save',
      kind: 'draft-fill',
      fillValue: 'text',
      scope: 'global',
    })
    expect(saveRes.ok).toBe(false)
    expect(saveRes.error).toContain('corrupt')
    expect(localStorage.getItem(CUSTOM_ACTIONS_STORAGE_KEY)).toBe(
      corruptPayload,
    )

    // setRailKeys must fail and protect existing corrupt data
    const railRes = setRailKeys(['esc', 'tab'], null, 'global')
    expect(railRes.ok).toBe(false)
    expect(railRes.error).toContain('corrupt')
    expect(localStorage.getItem(CUSTOM_ACTIONS_STORAGE_KEY)).toBe(
      corruptPayload,
    )

    // resetRailKeys must fail and protect existing corrupt data
    const resetRes = resetRailKeys(null, 'global')
    expect(resetRes.ok).toBe(false)
    expect(resetRes.error).toContain('corrupt')
    expect(localStorage.getItem(CUSTOM_ACTIONS_STORAGE_KEY)).toBe(
      corruptPayload,
    )

    // deleteCustomAction must fail and protect existing corrupt data
    const deleteRes = deleteCustomAction('any_id')
    expect(deleteRes.ok).toBe(false)
    expect(deleteRes.error).toContain('corrupt')
    expect(localStorage.getItem(CUSTOM_ACTIONS_STORAGE_KEY)).toBe(
      corruptPayload,
    )
  })

  test('rejects oversized storage on mutations without silently overwriting the old value', () => {
    const oversizedPayload = 'x'.repeat(MAX_STORAGE_BYTES + 50)
    localStorage.setItem(CUSTOM_ACTIONS_STORAGE_KEY, oversizedPayload)

    // saveCustomAction must fail
    const saveRes = saveCustomAction({
      label: 'Will Reject',
      kind: 'draft-fill',
      fillValue: 'data',
      scope: 'global',
    })
    expect(saveRes.ok).toBe(false)
    expect(saveRes.error).toContain('oversized')
    expect(localStorage.getItem(CUSTOM_ACTIONS_STORAGE_KEY)).toBe(
      oversizedPayload,
    )

    // setRailKeys must fail
    const railRes = setRailKeys(['esc'], null, 'global')
    expect(railRes.ok).toBe(false)
    expect(railRes.error).toContain('oversized')
    expect(localStorage.getItem(CUSTOM_ACTIONS_STORAGE_KEY)).toBe(
      oversizedPayload,
    )
  })

  test('handles window.localStorage property access throwing SecurityError inside try/catch without outside guard', () => {
    const originalWindow = globalThis.window
    const originalLocalStorage = globalThis.localStorage

    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
      writable: true,
    })
    Object.defineProperty(globalThis.window, 'localStorage', {
      get() {
        throw new Error('SecurityError: The operation is insecure')
      },
      configurable: true,
    })
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('SecurityError: The operation is insecure')
      },
      configurable: true,
    })

    // getLocalStorage must safely return null inside try/catch without throwing
    expect(getLocalStorage()).toBeNull()

    // loadStore must return safe default store
    const store = loadStore()
    expect(store.version).toBe(1)
    expect(store.actions).toEqual([])

    // saveStore must return false
    expect(saveStore(store)).toBe(false)

    // getStorageIntegrityStatus must return unavailable
    const status = getStorageIntegrityStatus()
    expect(status.corrupt).toBe(false)
    expect(status.oversized).toBe(false)

    // Restore
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(globalThis, 'localStorage', {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    })
  })

  test('enforces MAX_STORAGE_BYTES limit and protects existing store', () => {
    // Pre-populate with one valid action
    saveCustomAction({
      label: 'Existing Action',
      kind: 'draft-fill',
      fillValue: 'safe',
      scope: 'global',
    })

    // 1. Direct saveStore check: oversized store exceeding MAX_STORAGE_BYTES (32 KiB) returns false
    const hugeAction: IUserCustomAction = {
      id: 'usr_test_huge',
      label: 'Huge Action',
      kind: 'draft-fill',
      fillValue: 'x'.repeat(900),
      scope: 'global',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      provenance: 'user',
    }
    const oversizedStore = {
      version: 1 as const,
      actions: Array.from({ length: 40 }, (_, i) => ({
        ...hugeAction,
        id: `usr_${i}`,
      })),
      railByScope: {},
    }
    expect(saveStore(oversizedStore)).toBe(false)

    // 2. Storage exception check: when localStorage.setItem throws, saveCustomAction fails safely
    const originalSetItem = localStorage.setItem
    localStorage.setItem = () => {
      throw new Error('QuotaExceededError: storage is full')
    }
    const overflowRes = saveCustomAction({
      label: 'Will Fail Due To Quota',
      kind: 'draft-fill',
      fillValue: 'fails',
      scope: 'global',
    })
    expect(overflowRes.ok).toBe(false)
    expect(overflowRes.error).toContain('Storage quota exceeded')
    localStorage.setItem = originalSetItem
  })

  test('rail keys configuration: getRailKeys, setRailKeys, and resetRailKeys', () => {
    // Initial global rail keys
    expect(getRailKeys(null)).toEqual([...DEFAULT_PRIMARY_KEYS])

    // Set custom keys globally
    const customGlobal = ['esc', 'tab', 'shift+tab', 'space']
    const setRes = setRailKeys(customGlobal, null, 'global')
    expect(setRes.ok).toBe(true)
    expect(getRailKeys(null)).toEqual(customGlobal)

    // Set custom keys for a specific space
    const customSpace = ['ctrl+c', 'ctrl+l', 'backspace']
    setRailKeys(customSpace, 'sp-omega', 'space')
    expect(getRailKeys('sp-omega')).toEqual(customSpace)
    // Non-configured space falls back to global
    expect(getRailKeys('sp-other')).toEqual(customGlobal)

    // Reset space rail keys falls back to global
    resetRailKeys('sp-omega', 'space')
    expect(getRailKeys('sp-omega')).toEqual(customGlobal)

    // Reset global rail keys reverts to DEFAULT_PRIMARY_KEYS
    resetRailKeys(null, 'global')
    expect(getRailKeys(null)).toEqual([...DEFAULT_PRIMARY_KEYS])
  })

  test('mergeCatalogWithUserActions preserves repo config read-only with explicit provenance', () => {
    const catalog: IInteractionCatalog = {
      version: 1,
      source: 'repo-config',
      items: [
        {
          id: 'cmd-test',
          label: 'Run Tests',
          description: 'Run unit test suite',
          fillValue: 'bun test',
          mode: 'shell',
          category: 'Testing',
        },
      ],
    }

    const userActions: IUserCustomAction[] = [
      {
        id: 'usr-1',
        label: 'Run Tests', // Same label as repo command
        kind: 'draft-fill',
        fillValue: 'bun test:coverage',
        category: 'Testing',
        scope: 'global',
        createdAt: 100,
        updatedAt: 200,
        provenance: 'user',
      },
      {
        id: 'usr-2',
        label: 'Clear Screen',
        kind: 'terminal-key',
        keys: ['ctrl+l'],
        scope: 'global',
        createdAt: 100,
        updatedAt: 200,
        provenance: 'user',
      },
    ]

    const merged = mergeCatalogWithUserActions(
      catalog.items,
      userActions,
      'shell',
    )
    expect(merged.length).toBe(3)

    // Repo config item is preserved with repo-config provenance
    const repoItem = merged.find((item) => item.id === 'cmd-test')
    expect(repoItem).toBeDefined()
    expect(repoItem!.provenance).toBe('repo-config')
    expect(repoItem!.label).toBe('Run Tests')
    expect(repoItem!.fillValue).toBe('bun test')

    // User action with same label is NOT overwritten; preserved as distinct user action
    const userItem = merged.find((item) => item.id === 'usr-1')
    expect(userItem).toBeDefined()
    expect(userItem!.provenance).toBe('user')
    expect(userItem!.label).toBe('Run Tests')
    expect(userItem!.fillValue).toBe('bun test:coverage')

    // Key action is preserved
    const keyItem = merged.find((item) => item.id === 'usr-2')
    expect(keyItem).toBeDefined()
    expect(keyItem!.kind).toBe('terminal-key')
    expect(keyItem!.keys).toEqual(['ctrl+l'])
  })
})
