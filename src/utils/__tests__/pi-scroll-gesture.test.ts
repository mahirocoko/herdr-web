import { describe, it, expect } from 'bun:test'
import { PiScrollGestureOwner } from '../pi-scroll-gesture.ts'
const binding = {
  fitGeneration: 1,
  target: {
    paneId: 'w1:p1',
    terminalId: 'term1',
    expectedMode: 'agent' as const,
    agentSessionId: '/native/session.jsonl'
  }
}
describe('Pi gesture owner', () => {
  it('jumps to latest through the same bound single-flight owner and clears wheel residual', async () => {
    const calls: string[] = []
    let release!: () => void
    let now = 0
    const owner = new PiScrollGestureOwner(
      async (_binding, direction) => {
        calls.push(direction)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      },
      () => now
    )
    expect(owner.latest()).toBe(false)
    owner.setBinding(binding)
    owner.scroll(2)
    expect(owner.latest()).toBe(true)
    owner.latest()
    owner.scroll(30)
    expect(calls).toEqual(['latest'])
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))
    now = 1000
    owner.scroll(1)
    expect(calls).toEqual(['latest'])
  })
  it('does not retry an uncertain latest action', async () => {
    let calls = 0
    const owner = new PiScrollGestureOwner(async () => {
      calls++
      throw new Error('response lost')
    })
    owner.setBinding(binding)
    owner.latest()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(owner.latest()).toBe(false)
    expect(calls).toBe(1)
  })
  it('leaves non-Pi gestures with native history and thresholds Pi only', async () => {
    const calls: string[] = []
    const owner = new PiScrollGestureOwner(async (_binding, direction) => {
      calls.push(direction)
    })
    expect(owner.scroll(10)).toBe(false)
    owner.setBinding(binding)
    owner.scroll(1)
    owner.scroll(1)
    expect(calls).toEqual([])
    owner.scroll(1)
    expect(calls).toEqual(['up'])
  })
  it('drops in-flight residual and selection/session residual without replay', async () => {
    let release!: () => void
    let now = 0
    const calls: string[] = []
    const owner = new PiScrollGestureOwner(
      async (_binding, direction) => {
        calls.push(direction)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      },
      () => now
    )
    owner.setBinding(binding)
    owner.scroll(3)
    owner.scroll(100)
    expect(calls).toEqual(['up'])
    owner.setBinding({ ...binding, fitGeneration: 2 })
    owner.scroll(100)
    release()
    await new Promise((resolve) => queueMicrotask(resolve))
    now = 1000
    owner.scroll(1)
    owner.resetResidual()
    owner.scroll(2)
    expect(calls).toEqual(['up'])
    owner.setBinding(null)
    expect(owner.scroll(10)).toBe(false)
  })
  it('does not retry an uncertain dispatch and disables until explicit rebind', async () => {
    let calls = 0
    const owner = new PiScrollGestureOwner(async () => {
      calls++
      throw new Error('response lost')
    })
    owner.setBinding(binding)
    owner.scroll(-3)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(owner.scroll(-100)).toBe(false)
    expect(calls).toBe(1)
  })
})
