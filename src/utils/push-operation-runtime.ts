export type PushOperationKind =
  | 'inspection'
  | 'enable'
  | 'disable'
  | 'rotation'
  | 'rollback'
  | 'sync-cleanup'
  | 'test'

export type PushOperationPhase = 'inspecting' | 'mutating' | 'settling' | 'pending' | 'complete'
export type PushOperationOwnership = 'inspection' | 'exclusive'

export interface IPushOperationSnapshot {
  isBusy: boolean
  isOperationPending: boolean
  error: string | null
}

export interface IPushOperationTicket<TSnapshot extends IPushOperationSnapshot = IPushOperationSnapshot> {
  readonly id: number
  kind: PushOperationKind
  phase: PushOperationPhase
  ownership: PushOperationOwnership
  snapshot: TSnapshot
  readonly startedAt: number
  readonly deadlineAt: number
}

export interface IPushOperationAdmission<TSnapshot extends IPushOperationSnapshot> {
  ticket: IPushOperationTicket<TSnapshot>
  admitted: boolean
}

const pendingMessage = 'Push operation is still pending in this browser. Reload to inspect its current state.'

export const createPushOperationRuntime = <TSnapshot extends IPushOperationSnapshot>(
  initialSnapshot: TSnapshot,
  deadlineMs = 10000
) => {
  let nextId = 1
  let current: IPushOperationTicket<TSnapshot> | null = null
  let latest = { ...initialSnapshot }
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null
  const observers = new Map<number, Set<(snapshot: TSnapshot) => void>>()

  const clearDeadline = () => {
    if (deadlineTimer !== null) clearTimeout(deadlineTimer)
    deadlineTimer = null
  }

  const isOwner = (ticket: IPushOperationTicket<TSnapshot>) => current?.id === ticket.id

  const notify = (ticket: IPushOperationTicket<TSnapshot>) => {
    for (const observer of observers.get(ticket.id) || []) observer(ticket.snapshot)
  }

  const publish = (ticket: IPushOperationTicket<TSnapshot>, patch: Partial<TSnapshot>): boolean => {
    if (!isOwner(ticket)) return false
    ticket.snapshot = { ...ticket.snapshot, ...patch }
    latest = ticket.snapshot
    notify(ticket)
    return true
  }

  const armDeadline = (ticket: IPushOperationTicket<TSnapshot>) => {
    clearDeadline()
    deadlineTimer = setTimeout(() => {
      if (!isOwner(ticket) || ticket.phase === 'complete') return
      ticket.phase = 'pending'
      publish(ticket, {
        isBusy: false,
        isOperationPending: true,
        error: pendingMessage
      } as Partial<TSnapshot>)
    }, deadlineMs)
  }

  const admit = (
    kind: PushOperationKind,
    ownership: PushOperationOwnership
  ): IPushOperationAdmission<TSnapshot> => {
    if (current?.ownership === 'exclusive') return { ticket: current, admitted: false }
    if (current) {
      clearDeadline()
      observers.delete(current.id)
    }
    const now = Date.now()
    current = {
      id: nextId++,
      kind,
      ownership,
      phase: ownership === 'exclusive' ? 'mutating' : 'inspecting',
      snapshot: { ...latest, isBusy: true, isOperationPending: false, error: null },
      startedAt: now,
      deadlineAt: now + deadlineMs
    }
    latest = current.snapshot
    armDeadline(current)
    return { ticket: current, admitted: true }
  }

  const admitExclusive = (kind: Exclude<PushOperationKind, 'inspection'>) => admit(kind, 'exclusive')
  const admitInspection = () => admit('inspection', 'inspection')

  const upgradeToExclusive = (
    ticket: IPushOperationTicket<TSnapshot>,
    kind: Exclude<PushOperationKind, 'inspection'>
  ): boolean => {
    if (!isOwner(ticket) || ticket.ownership !== 'inspection') return false
    ticket.ownership = 'exclusive'
    ticket.kind = kind
    ticket.phase = 'mutating'
    return true
  }

  const complete = (ticket: IPushOperationTicket<TSnapshot>, patch: Partial<TSnapshot> = {}): boolean => {
    if (!isOwner(ticket)) return false
    ticket.phase = 'complete'
    publish(ticket, {
      ...patch,
      isBusy: false,
      isOperationPending: false
    } as Partial<TSnapshot>)
    clearDeadline()
    if (current?.id === ticket.id) current = null
    observers.delete(ticket.id)
    return true
  }

  const observe = (
    ticket: IPushOperationTicket<TSnapshot>,
    observer: (snapshot: TSnapshot) => void
  ): (() => void) => {
    if (!isOwner(ticket)) {
      observer(latest)
      return () => {}
    }
    const ticketObservers = observers.get(ticket.id) || new Set()
    ticketObservers.add(observer)
    observers.set(ticket.id, ticketObservers)
    observer(ticket.snapshot)
    return () => {
      ticketObservers.delete(observer)
      if (ticketObservers.size === 0) observers.delete(ticket.id)
    }
  }

  const resetForTests = () => {
    clearDeadline()
    current = null
    latest = { ...initialSnapshot }
    observers.clear()
    nextId = 1
  }

  return {
    admitExclusive,
    admitInspection,
    upgradeToExclusive,
    publish,
    complete,
    observe,
    isOwner,
    currentTicket: () => current,
    snapshot: () => latest,
    resetForTests
  }
}
