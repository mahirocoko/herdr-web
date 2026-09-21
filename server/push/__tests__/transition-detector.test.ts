import { describe, expect, test } from 'bun:test'
import type { IPane, ISnapshotResult, ITab, IWorkspace } from '../../types.ts'
import {
  PushTransitionDetector,
  resolveWorkspaceOwnerTabs,
  sanitizeWorkspaceLabel
} from '../transition-detector.ts'

const makeWorkspace = (workspaceId: string, label: string, tabCount = 1): IWorkspace => ({
  workspace_id: workspaceId,
  label,
  number: 1,
  agent_status: 'unknown',
  tab_count: tabCount,
  pane_count: tabCount,
  focused: false
})

const makeTab = (
  tabId: string,
  workspaceId: string,
  number: number,
  agentStatus: string,
  paneCount = 1
): ITab => ({
  tab_id: tabId,
  workspace_id: workspaceId,
  label: String(number),
  number,
  pane_count: paneCount,
  focused: false,
  agent_status: agentStatus
})

const makePane = (
  paneId: string,
  workspaceId: string,
  tabId: string,
  agentStatus: string
): IPane => ({
  pane_id: paneId,
  workspace_id: workspaceId,
  tab_id: tabId,
  cwd: '/test',
  focused: false,
  agent: 'letta',
  agent_status: agentStatus
})

const makeSnapshot = (
  tabs: ITab[],
  options: { workspaces?: IWorkspace[]; panes?: IPane[] } = {}
): ISnapshotResult => ({
  protocol: 22,
  version: '0.9.1',
  workspaces: options.workspaces ?? [makeWorkspace('ws1', 'Main Space', tabs.length)],
  tabs,
  panes: options.panes ?? tabs.map((tab) => makePane(
    `pane-${tab.tab_id}`,
    tab.workspace_id,
    tab.tab_id,
    tab.agent_status
  ))
})

const mainTransition = (type: 'needs_input' | 'done', sourceTabId = 't1') => ({
  type,
  workspaceId: 'ws1',
  workspaceLabel: 'Main Space',
  sourceTabId
})

