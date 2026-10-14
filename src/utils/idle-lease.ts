// MIT License - Copyright (c) 2026 devswha; Copyright (c) 2026 T3 Tools Inc.
// Adapted from dc2f11de src/lib/idleLease.ts; shared diff-worker lifetime only.
export interface IIdleLeaseTimers {
  set: (run: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}
interface IEntry<T> {
  value: T
  holders: number
  idle: unknown
}
const timers: IIdleLeaseTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}
export const createIdleLease = <T>(
  create: () => T,
  dispose: (value: T) => void,
  idleMs: number,
  clock: IIdleLeaseTimers = timers
) => {
  let entry: IEntry<T> | undefined
  const armIdle = (held: IEntry<T>) => {
    if (held.idle !== undefined) clock.clear(held.idle)
    held.idle = clock.set(() => {
      held.idle = undefined
      if (held.holders > 0) return
      if (entry === held) entry = undefined
      dispose(held.value)
    }, idleMs)
  }
  const ensure = (): IEntry<T> => {
    if (entry !== undefined) return entry
    const made = { value: create(), holders: 0, idle: undefined }
    entry = made
    armIdle(made)
    return made
  }
  return {
    get: () => ensure().value,
    hold() {
      const held = ensure()
      if (held.idle !== undefined) {
        clock.clear(held.idle)
        held.idle = undefined
      }
      held.holders++
      let released = false
      return () => {
        if (released) return
        released = true
        held.holders--
        if (held.holders === 0) armIdle(held)
      }
    },
    current: () => entry?.value
  }
}
