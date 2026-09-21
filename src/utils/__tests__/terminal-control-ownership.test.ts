import { describe, it, expect } from 'bun:test'
import {
  resolveTerminalOwnershipTransition,
  getTerminalControlFooterNotice,
  evaluateControlStatusResponse,
  shouldReleaseControlOnPaneChange,
  shouldReleaseControlOnViewChange,
  shouldReleaseControlOnNavigation,
  parseTerminalControlStatusResponse,
  resolveControlledPaneIdentity,
  resolveTerminalControlConnectionPane,
  isLateControlOwnershipCallback,
  type ITerminalControlOwnership
} from '../terminal-control-ownership.ts'

describe('terminal-control-ownership pure state machine', () => {
  describe('transitions & footer exclusivity', () => {
    it('transitions idle -> take_control -> engaging with exclusive footer', () => {
      const res = resolveTerminalOwnershipTransition({
        current: 'idle',
        action: { type: 'take_control' }
      })
      expect(res.next).toBe('engaging')
      expect(res.isFooterExclusive).toBe(true)
    })

    it('transitions engaging -> control_ready -> active with exclusive footer', () => {
      const res = resolveTerminalOwnershipTransition({
        current: 'engaging',
        action: { type: 'control_ready' }
      })
      expect(res.next).toBe('active')
      expect(res.isFooterExclusive).toBe(true)
    })

    it('transitions active -> release_initiated -> releasing with exclusive footer', () => {
      const res = resolveTerminalOwnershipTransition({
        current: 'active',
        action: { type: 'release_initiated' }
      })
      expect(res.next).toBe('releasing')
      expect(res.isFooterExclusive).toBe(true)
    })

    it('transitions active -> surface_or_pane_changed -> releasing with exclusive footer', () => {
      const res = resolveTerminalOwnershipTransition({
        current: 'active',
        action: { type: 'surface_or_pane_changed' }
      })
      expect(res.next).toBe('releasing')
      expect(res.isFooterExclusive).toBe(true)
    })

    it('transitions engaging -> control_error -> releasing with exclusive footer', () => {
      const res = resolveTerminalOwnershipTransition({
        current: 'engaging',
        action: { type: 'control_error' }
      })
      expect(res.next).toBe('releasing')
      expect(res.isFooterExclusive).toBe(true)
    })

    it('transitions engaging -> surface_or_pane_changed -> releasing with exclusive footer', () => {
      const res = resolveTerminalOwnershipTransition({
        current: 'engaging',
        action: { type: 'surface_or_pane_changed' }
      })
      expect(res.next).toBe('releasing')
      expect(res.isFooterExclusive).toBe(true)
    })

    it('transitions releasing -> lease_released -> idle, unblocking footer exclusivity', () => {
      const res = resolveTerminalOwnershipTransition({
        current: 'releasing',
        action: { type: 'lease_released' }
      })
      expect(res.next).toBe('idle')
      expect(res.isFooterExclusive).toBe(false)
    })

    it('preserves immediate idle for paths that never entered mode=control', () => {
      const resPane = resolveTerminalOwnershipTransition({
        current: 'idle',
        action: { type: 'surface_or_pane_changed' }
      })
      expect(resPane.next).toBe('idle')
      expect(resPane.isFooterExclusive).toBe(false)

      const resErr = resolveTerminalOwnershipTransition({
        current: 'idle',
        action: { type: 'control_error' }
      })
      expect(resErr.next).toBe('idle')
      expect(resErr.isFooterExclusive).toBe(false)
    })
  })

  describe('evaluateControlStatusResponse pure helper', () => {
    it('ignores responses from stale generations', () => {
      const res = evaluateControlStatusResponse({
        currentGeneration: 1,
        activeGeneration: 2,
        targetPaneId: 'ws1:p1',
        statusResult: { ok: true, pane: 'ws1:p1', leased: false, status: null }
      })
      expect(res).toEqual({ action: 'ignore_stale' })
    })

    it('remains releasing on fetch error or network failure', () => {
      const res = evaluateControlStatusResponse({
        currentGeneration: 3,
        activeGeneration: 3,
        targetPaneId: 'ws1:p1',
        statusResult: null,
        fetchError: new Error('Network timeout')
      })
      expect(res).toEqual({ action: 'remain_releasing', reason: 'error' })
    })

    it('remains releasing if response is not ok or missing', () => {
      const res = evaluateControlStatusResponse({
        currentGeneration: 3,
        activeGeneration: 3,
        targetPaneId: 'ws1:p1',
        statusResult: { ok: false, pane: 'ws1:p1', leased: false } as any
      })
      expect(res).toEqual({ action: 'remain_releasing', reason: 'error' })
    })

    it('remains releasing if returned pane ID does not match target pane', () => {
      const res = evaluateControlStatusResponse({
        currentGeneration: 3,
        activeGeneration: 3,
        targetPaneId: 'ws1:p1',
        statusResult: { ok: true, pane: 'ws1:p2', leased: false, status: null }
      })
      expect(res).toEqual({ action: 'remain_releasing', reason: 'pane_mismatch' })
    })

    it('remains releasing while server reports leased: true (pending, active, or releasing/quarantined)', () => {
      const resPending = evaluateControlStatusResponse({
        currentGeneration: 3,
        activeGeneration: 3,
        targetPaneId: 'ws1:p1',
        statusResult: { ok: true, pane: 'ws1:p1', leased: true, status: 'pending' }
      })
      expect(resPending).toEqual({ action: 'remain_releasing', reason: 'leased' })

      const resActive = evaluateControlStatusResponse({
        currentGeneration: 3,
        activeGeneration: 3,
        targetPaneId: 'ws1:p1',
        statusResult: { ok: true, pane: 'ws1:p1', leased: true, status: 'active' }
      })
      expect(resActive).toEqual({ action: 'remain_releasing', reason: 'leased' })

      const resQuarantined = evaluateControlStatusResponse({
        currentGeneration: 3,
        activeGeneration: 3,
        targetPaneId: 'ws1:p1',
        statusResult: { ok: true, pane: 'ws1:p1', leased: true, status: 'releasing' }
      })
      expect(resQuarantined).toEqual({ action: 'remain_releasing', reason: 'leased' })
    })

    it('transitions to idle only when server explicitly returns leased: false for exact matching pane', () => {
      const res = evaluateControlStatusResponse({
        currentGeneration: 3,
        activeGeneration: 3,
        targetPaneId: 'ws1:p1',
        statusResult: { ok: true, pane: 'ws1:p1', leased: false, status: null }
      })
      expect(res).toEqual({ action: 'transition_to_idle' })
    })
  })

  describe('footer notice copy', () => {
    it('returns concise notice copy for engaging state', () => {
      expect(getTerminalControlFooterNotice('engaging')).toBe('Connecting terminal control session...')
    })

    it('returns concise notice copy for active state', () => {
      expect(getTerminalControlFooterNotice('active')).toBe(
        'Shell input is active in Stream terminal. Direct typing enabled.'
      )
    })

    it('returns concise notice copy for releasing state', () => {
      expect(getTerminalControlFooterNotice('releasing')).toBe('Releasing terminal control session...')
    })

    it('returns null notice for idle state', () => {
      expect(getTerminalControlFooterNotice('idle')).toBeNull()
    })
  })

  describe('navigation fallback pure predicates (regression guard)', () => {
    describe('shouldReleaseControlOnPaneChange', () => {
      it('does not request release when pane is unchanged across ownership progression', () => {
        expect(shouldReleaseControlOnPaneChange('w5N:pB', 'w5N:pB', 'idle')).toBe(false)
        expect(shouldReleaseControlOnPaneChange('w5N:pB', 'w5N:pB', 'engaging')).toBe(false)
        expect(shouldReleaseControlOnPaneChange('w5N:pB', 'w5N:pB', 'active')).toBe(false)
      })

      it('does not request release on initial mount (prevPaneId is null or identical)', () => {
        expect(shouldReleaseControlOnPaneChange(null, 'w5N:pB', 'idle')).toBe(false)
        expect(shouldReleaseControlOnPaneChange(null, 'w5N:pB', 'engaging')).toBe(false)
        expect(shouldReleaseControlOnPaneChange(null, 'w5N:pB', 'active')).toBe(false)
      })

      it('requests release on actual pane switch when ownership is engaging or active', () => {
        expect(shouldReleaseControlOnPaneChange('w5N:pB', 'w5N:p1', 'active')).toBe(true)
        expect(shouldReleaseControlOnPaneChange('w5N:pB', 'w5N:p1', 'engaging')).toBe(true)
      })

      it('does not request release on actual pane switch when ownership is idle or releasing', () => {
        expect(shouldReleaseControlOnPaneChange('w5N:pB', 'w5N:p1', 'idle')).toBe(false)
        expect(shouldReleaseControlOnPaneChange('w5N:pB', 'w5N:p1', 'releasing')).toBe(false)
      })
    })

    describe('shouldReleaseControlOnViewChange', () => {
      it('does not request release when surface mode is unchanged across ownership progression', () => {
        expect(shouldReleaseControlOnViewChange('stream', 'stream', 'idle')).toBe(false)
        expect(shouldReleaseControlOnViewChange('stream', 'stream', 'engaging')).toBe(false)
        expect(shouldReleaseControlOnViewChange('stream', 'stream', 'active')).toBe(false)
      })

      it('requests release on actual transition away from stream when ownership is engaging or active', () => {
        expect(shouldReleaseControlOnViewChange('stream', 'panel', 'active')).toBe(true)
        expect(shouldReleaseControlOnViewChange('stream', 'panel', 'engaging')).toBe(true)
        expect(shouldReleaseControlOnViewChange('stream', 'history', 'active')).toBe(true)
        expect(shouldReleaseControlOnViewChange('stream', 'question', 'active')).toBe(true)
      })

      it('does not request release on transition away from stream when ownership is idle or releasing', () => {
        expect(shouldReleaseControlOnViewChange('stream', 'panel', 'idle')).toBe(false)
        expect(shouldReleaseControlOnViewChange('stream', 'panel', 'releasing')).toBe(false)
      })

      it('does not request release on transitions not leaving stream', () => {
        expect(shouldReleaseControlOnViewChange('panel', 'history', 'active')).toBe(false)
        expect(shouldReleaseControlOnViewChange('panel', 'stream', 'active')).toBe(false)
        expect(shouldReleaseControlOnViewChange('question', 'panel', 'active')).toBe(false)
      })
    })

    describe('shouldReleaseControlOnNavigation (combined)', () => {
      it('proves unchanged pane and stream view during idle->engaging->active does not request release', () => {
        const paramsBase = {
          prevPaneId: 'w5N:pB',
          currentPaneId: 'w5N:pB',
          prevViewMode: 'stream',
          currentViewMode: 'stream'
        }

        expect(shouldReleaseControlOnNavigation({ ...paramsBase, ownership: 'idle' })).toBe(false)
        expect(shouldReleaseControlOnNavigation({ ...paramsBase, ownership: 'engaging' })).toBe(false)
        expect(shouldReleaseControlOnNavigation({ ...paramsBase, ownership: 'active' })).toBe(false)
      })

      it('proves actual pane switch while active requests release', () => {
        expect(
          shouldReleaseControlOnNavigation({
            prevPaneId: 'w5N:pB',
            currentPaneId: 'w5N:p1',
            prevViewMode: 'stream',
            currentViewMode: 'stream',
            ownership: 'active'
          })
        ).toBe(true)
      })

      it('proves actual stream -> panel transition while active requests release', () => {
        expect(
          shouldReleaseControlOnNavigation({
            prevPaneId: 'w5N:pB',
            currentPaneId: 'w5N:pB',
            prevViewMode: 'stream',
            currentViewMode: 'panel',
            ownership: 'active'
          })
        ).toBe(true)
      })

      it('proves subsequent view change while releasing does not request redundant release', () => {
        expect(
          shouldReleaseControlOnNavigation({
            prevPaneId: 'w5N:pB',
            currentPaneId: 'w5N:pB',
            prevViewMode: 'stream',
            currentViewMode: 'panel',
            ownership: 'releasing'
          })
        ).toBe(false)
      })
    })

    describe('lifecycle simulation: entering control and switching navigation', () => {
      it('simulates space dashboard state lifecycle without runaway release', () => {
        let selectedPaneId = 'w5N:pB'
        let viewMode = 'stream'
        let ownership: ITerminalControlOwnership = 'idle'
        let prevControlPaneId: string | null = selectedPaneId
        let prevControlViewMode = viewMode

        const evaluateEffects = () => {
          const paneRelease = shouldReleaseControlOnPaneChange(
            prevControlPaneId,
            selectedPaneId,
            ownership
          )
          prevControlPaneId = selectedPaneId

          const viewRelease = shouldReleaseControlOnViewChange(
            prevControlViewMode,
            viewMode,
            ownership
          )
          prevControlViewMode = viewMode

          return paneRelease || viewRelease
        }

        // Initial mount check: no release
        expect(evaluateEffects()).toBe(false)
        expect(ownership).toBe('idle')

        // User triggers Take Control -> ownership becomes engaging
        ownership = 'engaging'
        expect(evaluateEffects()).toBe(false)
        expect(ownership).toBe('engaging')
        expect(getTerminalControlFooterNotice(ownership)).toBe('Connecting terminal control session...')

        // Server lease ready -> ownership becomes active
        ownership = 'active'
        expect(evaluateEffects()).toBe(false)
        expect(ownership).toBe('active')
        expect(getTerminalControlFooterNotice(ownership)).toBe(
          'Shell input is active in Stream terminal. Direct typing enabled.'
        )

        // User switches pane to w5N:p1
        selectedPaneId = 'w5N:p1'
        const shouldRelease = evaluateEffects()
        expect(shouldRelease).toBe(true)

        // Handler sets releasing
        ownership = 'releasing'
        expect(getTerminalControlFooterNotice(ownership)).toBe('Releasing terminal control session...')

        // Mode changes away to panel while releasing
        viewMode = 'panel'
        const shouldReleaseAgain = evaluateEffects()
        expect(shouldReleaseAgain).toBe(false)

        // Server confirms lease released -> ownership transitions to idle
        const transition = resolveTerminalOwnershipTransition({
          current: ownership,
          action: { type: 'lease_released' }
        })
        expect(transition.next).toBe('idle')
        expect(transition.isFooterExclusive).toBe(false)
        ownership = transition.next
        expect(getTerminalControlFooterNotice(ownership)).toBeNull()
      })
    })
  })

  describe('parseTerminalControlStatusResponse pure parser/validator', () => {
    it('parses valid unleased state (leased: false, status: null)', () => {
      const parsed = parseTerminalControlStatusResponse(
        { ok: true, pane: 'ws1:p1', leased: false, status: null },
        'ws1:p1'
      )
      expect(parsed).toEqual({
        ok: true,
        pane: 'ws1:p1',
        leased: false,
        status: null
      })
    })

    it('parses valid leased states (pending, active, releasing)', () => {
      const pending = parseTerminalControlStatusResponse(
        { ok: true, pane: 'ws1:p1', leased: true, status: 'pending' },
        'ws1:p1'
      )
      expect(pending.status).toBe('pending')
      expect(pending.leased).toBe(true)

      const active = parseTerminalControlStatusResponse(
        { ok: true, pane: 'ws1:p1', leased: true, status: 'active' },
        'ws1:p1'
      )
      expect(active.status).toBe('active')

      const releasing = parseTerminalControlStatusResponse(
        { ok: true, pane: 'ws1:p1', leased: true, status: 'releasing' },
        'ws1:p1'
      )
      expect(releasing.status).toBe('releasing')
    })

    it('throws error when pane mismatches expected pane', () => {
      expect(() => {
        parseTerminalControlStatusResponse(
          { ok: true, pane: 'ws1:wrong', leased: false, status: null },
          'ws1:p1'
        )
      }).toThrow('pane mismatch')
    })

    it('throws error on non-boolean leased value', () => {
      expect(() => {
        parseTerminalControlStatusResponse(
          { ok: true, pane: 'ws1:p1', leased: 'false', status: null },
          'ws1:p1'
        )
      }).toThrow('leased must be a boolean')

      expect(() => {
        parseTerminalControlStatusResponse(
          { ok: true, pane: 'ws1:p1', leased: 0, status: null },
          'ws1:p1'
        )
      }).toThrow('leased must be a boolean')

      expect(() => {
        parseTerminalControlStatusResponse(
          { ok: true, pane: 'ws1:p1', leased: null, status: null },
          'ws1:p1'
        )
      }).toThrow('leased must be a boolean')
    })

    it('throws error on unknown or invalid status value', () => {
      expect(() => {
        parseTerminalControlStatusResponse(
          { ok: true, pane: 'ws1:p1', leased: true, status: 'quarantine' },
          'ws1:p1'
        )
      }).toThrow('status is invalid')

      expect(() => {
        parseTerminalControlStatusResponse(
          { ok: true, pane: 'ws1:p1', leased: true, status: 'unknown' },
          'ws1:p1'
        )
      }).toThrow('status is invalid')

      expect(() => {
        parseTerminalControlStatusResponse(
          { ok: true, pane: 'ws1:p1', leased: true, status: 123 },
          'ws1:p1'
        )
      }).toThrow('status is invalid')
    })

    it('throws error on inconsistent pairs: leased false with non-null status', () => {
      expect(() => {
        parseTerminalControlStatusResponse(
          { ok: true, pane: 'ws1:p1', leased: false, status: 'pending' },
          'ws1:p1'
        )
      }).toThrow('leased is false but status is not null')

      expect(() => {
        parseTerminalControlStatusResponse(
          { ok: true, pane: 'ws1:p1', leased: false, status: 'releasing' },
          'ws1:p1'
        )
      }).toThrow('leased is false but status is not null')
    })

    it('throws error on inconsistent pairs: leased true with status null', () => {
      expect(() => {
        parseTerminalControlStatusResponse(
          { ok: true, pane: 'ws1:p1', leased: true, status: null },
          'ws1:p1'
        )
      }).toThrow('leased is true but status is invalid')
    })

    it('throws error on malformed payload or non-true ok', () => {
      expect(() => {
        parseTerminalControlStatusResponse(null, 'ws1:p1')
      }).toThrow('must be a JSON object')

      expect(() => {
        parseTerminalControlStatusResponse([], 'ws1:p1')
      }).toThrow('must be a JSON object')

      expect(() => {
        parseTerminalControlStatusResponse('string', 'ws1:p1')
      }).toThrow('must be a JSON object')

      expect(() => {
        parseTerminalControlStatusResponse({ ok: false, error: 'fail' }, 'ws1:p1')
      }).toThrow('ok must be true')
    })
  })

  describe('resolveControlledPaneIdentity pure helper', () => {
    it('uses explicit override when provided', () => {
      const resolved = resolveControlledPaneIdentity('captured-1', 'fallback-2', 'override-3')
      expect(resolved).toBe('override-3')
    })

    it('preserves captured control pane ref when selected pane prop changes', () => {
      // User entered control on pane-A, then selected pane prop changed to pane-B
      const resolved = resolveControlledPaneIdentity('pane-A', 'pane-B')
      expect(resolved).toBe('pane-A')
    })

    it('falls back to current pane prop when no control pane was captured', () => {
      const resolved = resolveControlledPaneIdentity(null, 'pane-B')
      expect(resolved).toBe('pane-B')
    })

    it('returns undefined when neither captured nor fallback pane is available', () => {
      expect(resolveControlledPaneIdentity(null, null)).toBeUndefined()
      expect(resolveControlledPaneIdentity(undefined, undefined)).toBeUndefined()
    })

    it('never opens Control on a newly selected pane during a prop transition', () => {
      expect(resolveTerminalControlConnectionPane('control', false, 'w5N:pB')).toBe('w5N:pB')
      expect(resolveTerminalControlConnectionPane('control', false, null)).toBeNull()
      expect(resolveTerminalControlConnectionPane('observer', false, 'w5N:pB')).toBeNull()
      expect(resolveTerminalControlConnectionPane('control', true, 'w5N:pB')).toBeNull()
    })
  })

  describe('isLateControlOwnershipCallback pure helper', () => {
    it('returns false for idle or releasing ownership states', () => {
      expect(
        isLateControlOwnershipCallback({
          nextOwnership: 'idle',
          notifiedPaneId: 'ws1:p1',
          currentSelectedPaneId: 'ws1:p2',
          currentViewMode: 'stream'
        })
      ).toBe(false)

      expect(
        isLateControlOwnershipCallback({
          nextOwnership: 'releasing',
          notifiedPaneId: 'ws1:p1',
          currentSelectedPaneId: 'ws1:p2',
          currentViewMode: 'panel'
        })
      ).toBe(false)
    })

    it('returns true when engaging/active callback arrives for an unselected pane', () => {
      expect(
        isLateControlOwnershipCallback({
          nextOwnership: 'active',
          notifiedPaneId: 'ws1:pOld',
          currentSelectedPaneId: 'ws1:pNew',
          currentViewMode: 'stream'
        })
      ).toBe(true)

      expect(
        isLateControlOwnershipCallback({
          nextOwnership: 'engaging',
          notifiedPaneId: 'ws1:pOld',
          currentSelectedPaneId: 'ws1:pNew',
          currentViewMode: 'stream'
        })
      ).toBe(true)
    })

    it('returns true when engaging/active callback arrives while view is no longer stream', () => {
      expect(
        isLateControlOwnershipCallback({
          nextOwnership: 'active',
          notifiedPaneId: 'ws1:p1',
          currentSelectedPaneId: 'ws1:p1',
          currentViewMode: 'panel'
        })
      ).toBe(true)

      expect(
        isLateControlOwnershipCallback({
          nextOwnership: 'active',
          notifiedPaneId: 'ws1:p1',
          currentSelectedPaneId: 'ws1:p1',
          currentViewMode: 'history'
        })
      ).toBe(true)

      expect(
        isLateControlOwnershipCallback({
          nextOwnership: 'active',
          notifiedPaneId: 'ws1:p1',
          currentSelectedPaneId: 'ws1:p1',
          currentViewMode: 'question'
        })
      ).toBe(true)
    })

    it('returns false when engaging/active callback matches current pane in stream view', () => {
      expect(
        isLateControlOwnershipCallback({
          nextOwnership: 'active',
          notifiedPaneId: 'ws1:p1',
          currentSelectedPaneId: 'ws1:p1',
          currentViewMode: 'stream'
        })
      ).toBe(false)

      expect(
        isLateControlOwnershipCallback({
          nextOwnership: 'engaging',
          notifiedPaneId: 'ws1:p1',
          currentSelectedPaneId: 'ws1:p1',
          currentViewMode: 'stream'
        })
      ).toBe(false)
    })
  })

  describe('abort controller & generation ownership guarantees', () => {
    it('aborts active signal on stop/retire and ignores stale responses', () => {
      let generation = 0
      let activeController: AbortController | null = null

      const stop = () => {
        generation++
        if (activeController) {
          activeController.abort()
          activeController = null
        }
      }

      const start = () => {
        stop()
        const gen = generation
        const controller = new AbortController()
        activeController = controller
        return { gen, controller }
      }

      // Start gen 1
      const p1 = start()
      expect(p1.gen).toBe(1)
      expect(p1.controller.signal.aborted).toBe(false)

      // Start gen 2 before gen 1 finishes
      const p2 = start()
      expect(p2.gen).toBe(2)
      expect(p1.controller.signal.aborted).toBe(true)
      expect(p2.controller.signal.aborted).toBe(false)

      // Evaluation ignores stale gen 1 result
      const stepStale = evaluateControlStatusResponse({
        currentGeneration: p1.gen,
        activeGeneration: generation,
        targetPaneId: 'ws1:p1',
        statusResult: { ok: true, pane: 'ws1:p1', leased: false, status: null }
      })
      expect(stepStale).toEqual({ action: 'ignore_stale' })

      // Evaluation accepts active gen 2 result
      const stepActive = evaluateControlStatusResponse({
        currentGeneration: p2.gen,
        activeGeneration: generation,
        targetPaneId: 'ws1:p1',
        statusResult: { ok: true, pane: 'ws1:p1', leased: false, status: null }
      })
      expect(stepActive).toEqual({ action: 'transition_to_idle' })

      // Retiring gen 2 before idle
      stop()
      expect(generation).toBe(3)
      expect(p2.controller.signal.aborted).toBe(true)
    })
  })
})
