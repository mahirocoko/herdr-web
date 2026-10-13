import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { useHeldMessages } from '@/hooks/use-held-messages.ts'
import type { IActionTargetIdentity } from '@/types/herdr.ts'
import type { IHeldMessage } from '@/utils/held-messages.ts'
import { sameSubmissionTarget } from '@/utils/chat-submissions.ts'
import Button from './ui/button.tsx'
import './held-queue-stack.css'

export const isLiveHeldMessage = (record: IHeldMessage) =>
  !record.restored &&
  [
    'held',
    'enqueueing',
    'enqueue-unknown',
    'claimed',
    'sending',
    'discarding',
    'uncertain'
  ].includes(record.state)

// Preserve first-observed enqueue order even when the hook groups uncertain evidence before held rows.
// This only orders presentation; authority and delivery remain entirely with the hook.
export const heldQueueOrder = (records: IHeldMessage[], previous: string[]) => {
  const live = records.filter(isLiveHeldMessage)
  const byId = new Map(live.map((record) => [record.operationId, record]))
  const ids = previous.filter((id) => byId.has(id))
  const known = new Set(ids)
  for (const record of live) {
    if (!known.has(record.operationId)) ids.push(record.operationId)
  }
  return ids.map((id) => byId.get(id)!)
}

const isPending = (record: IHeldMessage) =>
  ['enqueueing', 'claimed', 'sending', 'discarding'].includes(record.state)

interface IHeldQueueStackProps {
  paneId: string | null
  actionTarget: IActionTargetIdentity | null
  held: ReturnType<typeof useHeldMessages>
  disabled?: boolean
  onInspectTerminal: () => void
}

export const heldQueueLabel = (record: IHeldMessage) => {
  switch (record.state) {
    case 'held':
      return 'Held in Web — send manually'
    case 'enqueueing':
      return 'Holding in Web…'
    case 'enqueue-unknown':
      return 'Enqueue outcome unknown — refresh evidence; do not enqueue again.'
    case 'claimed':
      return 'Held operation in progress — delivery not confirmed'
    case 'sending':
      return 'Submitting — native execution not confirmed'
    case 'discarding':
      return 'Discarding unsent Web-held text…'
    case 'uncertain':
      return 'Outcome uncertain — inspect Terminal; no retry'
    default:
      return record.state
  }
}

// Only the record's original owner callbacks are used; the selected target is a fence, never a replacement.
export const HeldQueueCard = ({
  record,
  actionTarget,
  held,
  disabled,
  expanded,
  onInspectTerminal
}: {
  record: IHeldMessage
  actionTarget: IActionTargetIdentity | null
  held: ReturnType<typeof useHeldMessages>
  disabled: boolean
  expanded: boolean
  onInspectTerminal: () => void
}) => {
  const mutable =
    !record.restored && record.state === 'held' && Boolean(record.heldId)
  const matching = sameSubmissionTarget(record.target, actionTarget)
  return (
    <article className="held-queue-card" aria-label="Web-held intent">
      <div className="held-queue-card__body">
        <p
          className={`held-queue-card__text${expanded ? ' is-expanded' : ''}`}
          tabIndex={expanded ? undefined : 0}
        >
          {record.text}
        </p>
        <p className="held-queue-card__status" role="status">
          {heldQueueLabel(record)}
        </p>
        {!matching && (
          <p className="held-queue-card__status">
            Captured target/session differs or is unavailable. Send is
            unavailable.
          </p>
        )}
        {record.state === 'held' && matching && (
          <p className="held-queue-card__status">
            Submit now; does not guarantee native interruption.
          </p>
        )}
        {record.error && (
          <p className="held-queue-card__status" role="alert">
            {record.error}
          </p>
        )}
      </div>
      <div
        className="held-queue-card__actions"
        aria-label="Held intent controls"
      >
        {mutable && matching && (
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => void held.send(record)}
          >
            Send now
          </Button>
        )}
        {mutable && (
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => void held.discard(record)}
          >
            Discard
          </Button>
        )}
        {!record.restored && (!mutable || record.error) && (
          <Button
            variant="ghost"
            disabled={isPending(record)}
            onClick={() => void held.refresh(record)}
          >
            Refresh held evidence (read only)
          </Button>
        )}
        {record.state === 'uncertain' && (
          <Button variant="ghost" onClick={onInspectTerminal}>
            Inspect Terminal
          </Button>
        )}
        {record.state === 'uncertain' && (
          <Button variant="ghost" onClick={() => held.dismiss(record)}>
            Dismiss saved copy
          </Button>
        )}
      </div>
    </article>
  )
}

