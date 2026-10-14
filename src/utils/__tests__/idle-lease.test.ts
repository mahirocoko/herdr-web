// MIT License - Copyright (c) 2026 devswha
// Adapted from dc2f11de idleLease.test.ts.
import { describe, expect, test } from 'bun:test'
import { createIdleLease, type IIdleLeaseTimers } from '../idle-lease.ts'
const setup = () => {
  let next = 0,
    made = 0
  const queued = new Map<number, () => void>(),
    disposed: number[] = []
  const clock: IIdleLeaseTimers = {
    set: (run) => {
      queued.set(++next, run)
      return next
    },
    clear: (handle) => {
      queued.delete(handle as number)
    }
  }
  const fire = () => {
    const runs = [...queued.values()]
    queued.clear()
    runs.forEach((run) => run())
  }
  const lease = createIdleLease(
    () => ++made,
    (value) => disposed.push(value),
    30_000,
    clock
  )
  return { lease, disposed, fire, pending: () => queued.size, made: () => made }
}
describe('upstream shared diff-worker idle lifetime', () => {
  test('resource is lazy and shared', () => {
    const s = setup()
    expect(s.lease.current()).toBeUndefined()
    expect(s.made()).toBe(0)
    expect(s.lease.get()).toBe(1)
    s.lease.hold()
    s.lease.hold()
    expect(s.lease.get()).toBe(1)
    expect(s.made()).toBe(1)
  })
  test('last holder arms one disposal and reopen remains warm', () => {
    const s = setup()
    s.lease.get()
    const a = s.lease.hold(),
      b = s.lease.hold()
    a()
    a()
    expect(s.pending()).toBe(0)
    b()
    expect(s.pending()).toBe(1)
    const c = s.lease.hold()
    s.fire()
    expect(s.disposed).toEqual([])
    expect(s.lease.get()).toBe(1)
    c()
    s.fire()
    expect(s.disposed).toEqual([1])
    expect(s.lease.current()).toBeUndefined()
    expect(s.lease.get()).toBe(2)
  })
  test('a discarded render with no effect hold cannot leak', () => {
    const s = setup()
    s.lease.get()
    s.fire()
    expect(s.disposed).toEqual([1])
  })
})
