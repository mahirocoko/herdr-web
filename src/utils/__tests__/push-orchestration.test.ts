import { describe, expect, test } from 'bun:test'
import { urlBase64ToUint8Array } from '../push-helpers.ts'
import {
  areApplicationServerKeysEqual,
  consumeWorkspaceDeepLink,
  deriveSpacePath,
  executeRemovalWorkflow,
  executeSubscribeRollback,
  isValidWorkspaceId,
  parsePushWorkspaceMessage,
  parseSpacePath
} from '../push-orchestration.ts'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('src/utils/push-orchestration', () => {
  describe('workspace deep links', () => {
    test('accepts bounded workspace IDs and rejects unsafe values', () => {
      expect(isValidWorkspaceId('ws-1')).toBe(true)
      expect(isValidWorkspaceId('space_main')).toBe(true)
      expect(isValidWorkspaceId('0')).toBe(true)
      expect(isValidWorkspaceId('')).toBe(false)
      expect(isValidWorkspaceId('   ')).toBe(false)
      expect(isValidWorkspaceId(null)).toBe(false)
      expect(isValidWorkspaceId('ws/with/slash')).toBe(false)
      expect(isValidWorkspaceId('ws?query=1')).toBe(false)
      expect(isValidWorkspaceId('a'.repeat(129))).toBe(false)
    })

    test('parses and derives valid /spaces/:workspaceId paths', () => {
      expect(parseSpacePath('/spaces/ws-123')).toBe('ws-123')
      expect(parseSpacePath('/spaces/space_main')).toBe('space_main')
      expect(parseSpacePath('/spaces/w5N')).toBe('w5N')
      expect(parseSpacePath('/spaces/')).toBeNull()
      expect(parseSpacePath('/spaces/ws/extra')).toBeNull()
      expect(parseSpacePath('/settings')).toBeNull()
      expect(parseSpacePath('/')).toBeNull()

      expect(deriveSpacePath('ws-123')).toBe('/spaces/ws-123')
      expect(deriveSpacePath('space_main')).toBe('/spaces/space_main')
      expect(deriveSpacePath(null)).toBe('/')
      expect(deriveSpacePath('')).toBe('/')
    })

    test('accepts only a bounded service-worker workspace message', () => {
      expect(parsePushWorkspaceMessage({
        type: 'herdr:open-workspace',
        workspaceId: 'w5N'
      })).toBe('w5N')
      expect(parsePushWorkspaceMessage({
        type: 'herdr:open-workspace',
        workspaceId: '../settings'
      })).toBeNull()
      expect(parsePushWorkspaceMessage({ type: 'other', workspaceId: 'w5N' })).toBeNull()
      expect(parsePushWorkspaceMessage('w5N')).toBeNull()
    })

    test('selects a known workspace and ignores an unknown workspace', () => {
      let selected: string | null = null
      const matched = consumeWorkspaceDeepLink({
        targetWorkspaceId: 'ws-prod',
        workspaces: [{ workspace_id: 'ws-dev' }, { workspace_id: 'ws-prod' }],
        onSelectWorkspace: (id) => { selected = id }
      })
      expect(matched).toEqual({ matched: true })
      expect(selected as string | null).toBe('ws-prod')

      selected = null
      const missing = consumeWorkspaceDeepLink({
        targetWorkspaceId: 'unknown',
        workspaces: [{ workspace_id: 'ws-prod' }],
        onSelectWorkspace: (id) => { selected = id }
      })
      expect(missing).toEqual({ matched: false })
      expect(selected).toBeNull()
    })
  })

  test('compares an exposed subscription application-server key', () => {
    const keyA = 'BK12345678901234567890123456789012345678901234567890123456789012345678901234567890123456'
    const keyB = 'CK99999999999999999999999999999999999999999999999999999999999999999999999999999999999999'
    const bytes = urlBase64ToUint8Array(keyA)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    expect(areApplicationServerKeysEqual(buffer, keyA)).toBe(true)
    expect(areApplicationServerKeysEqual(buffer, keyB)).toBe(false)
    expect(areApplicationServerKeysEqual(null, keyA)).toBe(true)
  })

  describe('late browser removal reconciliation', () => {
    type TestSub = { endpoint: string; unsubscribe: () => Promise<boolean> }

    test('publishes local absence before deferred backend cleanup completes', async () => {
      const unsubscribe = deferred<boolean>()
      const backendDelete = deferred<unknown>()
      const publications: string[] = []
      const captured: TestSub = {
        endpoint: 'https://push.example.com/sub/captured',
        unsubscribe: () => unsubscribe.promise
      }
      const resultPromise = executeRemovalWorkflow({
        capturedSub: captured,
        getSubscription: async () => captured,
        deleteBackendSubscription: async () => backendDelete.promise,
        onLocalSubscription: (sub) => publications.push(sub ? sub.endpoint : 'absent')
      })

      unsubscribe.resolve(true)
      await Promise.resolve()
      await Promise.resolve()
      expect(publications).toEqual(['absent'])

      backendDelete.resolve(undefined)
      expect(await resultPromise).toMatchObject({ status: 'absent' })
    })

    for (const outcome of ['false', 'reject'] as const) {
      const settle = (pending: ReturnType<typeof deferred<boolean>>) => {
        if (outcome === 'false') pending.resolve(false)
        else pending.reject(new Error('browser detail'))
      }

      test(`${outcome} settlement with the same authoritative subscription retains it`, async () => {
        const pending = deferred<boolean>()
        const captured: TestSub = {
          endpoint: 'https://push.example.com/sub/same',
          unsubscribe: () => pending.promise
        }
        const resultPromise = executeRemovalWorkflow({
          capturedSub: captured,
          getSubscription: async () => captured,
          deleteBackendSubscription: async () => undefined
        })
        settle(pending)
        expect(await resultPromise).toMatchObject({ status: 'retained', subscription: captured })
      })

      test(`${outcome} settlement with authoritative absence cleans the captured endpoint`, async () => {
        const pending = deferred<boolean>()
        const deleted: string[] = []
        const captured: TestSub = {
          endpoint: 'https://push.example.com/sub/gone',
          unsubscribe: () => pending.promise
        }
        const resultPromise = executeRemovalWorkflow({
          capturedSub: captured,
          getSubscription: async () => null,
          deleteBackendSubscription: async (endpoint) => { deleted.push(endpoint) }
        })
        settle(pending)
        expect(await resultPromise).toMatchObject({ status: 'absent' })
        expect(deleted).toEqual([captured.endpoint])
      })

      test(`${outcome} settlement adopts a different subscription and cleans only the captured endpoint`, async () => {
        const pending = deferred<boolean>()
        const deleted: string[] = []
        const captured: TestSub = {
          endpoint: 'https://push.example.com/sub/old',
          unsubscribe: () => pending.promise
        }
        const replacement: TestSub = {
          endpoint: 'https://push.example.com/sub/new',
          unsubscribe: async () => true
        }
        const resultPromise = executeRemovalWorkflow({
          capturedSub: captured,
          getSubscription: async () => replacement,
          deleteBackendSubscription: async (endpoint) => { deleted.push(endpoint) }
        })
        settle(pending)
        expect(await resultPromise).toMatchObject({ status: 'adopted', subscription: replacement })
        expect(deleted).toEqual([captured.endpoint])
      })
    }

    test('keeps uncertainty explicit when authoritative inspection also fails', async () => {
      const captured: TestSub = {
        endpoint: 'https://push.example.com/sub/unknown',
        unsubscribe: async () => false
      }
      const result = await executeRemovalWorkflow({
        capturedSub: captured,
        getSubscription: async () => { throw new Error('inspection unavailable') },
        deleteBackendSubscription: async () => undefined
      })
      expect(result).toMatchObject({ status: 'uncertain', subscription: captured })
    })

    test('returns a bounded warning when confirmed removal cleanup fails', async () => {
      const captured: TestSub = {
        endpoint: 'https://push.example.com/sub/cleanup',
        unsubscribe: async () => true
      }
      const result = await executeRemovalWorkflow({
        capturedSub: captured,
        getSubscription: async () => null,
        deleteBackendSubscription: async () => { throw new Error('secret endpoint detail') }
      })
      expect(result).toEqual({
        status: 'absent',
        subscription: null,
        cleanupWarning: 'Backend cleanup remains pending after local removal'
      })
    })
  })

  describe('enable rollback', () => {
    test('confirmed browser removal clears the retained subscription', async () => {
      const created = {
        endpoint: 'https://push.example.com/sub/rollback-ok',
        unsubscribe: async () => true
      }
      const result = await executeSubscribeRollback(created)
      expect(result).toMatchObject({ rolledBack: true, retainedSub: null })
    })

    test('failed browser removal retains the authoritative subscription', async () => {
      const created = {
        endpoint: 'https://push.example.com/sub/rollback-fail',
        unsubscribe: async () => false
      }
      const result = await executeSubscribeRollback(created, {
        getSubscription: async () => created
      })
      expect(result).toMatchObject({ rolledBack: false, retainedSub: created })
    })
  })
})