const HeldQueueStack = ({
  paneId,
  actionTarget,
  held,
  disabled = false,
  onInspectTerminal
}: IHeldQueueStackProps) => {
  const [expandedPane, setExpandedPane] = useState<string | null>(null)
  const listId = useId()
  const orderRef = useRef<string[]>([])
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const focusedRef = useRef<HTMLElement | null>(null)
  const ordered = heldQueueOrder(held.records, orderRef.current)
  const records = ordered.filter((record) => record.target.paneId === paneId)
  useLayoutEffect(() => {
    orderRef.current = ordered.map((record) => record.operationId)
  }, [ordered])
  const expanded = expandedPane === paneId && records.length > 1
  const mutationsDisabled = disabled || records.some(isPending)
  const heldCount = records.filter((record) => record.state === 'held').length
  useEffect(() => setExpandedPane(null), [paneId])
  useLayoutEffect(() => {
    const previous = focusedRef.current
    if (
      previous &&
      (!previous.isConnected ||
        (previous instanceof HTMLButtonElement && previous.disabled))
    ) {
      // Clear before focus() so the next stack control's focus capture survives.
      focusedRef.current = null
      // Do not steal a draft's caret when a background record settles.
      if (document.activeElement === document.body) {
        const next =
          toggleRef.current ??
          document.querySelector<HTMLTextAreaElement>(
            '.prompt-composer textarea'
          )
        next?.focus()
      }
    }
  })
  if (!records.length) return null
  return (
    <section
      className={`held-queue-stack${records.length > 1 && !expanded ? ' is-stacked' : ''}`}
      aria-label="Web-held queue"
      onFocusCapture={(event) => {
        focusedRef.current = event.target as HTMLElement
      }}
    >
      {records.length > 1 && !expanded && (
        <>
          <div className="held-queue-stack__back" aria-hidden="true" />
          {records.length > 2 && (
            <div
              className="held-queue-stack__back held-queue-stack__back--far"
              aria-hidden="true"
            />
          )}
        </>
      )}
      <div className="held-queue-stack__surface">
        <div className="held-queue-stack__heading">
          <span>
            {heldCount
              ? `Web-held queue · ${heldCount} held${heldCount < records.length ? ` · ${records.length - heldCount} unresolved` : ''}`
              : `Web-held problems · ${records.length} unresolved`}
          </span>
          {records.length > 1 && (
            <Button
              ref={toggleRef}
              variant="ghost"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpandedPane(expanded ? null : paneId)}
            >
              {expanded ? 'Collapse' : `Show all ${records.length}`}
            </Button>
          )}
        </div>
        <div
          id={listId}
          className={
            expanded ? 'held-queue-stack__list' : 'held-queue-stack__front'
          }
          role={expanded ? 'region' : undefined}
          aria-label={
            expanded ? 'All Web-held intents, oldest first' : undefined
          }
        >
          {(expanded ? records : records.slice(0, 1)).map((record) => (
            <HeldQueueCard
              key={record.operationId}
              record={record}
              actionTarget={actionTarget}
              held={held}
              disabled={mutationsDisabled}
              expanded={expanded}
              onInspectTerminal={onInspectTerminal}
            />
          ))}
        </div>
        {held.storageError && (
          <p className="held-queue-card__status" role="alert">
            {held.storageError}
          </p>
        )}
      </div>
    </section>
  )
}

export default HeldQueueStack
