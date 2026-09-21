import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {
  deriveSpacePath,
  evaluatePendingWorkspaceAck,
  isValidWorkspaceId,
  parsePushWorkspaceMessage,
  parseSpacePath,
  consumeWorkspaceDeepLink
} from '@/utils/push-orchestration.ts'
import { resolveAuthoritativeWorkspaceId } from '../../app/routes/_index.tsx'
import { resolveSpaceRouteParam } from '../../app/routes/spaces.$workspaceId.tsx'
import {
  createDonePayload,
  createNeedsInputPayload
} from '../../server/push/sender.ts'
import type { IPane, ISnapshotResult, ITab, IWorkspace } from '@/types/herdr.ts'

describe('Router & Push Deep Link Contracts', () => {
  describe('1. Route / path parsing & derivation', () => {
    test('parses valid /spaces/:workspaceId paths and rejects invalid/nested/query formats', () => {
      expect(parseSpacePath('/spaces/ws-main')).toBe('ws-main')
      expect(parseSpacePath('/spaces/space_123')).toBe('space_123')
      expect(parseSpacePath('/spaces/alpha-beta-gamma')).toBe('alpha-beta-gamma')

      // Rejects missing ID
      expect(parseSpacePath('/spaces/')).toBeNull()
      expect(parseSpacePath('/spaces')).toBeNull()

      // Rejects nested paths (preserves single-segment space ID scope)
      expect(parseSpacePath('/spaces/ws/nested')).toBeNull()

      // Rejects non-space routes
      expect(parseSpacePath('/')).toBeNull()
      expect(parseSpacePath('/settings')).toBeNull()
      expect(parseSpacePath('/api/snapshot')).toBeNull()

      // Rejects unsafe workspace IDs with special characters
      expect(parseSpacePath('/spaces/ws%20with%20space')).toBeNull()
      expect(parseSpacePath('/spaces/../escape')).toBeNull()
    })

    test('derives canonical /spaces/:workspaceId paths safely and falls back to root', () => {
      expect(deriveSpacePath('ws-main')).toBe('/spaces/ws-main')
      expect(deriveSpacePath('space_prod')).toBe('/spaces/space_prod')
      expect(deriveSpacePath(null)).toBe('/')
      expect(deriveSpacePath('')).toBe('/')
      expect(deriveSpacePath('   ')).toBe('/')
      expect(deriveSpacePath('invalid/space')).toBe('/')
    })

    test('validates workspace IDs against security constraints', () => {
      expect(isValidWorkspaceId('ws-123')).toBe(true)
      expect(isValidWorkspaceId('space_prod-1')).toBe(true)
      expect(isValidWorkspaceId('')).toBe(false)
      expect(isValidWorkspaceId('   ')).toBe(false)
      expect(isValidWorkspaceId('bad/path')).toBe(false)
      expect(isValidWorkspaceId('../traversal')).toBe(false)
      expect(isValidWorkspaceId('space with spaces')).toBe(false)
    })
  })

  describe('2. Root resolution contract', () => {
    const mockWorkspace = (id: string, overrides: Partial<IWorkspace> = {}): IWorkspace => ({
      workspace_id: id,
      label: id,
      number: 1,
      agent_status: 'idle',
      tab_count: 1,
      pane_count: 1,
      focused: false,
      ...overrides
    })

    const mockTab = (id: string, wsId: string, overrides: Partial<ITab> = {}): ITab => ({
      tab_id: id,
      workspace_id: wsId,
      label: id,
      number: 1,
      pane_count: 1,
      focused: false,
      agent_status: 'idle',
      ...overrides
    })

    const mockPane = (id: string, wsId: string, tabId: string, overrides: Partial<IPane> = {}): IPane => ({
      pane_id: id,
      workspace_id: wsId,
      tab_id: tabId,
      agent_status: 'idle',
      cwd: '/',
      focused: false,
      ...overrides
    })

    const mockSnapshot = (overrides: Partial<ISnapshotResult> = {}): ISnapshotResult => ({
      protocol: 22,
      version: '0.9.1',
      focused_pane_id: 'p1',
      workspaces: [
        mockWorkspace('ws-1', { label: 'Alpha Space' }),
        mockWorkspace('ws-2', { label: 'Beta Space' })
      ],
      tabs: [
        mockTab('t1', 'ws-1', { number: 1, label: 'Tab 1', agent_status: 'idle' })
      ],
      panes: [
        mockPane('p1', 'ws-1', 't1', {
          agent_status: 'idle',
          cwd: '/home',
          focused: true
        })
      ],
      ...overrides
    })

    test('prefers an existing valid selection if present in snapshot', () => {
      const snap = mockSnapshot()
      expect(resolveAuthoritativeWorkspaceId(snap, 'ws-2')).toBe('ws-2')
    })

    test('resolves to focused pane workspace when no valid prior selection', () => {
      const snap = mockSnapshot({
        focused_pane_id: 'p2',
        panes: [
          mockPane('p1', 'ws-1', 't1', { agent_status: 'idle', cwd: '/' }),
          mockPane('p2', 'ws-2', 't2', { agent_status: 'idle', cwd: '/', focused: true })
        ]
      })
      expect(resolveAuthoritativeWorkspaceId(snap, null)).toBe('ws-2')
    })

    test('resolves to blocked pane workspace when no focused pane', () => {
      const snap = mockSnapshot({
        focused_pane_id: undefined,
        panes: [
          mockPane('p1', 'ws-1', 't1', { agent_status: 'idle', cwd: '/' }),
          mockPane('p2', 'ws-2', 't2', { agent_status: 'blocked', cwd: '/' })
        ]
      })
      expect(resolveAuthoritativeWorkspaceId(snap, null)).toBe('ws-2')
    })

    test('falls back to first workspace when no focus or blocked panes', () => {
      const snap = mockSnapshot({
        focused_pane_id: undefined,
        panes: []
      })
      expect(resolveAuthoritativeWorkspaceId(snap, null)).toBe('ws-1')
    })

    test('returns null when snapshot is empty or workspaces array is missing', () => {
      expect(resolveAuthoritativeWorkspaceId(null, null)).toBeNull()
      expect(resolveAuthoritativeWorkspaceId(mockSnapshot({ workspaces: [] }), null)).toBeNull()
    })
  })

  describe('3. Unknown Space fail-closed handling', () => {
    test('consumeWorkspaceDeepLink fails closed when target space is absent from snapshot', () => {
      let selected: string | null = null
      const result = consumeWorkspaceDeepLink({
        targetWorkspaceId: 'unknown-space-id',
        workspaces: [{ workspace_id: 'ws-1' }, { workspace_id: 'ws-2' }],
        onSelectWorkspace: (id) => { selected = id }
      })

      expect(result.matched).toBe(false)
      expect(selected).toBeNull()
    })

    test('authoritative resolution ignores an unknown prior selection and falls back to live spaces', () => {
      const snap: ISnapshotResult = {
        protocol: 22,
        version: '0.9.1',
        workspaces: [
          {
            workspace_id: 'live-ws',
            label: 'Live',
            number: 1,
            agent_status: 'idle',
            tab_count: 0,
            pane_count: 0,
            focused: true
          }
        ],
        tabs: [],
        panes: []
      }
      expect(resolveAuthoritativeWorkspaceId(snap, 'deleted-ws')).toBe('live-ws')
    })
  })

  describe('4. Push deep link derivation & privacy', () => {
    test('createNeedsInputPayload and createDonePayload emit canonical /spaces/:id paths', () => {
      const needsInput = createNeedsInputPayload('ws-prod', 'Production')
      expect(needsInput.url).toBe('/spaces/ws-prod')
      expect(needsInput.url).not.toContain('?')
      expect(needsInput.url).not.toContain('workspace=')

      const done = createDonePayload('ws-prod', 'Production')
      expect(done.url).toBe('/spaces/ws-prod')
      expect(done.url).not.toContain('?')
      expect(done.url).not.toContain('workspace=')
    })

    test('push payloads never expose pane IDs, tabs, commands, or secrets in URL or body', () => {
      const payload = createNeedsInputPayload('ws-secret', 'My Project')
      const serialized = JSON.stringify(payload)

      expect(payload.url).toBe('/spaces/ws-secret')
      expect(serialized).not.toContain('pane')
      expect(serialized).not.toContain('tab')
      expect(serialized).not.toContain('prompt')
      expect(serialized).not.toContain('terminal')
      expect(serialized).not.toContain('cwd')
    })
  })

  describe('5. Service Worker legacy compatibility & canonicalization', () => {
    const loadSwResolver = () => {
      const swSource = fs.readFileSync(path.resolve(import.meta.dir, '../../public/sw.js'), 'utf8')
      const self = {
        location: { origin: 'https://herdr.test' },
        clients: {},
        registration: { showNotification: async () => undefined },
        skipWaiting: () => undefined,
        addEventListener: () => undefined
      }
      const context = { self, URL, Array, decodeURIComponent, encodeURIComponent }
      vm.createContext(context)
      vm.runInContext(swSource + '\n;globalThis.resolveTarget = resolveNotificationTarget;', context)
      return (context as any).resolveTarget as (n: any) => { workspaceId: string | null; targetUrl: string; stage: string }
    }

    test('canonicalizes legacy /?workspace=<id> notification data to /spaces/:id', () => {
      const resolve = loadSwResolver()
      const result = resolve({
        data: { url: '/?workspace=legacy-ws-1' }
      })

      expect(result.workspaceId).toBe('legacy-ws-1')
      expect(result.targetUrl).toBe('https://herdr.test/spaces/legacy-ws-1')
      expect(result.stage).toBe('click_target_data')
    })

    test('parses new canonical /spaces/:id notification data directly', () => {
      const resolve = loadSwResolver()
      const result = resolve({
        data: { url: '/spaces/modern-ws-1', workspaceId: 'modern-ws-1' }
      })

      expect(result.workspaceId).toBe('modern-ws-1')
      expect(result.targetUrl).toBe('https://herdr.test/spaces/modern-ws-1')
      expect(result.stage).toBe('click_target_data')
    })

    test('recovers workspace from tag and derives canonical /spaces/:id', () => {
      const resolve = loadSwResolver()
      const result = resolve({
        tag: 'herdr:space:tag-ws-1:done'
      })

      expect(result.workspaceId).toBe('tag-ws-1')
      expect(result.targetUrl).toBe('https://herdr.test/spaces/tag-ws-1')
      expect(result.stage).toBe('click_target_tag')
    })

    test('fails closed when data target and tag target conflict', () => {
      const resolve = loadSwResolver()
      const result = resolve({
        data: { url: '/spaces/space-A', workspaceId: 'space-A' },
        tag: 'herdr:space:space-B:needs_input'
      })

      expect(result.workspaceId).toBeNull()
      expect(result.targetUrl).toBe('https://herdr.test/')
      expect(result.stage).toBe('click_target_conflict')
    })

    test('fails closed when legacy query data target and tag target conflict', () => {
      const resolve = loadSwResolver()
      const result = resolve({
        data: { url: '/?workspace=space-A' },
        tag: 'herdr:space:space-B:done'
      })

      expect(result.workspaceId).toBeNull()
      expect(result.targetUrl).toBe('https://herdr.test/')
      expect(result.stage).toBe('click_target_conflict')
    })
  })

  describe('6. Service Worker / App ack contract', () => {
    test('service-worker message format uses herdr:open-workspace with workspaceId', () => {
      const message = { type: 'herdr:open-workspace', workspaceId: 'ws-test' }
      expect(parsePushWorkspaceMessage(message)).toBe('ws-test')
      expect(parsePushWorkspaceMessage({ type: 'other', workspaceId: 'ws-test' })).toBeNull()
    })

    test('ack is sent only when target space is present in authoritative snapshot', () => {
      const clientWorkspaces = [{ workspace_id: 'ws-real' }]
      let ackSent: unknown = null

      const fakePort = {
        postMessage: (msg: unknown) => { ackSent = msg }
      }

      // Case 1: Known space -> matched = true, ack sent
      const matchedResult = consumeWorkspaceDeepLink({
        targetWorkspaceId: 'ws-real',
        workspaces: clientWorkspaces,
        onSelectWorkspace: () => {}
      })
      if (matchedResult.matched) {
        fakePort.postMessage({ type: 'herdr:workspace-opened', workspaceId: 'ws-real' })
      }
      expect(ackSent).toEqual({ type: 'herdr:workspace-opened', workspaceId: 'ws-real' })

      // Case 2: Unknown space -> matched = false, NO ack sent
      ackSent = null
      const unknownResult = consumeWorkspaceDeepLink({
        targetWorkspaceId: 'ws-nonexistent',
        workspaces: clientWorkspaces,
        onSelectWorkspace: () => {}
      })
      if (unknownResult.matched) {
        fakePort.postMessage({ type: 'herdr:workspace-opened', workspaceId: 'ws-nonexistent' })
      }
      expect(ackSent).toBeNull()
    })

    test('behavioral regression: evaluatePendingWorkspaceAck prevents premature ack before route commit', () => {
      const snap = {
        workspaces: [{ workspace_id: 'ws-target' }]
      }
      const fakePort = { postMessage: () => {} }

      // Race condition scenario: Message arrives for 'ws-target', but route is currently '/' (not committed)
      const uncommittedDecision = evaluatePendingWorkspaceAck({
        pendingAck: { workspaceId: 'ws-target', port: fakePort as unknown as MessagePort },
        currentPathname: '/',
        snapshot: snap,
        status: 'connected'
      })
      // Must wait for router commit; ref-only model without pathname gate would have fired ack immediately
      expect(uncommittedDecision.action).toBe('wait')
      if (uncommittedDecision.action === 'wait') {
        expect(uncommittedDecision.reason).toBe('route_not_committed')
      }

      // When route is '/settings' (different route), it still must wait
      const settingsDecision = evaluatePendingWorkspaceAck({
        pendingAck: { workspaceId: 'ws-target', port: fakePort as unknown as MessagePort },
        currentPathname: '/settings',
        snapshot: snap,
        status: 'connected'
      })
      expect(settingsDecision.action).toBe('wait')

      // Once route transitions to canonical '/spaces/ws-target', decision transitions to ack
      const committedDecision = evaluatePendingWorkspaceAck({
        pendingAck: { workspaceId: 'ws-target', port: fakePort as unknown as MessagePort },
        currentPathname: '/spaces/ws-target',
        snapshot: snap,
        status: 'connected'
      })
      expect(committedDecision.action).toBe('ack')
      if (committedDecision.action === 'ack') {
        expect(committedDecision.workspaceId).toBe('ws-target')
        expect(committedDecision.port).toBe(fakePort as unknown as MessagePort)
      }
    })

    test('behavioral regression: unknown space NEVER acks even after route commit', () => {
      const snap = {
        workspaces: [{ workspace_id: 'ws-existing' }]
      }
      let ackCalled = false
      const fakePort = {
        postMessage: () => { ackCalled = true }
      }

      // Target 'ws-ghost' has navigated to '/spaces/ws-ghost'
      const decision = evaluatePendingWorkspaceAck({
        pendingAck: { workspaceId: 'ws-ghost', port: fakePort as unknown as MessagePort },
        currentPathname: '/spaces/ws-ghost',
        snapshot: snap,
        status: 'connected'
      })

      // Must reject as unknown space
      expect(decision.action).toBe('reject_unknown')
      if (decision.action === 'reject_unknown') {
        expect(decision.workspaceId).toBe('ws-ghost')
        expect(decision.reason).toBe('unknown_space')
        expect(decision.port).toBe(fakePort as unknown as MessagePort)
      }
      expect(ackCalled).toBe(false)
    })

    test('app root negative response contract: posts herdr:workspace-rejected on port when space is rejected', () => {
      const snap = {
        workspaces: [{ workspace_id: 'ws-existing' }]
      }
      const messages: unknown[] = []
      const fakePort = {
        postMessage: (msg: unknown) => { messages.push(msg) }
      }

      const decision = evaluatePendingWorkspaceAck({
        pendingAck: { workspaceId: 'ws-ghost', port: fakePort as unknown as MessagePort },
        currentPathname: '/spaces/ws-ghost',
        snapshot: snap,
        status: 'connected'
      })

      expect(decision.action).toBe('reject_unknown')
      if (decision.action === 'reject_unknown' && decision.port) {
        decision.port.postMessage({
          type: 'herdr:workspace-rejected',
          workspaceId: decision.workspaceId,
          reason: decision.reason
        })
      }

      expect(messages).toEqual([
        {
          type: 'herdr:workspace-rejected',
          workspaceId: 'ws-ghost',
          reason: 'unknown_space'
        }
      ])
    })

    test('behavioral regression: preserves no-port navigation safely', () => {
      const snap = {
        workspaces: [{ workspace_id: 'ws-target' }]
      }

      // Message received without MessageChannel port (e.g. background deep-link navigation)
      const decision = evaluatePendingWorkspaceAck({
        pendingAck: { workspaceId: 'ws-target', port: undefined },
        currentPathname: '/spaces/ws-target',
        snapshot: snap,
        status: 'connected'
      })

      expect(decision.action).toBe('ack')
      if (decision.action === 'ack') {
        expect(decision.workspaceId).toBe('ws-target')
        expect(decision.port).toBeUndefined()
      }
    })

    test('behavioral regression: waits when snapshot is loading or missing', () => {
      const fakePort = { postMessage: () => {} }

      const loadingDecision = evaluatePendingWorkspaceAck({
        pendingAck: { workspaceId: 'ws-target', port: fakePort as unknown as MessagePort },
        currentPathname: '/spaces/ws-target',
        snapshot: null,
        status: 'loading'
      })
      expect(loadingDecision.action).toBe('wait')
      if (loadingDecision.action === 'wait') {
        expect(loadingDecision.reason).toBe('snapshot_loading')
      }

      const missingSnapDecision = evaluatePendingWorkspaceAck({
        pendingAck: { workspaceId: 'ws-target', port: fakePort as unknown as MessagePort },
        currentPathname: '/spaces/ws-target',
        snapshot: null,
        status: 'connected'
      })
      expect(missingSnapDecision.action).toBe('wait')
      if (missingSnapDecision.action === 'wait') {
        expect(missingSnapDecision.reason).toBe('snapshot_missing')
      }

      const staleSnapshotDecision = evaluatePendingWorkspaceAck({
        pendingAck: { workspaceId: 'ws-target', port: fakePort as unknown as MessagePort },
        currentPathname: '/spaces/ws-target',
        snapshot: { workspaces: [{ workspace_id: 'ws-target' }] },
        status: 'reconnecting'
      })
      expect(staleSnapshotDecision.action).toBe('wait')
      if (staleSnapshotDecision.action === 'wait') {
        expect(staleSnapshotDecision.reason).toBe('snapshot_unhealthy')
      }
    })
  })

  describe('7. Route module source guarantees', () => {
    test('routes/_index.tsx, spaces.$workspaceId.tsx, and settings.tsx exist and do not parse query strings', () => {
      const indexPath = path.resolve(import.meta.dir, '../../app/routes/_index.tsx')
      const spacePath = path.resolve(import.meta.dir, '../../app/routes/spaces.$workspaceId.tsx')
      const settingsPath = path.resolve(import.meta.dir, '../../app/routes/settings.tsx')

      expect(fs.existsSync(indexPath)).toBe(true)
      expect(fs.existsSync(spacePath)).toBe(true)
      expect(fs.existsSync(settingsPath)).toBe(true)

      const indexContent = fs.readFileSync(indexPath, 'utf8')
      const spaceContent = fs.readFileSync(spacePath, 'utf8')
      const settingsContent = fs.readFileSync(settingsPath, 'utf8')

      // New app routes must not parse or generate workspace query string
      expect(indexContent).not.toContain('searchParams.get(\'workspace\')')
      expect(spaceContent).not.toContain('searchParams.get(\'workspace\')')
      expect(settingsContent).not.toContain('searchParams.get(\'workspace\')')

      expect(indexContent).not.toContain('?workspace=')
      expect(spaceContent).not.toContain('?workspace=')
      expect(settingsContent).not.toContain('?workspace=')
    })

    test('settings route uses router navigation with state and back behavior', () => {
      const settingsContent = fs.readFileSync(
        path.resolve(import.meta.dir, '../../app/routes/settings.tsx'),
        'utf8'
      )
      expect(settingsContent).toContain('useNavigate')
      expect(settingsContent).toContain('useLocation')
      expect(settingsContent).toContain('navigate(-1)')
      expect(settingsContent).toContain("navigate('/', { replace: true })")
      expect(settingsContent).toContain('shouldRestoreMenuFocusRef')
      expect(settingsContent).not.toContain('shouldRestoreDrawerFocusRef')
      expect(settingsContent).not.toContain('restoreFocusTargetRef')
    })
  })

  describe('8. SpaceRoute param resolution regression', () => {
    test('resolveSpaceRouteParam parses valid space IDs safely', () => {
      expect(resolveSpaceRouteParam('ws-main')).toBe('ws-main')
      expect(resolveSpaceRouteParam('space_123')).toBe('space_123')
      expect(resolveSpaceRouteParam('  ws-padded  ')).toBe('ws-padded')
    })

    test('malformed percent param reaches invalid-ID UI/logic without throwing URIError', () => {
      // Unencoded or malformed percent sequences that crash decodeURIComponent
      expect(() => resolveSpaceRouteParam('%')).not.toThrow()
      expect(resolveSpaceRouteParam('%')).toBeNull()

      expect(() => resolveSpaceRouteParam('%E0%A4%A')).not.toThrow()
      expect(resolveSpaceRouteParam('%E0%A4%A')).toBeNull()

      expect(() => resolveSpaceRouteParam('%2')).not.toThrow()
      expect(resolveSpaceRouteParam('%2')).toBeNull()

      expect(() => resolveSpaceRouteParam('ws%20space')).not.toThrow()
      expect(resolveSpaceRouteParam('ws%20space')).toBeNull()

      expect(() => resolveSpaceRouteParam('%%%')).not.toThrow()
      expect(resolveSpaceRouteParam('%%%')).toBeNull()

      expect(resolveSpaceRouteParam('')).toBeNull()
      expect(resolveSpaceRouteParam('   ')).toBeNull()
      expect(resolveSpaceRouteParam(null)).toBeNull()
      expect(resolveSpaceRouteParam(undefined)).toBeNull()
    })
  })
})