describe('server/push/transition-detector: aggregate first-tab state', () => {
  describe('baseline and re-entry', () => {
    test('first baseline emits nothing even when owner tabs are blocked or done', () => {
      const detector = new PushTransitionDetector()
      const snapshot = makeSnapshot([
        makeTab('t1', 'ws1', 1, 'blocked'),
        makeTab('t2', 'ws1', 2, 'done')
      ])
      expect(detector.diffSnapshot(snapshot)).toEqual([])
      expect(detector.isBaselineEstablished()).toBe(true)
      expect(detector.getTrackedTabCount()).toBe(2)
    })

    test('owner-tab working -> blocked emits one needs_input', () => {
      const detector = new PushTransitionDetector()
      detector.diffSnapshot(makeSnapshot([makeTab('t1', 'ws1', 1, 'working')]))
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'blocked')
      ]))).toEqual([mainTransition('needs_input')])
    })

    test('owner-tab non-done -> done emits one done', () => {
      const detector = new PushTransitionDetector()
      detector.diffSnapshot(makeSnapshot([makeTab('t1', 'ws1', 1, 'working')]))
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'done')
      ]))).toEqual([mainTransition('done')])
    })

    test('owner-tab working -> idle emits one interactive-turn done and repeated idle is quiet', () => {
      const detector = new PushTransitionDetector()
      detector.diffSnapshot(makeSnapshot([makeTab('t1', 'ws1', 1, 'working')]))
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'idle')
      ]))).toEqual([mainTransition('done')])
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'idle')
      ]))).toEqual([])
    })

    test('initial idle and non-working -> idle do not emit done', () => {
      const detector = new PushTransitionDetector()
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'idle')
      ]))).toEqual([])
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'blocked')
      ]))).toEqual([mainTransition('needs_input')])
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'idle')
      ]))).toEqual([])
    })

    test('returning to working permits a later owner-tab transition to emit again', () => {
      const detector = new PushTransitionDetector()
      detector.diffSnapshot(makeSnapshot([makeTab('t1', 'ws1', 1, 'working')]))
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'blocked')
      ]))).toEqual([mainTransition('needs_input')])
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working')
      ]))).toEqual([])
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'idle')
      ]))).toEqual([mainTransition('done')])
    })

    test('removed and reintroduced tab establishes a silent baseline before future transitions', () => {
      const detector = new PushTransitionDetector()
      detector.diffSnapshot(makeSnapshot([makeTab('t1', 'ws1', 1, 'working')]))
      expect(detector.getTrackedTabCount()).toBe(1)
      expect(detector.diffSnapshot(makeSnapshot([]))).toEqual([])
      expect(detector.getTrackedTabCount()).toBe(0)
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'blocked')
      ]))).toEqual([])
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working')
      ]))).toEqual([])
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'blocked')
      ]))).toEqual([mainTransition('needs_input')])
    })
  })

  describe('one aggregate owner stream per Space', () => {
    test('pane changes inside the owner tab cannot create extra notifications while tab state is unchanged', () => {
      const detector = new PushTransitionDetector()
      const owner = makeTab('t1', 'ws1', 1, 'working', 3)
      detector.diffSnapshot(makeSnapshot([owner], {
        panes: [
          makePane('p-main', 'ws1', 't1', 'working'),
          makePane('p-sub-1', 'ws1', 't1', 'working'),
          makePane('p-sub-2', 'ws1', 't1', 'working')
        ]
      }))

      expect(detector.diffSnapshot(makeSnapshot([owner], {
        panes: [
          makePane('p-main', 'ws1', 't1', 'working'),
          makePane('p-sub-1', 'ws1', 't1', 'done'),
          makePane('p-sub-2', 'ws1', 't1', 'blocked')
        ]
      }))).toEqual([])
    })

    test('multiple pane changes collapse to one notification when aggregate owner-tab state changes', () => {
      const detector = new PushTransitionDetector()
      detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working', 3)
      ]))
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'blocked', 3)
      ], {
        panes: [
          makePane('p-main', 'ws1', 't1', 'blocked'),
          makePane('p-sub-1', 'ws1', 't1', 'done'),
          makePane('p-sub-2', 'ws1', 't1', 'blocked')
        ]
      }))).toEqual([mainTransition('needs_input')])
    })

    test('non-owner tab transitions are suppressed while owner aggregate transition emits', () => {
      const detector = new PushTransitionDetector()
      const workspaces = [makeWorkspace('ws1', 'Main Space', 2)]
      detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working'),
        makeTab('t-direct', 'ws1', 26, 'working')
      ], { workspaces }))

      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working'),
        makeTab('t-direct', 'ws1', 26, 'blocked')
      ], { workspaces }))).toEqual([])

      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'blocked'),
        makeTab('t-direct', 'ws1', 26, 'blocked')
      ], { workspaces }))).toEqual([mainTransition('needs_input')])
    })

    test('an owner change never retroactively emits a status already observed on the old non-owner', () => {
      const detector = new PushTransitionDetector()
      const workspace = makeWorkspace('ws1', 'Main Space', 2)
      detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working'),
        makeTab('t2', 'ws1', 2, 'working')
      ], { workspaces: [workspace] }))

      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working'),
        makeTab('t2', 'ws1', 2, 'blocked')
      ], { workspaces: [workspace] }))).toEqual([])

      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t2', 'ws1', 2, 'blocked')
      ], { workspaces: [makeWorkspace('ws1', 'Main Space', 1)] }))).toEqual([])

      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t2', 'ws1', 2, 'working')
      ], { workspaces: [makeWorkspace('ws1', 'Main Space', 1)] }))).toEqual([])
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t2', 'ws1', 2, 'idle')
      ], { workspaces: [makeWorkspace('ws1', 'Main Space', 1)] }))).toEqual([mainTransition('done', 't2')])
    })

    test('a newly added lower-number owner establishes blocked or done state silently', () => {
      const detector = new PushTransitionDetector()
      const workspaces = [makeWorkspace('ws1', 'Main Space', 1)]
      detector.diffSnapshot(makeSnapshot([
        makeTab('t2', 'ws1', 2, 'working')
      ], { workspaces }))

      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'blocked'),
        makeTab('t2', 'ws1', 2, 'working')
      ], { workspaces: [makeWorkspace('ws1', 'Main Space', 2)] }))).toEqual([])

      const tiedDetector = new PushTransitionDetector()
      tiedDetector.diffSnapshot(makeSnapshot([
        makeTab('tab-z', 'ws1', 1, 'working')
      ], { workspaces }))
      expect(tiedDetector.diffSnapshot(makeSnapshot([
        makeTab('tab-a', 'ws1', 1, 'done'),
        makeTab('tab-z', 'ws1', 1, 'working')
      ], { workspaces: [makeWorkspace('ws1', 'Main Space', 2)] }))).toEqual([])
    })

    test('duplicate tab IDs across Spaces fail closed and cannot corrupt tracked state', () => {
      const detector = new PushTransitionDetector()
      const workspaces = [
        makeWorkspace('ws1', 'Main Space', 1),
        makeWorkspace('ws2', 'Other Space', 1)
      ]
      detector.diffSnapshot(makeSnapshot([
        makeTab('duplicate', 'ws1', 1, 'working'),
        makeTab('duplicate', 'ws2', 1, 'working')
      ], { workspaces }))
      expect(detector.getTrackedTabCount()).toBe(0)

      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('duplicate', 'ws1', 1, 'blocked'),
        makeTab('duplicate', 'ws2', 1, 'done')
      ], { workspaces }))).toEqual([])
      expect(resolveWorkspaceOwnerTabs([
        makeTab('duplicate', 'ws1', 1, 'blocked'),
        makeTab('duplicate', 'ws2', 1, 'done')
      ]).size).toBe(0)
    })

    test('missing workspace topology fails closed', () => {
      const detector = new PushTransitionDetector()
      detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'missing', 1, 'working')
      ], { workspaces: [] }))
      expect(detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'missing', 1, 'blocked')
      ], { workspaces: [] }))).toEqual([])
    })
  })

  describe('owner resolution', () => {
    test('selects the lowest finite tab number regardless of array order', () => {
      const ownerMap = resolveWorkspaceOwnerTabs([
        makeTab('tab-high', 'ws-1', 3, 'unknown'),
        makeTab('tab-low', 'ws-1', 1, 'unknown'),
        makeTab('tab-mid', 'ws-1', 2, 'unknown')
      ])
      expect(ownerMap.get('ws-1')).toBe('tab-low')
    })

    test('tie-breaks equal numbers deterministically by tab_id', () => {
      const ownerMap = resolveWorkspaceOwnerTabs([
        makeTab('tab-z', 'ws-1', 1, 'unknown'),
        makeTab('tab-a', 'ws-1', 1, 'unknown')
      ])
      expect(ownerMap.get('ws-1')).toBe('tab-a')
    })

    test('ignores non-finite numbers and scopes owners per workspace', () => {
      const ownerMap = resolveWorkspaceOwnerTabs([
        makeTab('bad', 'ws-1', Number.NaN, 'unknown'),
        makeTab('valid-1', 'ws-1', 5, 'unknown'),
        makeTab('valid-2', 'ws-2', 0, 'unknown')
      ])
      expect(ownerMap.get('ws-1')).toBe('valid-1')
      expect(ownerMap.get('ws-2')).toBe('valid-2')
    })
  })

  describe('workspace label sanitization', () => {
    test('strips control and bidi formatting while preserving Thai and emoji', () => {
      const raw = ' \u0000\u0007\u001f\u007f\u0080\u009f\u202eพื้นที่ทำงาน\u200e \u061c(Main Space) \u2066🚀✨\u2069 '
      expect(sanitizeWorkspaceLabel(raw)).toBe('พื้นที่ทำงาน (Main Space) 🚀✨')
    })

    test('collapses whitespace and caps Unicode code points without splitting emoji', () => {
      expect(sanitizeWorkspaceLabel('   Space    Alpha   ')).toBe('Space Alpha')
      const capped = sanitizeWorkspaceLabel('🚀'.repeat(70), 64)
      expect(Array.from(capped || '').length).toBe(64)
      expect(capped).toBe('🚀'.repeat(64))
    })

    test('returns undefined for empty, whitespace-only, or non-string values', () => {
      expect(sanitizeWorkspaceLabel('')).toBeUndefined()
      expect(sanitizeWorkspaceLabel('   ')).toBeUndefined()
      expect(sanitizeWorkspaceLabel(undefined)).toBeUndefined()
      expect(sanitizeWorkspaceLabel(null)).toBeUndefined()
    })
  })

  describe('per-tab notification policy emission', () => {
    test('default first emits and non-first is suppressed when no override set', () => {
      const detector = new PushTransitionDetector()
      const workspaces = [makeWorkspace('ws1', 'Main Space', 2)]
      const snap0 = makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working'),
        makeTab('t2', 'ws1', 2, 'working')
      ], { workspaces })
      detector.diffSnapshot(snap0)

      // t1 and t2 both transition to blocked
      const snap1 = makeSnapshot([
        makeTab('t1', 'ws1', 1, 'blocked'),
        makeTab('t2', 'ws1', 2, 'blocked')
      ], { workspaces })

      // Default first-canonical: only t1 emits, t2 suppressed
      const transitions = detector.diffSnapshot(snap1)
      expect(transitions).toEqual([mainTransition('needs_input', 't1')])
    })

    test('non-first override emits when explicitly enabled', () => {
      const detector = new PushTransitionDetector()
      const workspaces = [makeWorkspace('ws1', 'Main Space', 2)]
      detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working'),
        makeTab('t2', 'ws1', 2, 'working')
      ], { workspaces }))

      const snap1 = makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working'),
        makeTab('t2', 'ws1', 2, 'blocked')
      ], { workspaces })

      // Pass enabledTabIds including non-first t2
      const transitions = detector.diffSnapshot(snap1, new Set(['t1', 't2']))
      expect(transitions).toEqual([mainTransition('needs_input', 't2')])
    })

    test('first tab explicit false suppresses its emission', () => {
      const detector = new PushTransitionDetector()
      const workspaces = [makeWorkspace('ws1', 'Main Space', 2)]
      detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working'),
        makeTab('t2', 'ws1', 2, 'working')
      ], { workspaces }))

      const snap1 = makeSnapshot([
        makeTab('t1', 'ws1', 1, 'blocked'),
        makeTab('t2', 'ws1', 2, 'working')
      ], { workspaces })

      // First tab explicitly disabled: enabledTabIds has only t2
      const transitions = detector.diffSnapshot(snap1, new Set(['t2']))
      expect(transitions).toEqual([])
    })

    test('toggling on already blocked or done tab is silent until future working transition', () => {
      const detector = new PushTransitionDetector()
      const workspaces = [makeWorkspace('ws1', 'Main Space', 2)]
      detector.diffSnapshot(makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working'),
        makeTab('t2', 'ws1', 2, 'working')
      ], { workspaces }))

      // t2 becomes blocked while disabled (only t1 enabled)
      const snapBlocked = makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working'),
        makeTab('t2', 'ws1', 2, 'blocked')
      ], { workspaces })
      const transitionsWhileDisabled = detector.diffSnapshot(snapBlocked, new Set(['t1']))
      expect(transitionsWhileDisabled).toEqual([])

      // Now user enables t2 in UI policy, but t2 is STILL blocked (no status change)
      const snapSameBlocked = makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working'),
        makeTab('t2', 'ws1', 2, 'blocked')
      ], { workspaces })
      const transitionsOnEnable = detector.diffSnapshot(snapSameBlocked, new Set(['t1', 't2']))
      expect(transitionsOnEnable).toEqual([]) // Silent! No retroactive emission!

      // Future transition: t2 returns to working (silent)
      const snapWorking = makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working'),
        makeTab('t2', 'ws1', 2, 'working')
      ], { workspaces })
      expect(detector.diffSnapshot(snapWorking, new Set(['t1', 't2']))).toEqual([])

      // Future transition: t2 finishes working -> idle (now it emits done!)
      const snapIdle = makeSnapshot([
        makeTab('t1', 'ws1', 1, 'working'),
        makeTab('t2', 'ws1', 2, 'idle')
      ], { workspaces })
      expect(detector.diffSnapshot(snapIdle, new Set(['t1', 't2']))).toEqual([
        mainTransition('done', 't2')
      ])
    })
  })
})
