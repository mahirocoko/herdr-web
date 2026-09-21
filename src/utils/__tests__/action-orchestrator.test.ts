import { describe, expect, it } from 'bun:test'
import { executeGuardedAction } from '../action-orchestrator.ts'

describe('executeGuardedAction', () => {
  it('returns acknowledged, sets isBusy to true during action, and resets isBusy to false immediately upon action completion', async () => {
    let busyState = false
    let errorState: string | null = null
    const stateTransitions: boolean[] = []

    const result = await executeGuardedAction({
      action: async () => {
        stateTransitions.push(busyState)
        return 'ok'
      },
      getIsBusy: () => busyState,
      setIsBusy: (busy) => {
        busyState = busy
        stateTransitions.push(busy)
      },
      setError: (err) => {
        errorState = err
      }
    })

    expect(result).toBe('acknowledged')
    // Transitions: [true (set), true (read inside action), false (reset in finally)]
    expect(stateTransitions).toEqual([true, true, false])
    expect(busyState).toBe(false)
    expect(errorState).toBeNull()
  })

  it('acknowledged send settles before detached background refresh finishes', async () => {
    let busyState = false
    let refreshSettled = false
    let actionSettled = false

    const refreshPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        refreshSettled = true
        resolve()
      }, 50)
    })

    const result = await executeGuardedAction({
      action: async () => {
        actionSettled = true
        return 'action-ack'
      },
      onSuccessRefresh: () => refreshPromise,
      getIsBusy: () => busyState,
      setIsBusy: (busy) => {
        busyState = busy
      },
      setError: () => {}
    })

    // Returns finite 'acknowledged' status immediately
    expect(result).toBe('acknowledged')
    expect(actionSettled).toBe(true)
    // Background refresh has NOT finished yet
    expect(refreshSettled).toBe(false)
    // And isBusy is already false, enabling the user to type and send again
    expect(busyState).toBe(false)

    // Await background refresh to clean up
    await refreshPromise
    expect(refreshSettled).toBe(true)
  })

  it('background refresh rejection does NOT fail or reject the acknowledged action', async () => {
    let busyState = false
    let errorState: string | null = null

    // executeGuardedAction should resolve with 'acknowledged' despite refresh rejection
    const result = await executeGuardedAction({
      action: async () => 'ack',
      onSuccessRefresh: async () => {
        throw new Error('Network failure during background snapshot poll')
      },
      getIsBusy: () => busyState,
      setIsBusy: (busy) => {
        busyState = busy
      },
      setError: (err) => {
        errorState = err
      }
    })

    expect(result).toBe('acknowledged')

    // Wait a microtask turn for background detached promise
    await new Promise((r) => setTimeout(r, 10))

    expect(busyState).toBe(false)
    // Refresh failure must not populate errorState (which is reserved for action failure)
    expect(errorState).toBeNull()
  })

  it('action failure sets error, resets isBusy, rethrows, and skips background refresh', async () => {
    let busyState = false
    let errorState: string | null = null
    let refreshCalled = false

    await expect(
      executeGuardedAction({
        action: async () => {
          throw new Error('Herdr daemon rejected input')
        },
        onSuccessRefresh: () => {
          refreshCalled = true
        },
        getIsBusy: () => busyState,
        setIsBusy: (busy) => {
          busyState = busy
        },
        setError: (err) => {
          errorState = err
        }
      })
    ).rejects.toThrow('Herdr daemon rejected input')

    expect(busyState).toBe(false)
    expect(errorState as string | null).toBe('Herdr daemon rejected input')
    expect(refreshCalled).toBe(false)
  })

  it('returns skipped_busy when already busy, without executing action or setting false action error', async () => {
    let actionCount = 0
    let busyState = true // already busy
    let errorState: string | null = null
    let refreshCalled = false

    const result = await executeGuardedAction({
      action: async () => {
        actionCount++
      },
      onSuccessRefresh: () => {
        refreshCalled = true
      },
      getIsBusy: () => busyState,
      setIsBusy: (busy) => {
        busyState = busy
      },
      setError: (err) => {
        errorState = err
      }
    })

    // Returns finite 'skipped_busy' result
    expect(result).toBe('skipped_busy')
    // Action was not executed
    expect(actionCount).toBe(0)
    // Busy state left intact
    expect(busyState).toBe(true)
    // No false error is set
    expect(errorState).toBeNull()
    // No background refresh is called
    expect(refreshCalled).toBe(false)
  })
})
