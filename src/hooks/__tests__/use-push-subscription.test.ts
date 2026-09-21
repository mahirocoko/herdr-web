import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { beginPushSubscribe } from '../../utils/push-orchestration.ts'

describe('use-push-subscription operation-ticket contract', () => {
  const hookPath = path.resolve(import.meta.dir, '../use-push-subscription.ts')
  const content = fs.readFileSync(hookPath, 'utf8')

  test('hook delegates enable to the shared production operation', () => {
    expect(content).toContain('const enablePush = createPushEnableOperation({')
    expect(content).toContain('return enablePush(attach)')
    expect(content).not.toContain('beginPushSubscribe(')
  })

  test('Re-check delegates only to inspection, whose browser-call count is tested at runtime', () => {
    const start = content.indexOf('const refresh = useCallback(')
    const body = content.slice(start, content.indexOf('}, [attach])', start))
    expect(body).toContain('pushRuntime.admitInspection()')
    expect(body).toContain('return runInitialInspection(admission.ticket)')
    expect(body).not.toContain('enablePush(')
    expect(body).not.toContain('beginPushSubscribe(')
  })

  test('beginPushSubscribe behavior invokes the browser mutation exactly once synchronously', () => {
    let calls = 0
    const expected = Promise.resolve({ endpoint: 'https://push.example/sub' } as PushSubscription)
    const registration = {
      pushManager: {
        subscribe: () => {
          calls++
          return expected
        }
      }
    } as unknown as ServiceWorkerRegistration

    const actual = beginPushSubscribe(registration, 'AQAB')
    expect(calls).toBe(1)
    expect(actual).toBe(expected)
  })

  test('initial inspection checks ownership after late awaits and upgrades before mutation', () => {
    expect(content).toContain('if (!pushRuntime.isOwner(ticket)) return')
    expect(content).toContain("updateViaCache: 'none'")
    expect(content).toContain('await registered.update()')
    expect(content).toContain('await waitForServiceWorkerActivation(registered)')
    expect(content).toContain('await readServiceWorkerVersion(activeWorker)')
    expect(content).toContain('workerVersion !== EXPECTED_SERVICE_WORKER_VERSION')
    expect(content).toContain("pushRuntime.upgradeToExclusive(ticket, 'rotation')")
    expect(content).toContain("pushRuntime.upgradeToExclusive(ticket, 'sync-cleanup')")
  })

  test('mount generation gates React publication while operation settlement remains module-owned', () => {
    expect(content).toContain('viewGenerationRef.current === generation')
    expect(content).toContain('return enablePush(attach)')
    expect(content).not.toContain('withTimeout(')
  })

  test('rollback cleanup deletes the captured endpoint after confirmed browser removal', () => {
    const enable = fs.readFileSync(path.resolve(import.meta.dir, '../../utils/push-enable-operation.ts'), 'utf8')
    expect(enable).toContain('executeSubscribeRollback(subscription, {')
    expect(content).toContain('deleteBackendSubscription: deletePushSubscription')
  })

  test('exposes pending-operation truth and Settings offers only reload while pending', () => {
    const settings = fs.readFileSync(path.resolve(import.meta.dir, '../../components/settings-view.tsx'), 'utf8')
    expect(content).toContain('isOperationPending: boolean')
    expect(content).toContain('isOperationPending: snapshot.isOperationPending')
    expect(settings).toContain('{isOperationPending ? (')
    expect(settings).toContain('window.location.reload()')
    expect(settings).toContain('Its result may arrive later; reload to inspect the current state.')
  })

  test('app acknowledges a validated service-worker workspace message', () => {
    const root = fs.readFileSync(path.resolve(import.meta.dir, '../../../app/root.tsx'), 'utf8')
    expect(root).toContain('parsePushWorkspaceMessage(event.data)')
    expect(root).toContain("type: 'herdr:workspace-opened'")
    expect(root).toContain('deriveSpacePath(workspaceId)')
    expect(root).toContain('evaluatePendingWorkspaceAck')
    expect(root).toContain("decision.action === 'ack'")
    expect(root.indexOf("decision.action === 'ack'")).toBeLessThan(
      root.indexOf("type: 'herdr:workspace-opened'")
    )
  })
})
