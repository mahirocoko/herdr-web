import { useEffect, useRef, useState } from 'react'
import {
  ActionError,
  readHeldMessages,
  sendAction
} from '@/services/api-client.ts'
import type { IActionTargetIdentity } from '@/types/herdr.ts'
import { sameSubmissionTarget } from '@/utils/chat-submissions.ts'
import {
  heldProjection,
  restoreHeldMessages,
  saveHeldMessages,
  type IHeldMessage
} from '@/utils/held-messages.ts'
const STORAGE_KEY = 'herdr_held_information_v1'
/** Root document authority stays in memory only. Saved projections never regain authority. */
export const useHeldMessages = () => {
  const capability = useRef<string | null>(null)
  const active = useRef(new Set<string>())
  const live = useRef<IHeldMessage[]>([])
  const [records, setRecords] = useState<IHeldMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)
  const update = (change: (previous: IHeldMessage[]) => IHeldMessage[]) => {
    const next = change(live.current)
    const protectedRows = next.filter(
      (item) =>
        !item.restored &&
        [
          'held',
          'enqueueing',
          'enqueue-unknown',
          'claimed',
          'sending',
          'discarding'
        ].includes(item.state)
    )
    const informational = next
      .filter((item) => !protectedRows.includes(item))
      .slice(-(128 - protectedRows.length))
    live.current = [...informational, ...protectedRows]
    setRecords(live.current)
  }
  useEffect(() => {
    try {
      update(() => restoreHeldMessages(localStorage.getItem(STORAGE_KEY)))
    } catch {
      setStorageError('Held informational evidence could not be restored.')
    }
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(STORAGE_KEY, saveHeldMessages(records))
    } catch {
      setStorageError(
        'Held text remains visible here but could not be saved for reload.'
      )
    }
  }, [loaded, records])
  const secret = () => {
    if (!capability.current)
      capability.current = Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        (byte) => byte.toString(16).padStart(2, '0')
      ).join('')
    return capability.current
  }
  const patch = (operationId: string, fields: Partial<IHeldMessage>) =>
    update((previous) =>
      previous.map((item) =>
        item.operationId === operationId && !item.restored
          ? { ...item, ...fields }
          : item
      )
    )
  const enqueue = async (text: string, target: IActionTargetIdentity) => {
    if (
      live.current.some(
        (item) =>
          !item.restored &&
          ['enqueueing', 'enqueue-unknown', 'claimed'].includes(item.state) &&
          sameSubmissionTarget(item.target, target)
      )
    )
      throw new Error(
        'An enqueue outcome is unresolved for this target. Refresh held evidence; do not enqueue again.'
      )
    if (
      live.current.filter(
        (item) =>
          !item.restored &&
          [
            'held',
            'enqueueing',
            'enqueue-unknown',
            'claimed',
            'sending',
            'discarding'
          ].includes(item.state)
      ).length >= 32
    )
      throw new Error(
        'This document already has 32 held or unresolved intents; resolve them before adding more.'
      )
    const operationId = crypto.randomUUID()
    update((previous) => [
      ...previous,
      { operationId, text, target: { ...target }, state: 'enqueueing' }
    ])
    try {
      const response = await sendAction(
        { type: 'held-enqueue', operationId, text, target },
        secret()
      )
      const heldId = response.result?.heldId
      if (
        typeof heldId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(heldId) ||
        response.result?.state !== 'held'
      )
        throw new Error(
          'Held enqueue receipt unavailable; refresh informational evidence'
        )
      patch(operationId, { heldId, state: 'held' })
    } catch (error) {
      patch(operationId, {
        state:
          error instanceof ActionError && error.outcome === 'rejected'
            ? 'rejected'
            : 'enqueue-unknown',
        error:
          error instanceof Error ? error.message : 'Enqueue outcome unknown'
      })
      throw error
    }
  }
  const refresh = async (record: IHeldMessage) => {
    if (record.restored || active.current.has(record.operationId)) return
    active.current.add(record.operationId)
    try {
      const rows = await readHeldMessages([record.operationId], secret())
      const found = rows
        .map(heldProjection)
        .find(
          (item) =>
            item?.operationId === record.operationId &&
            item.text === record.text &&
            sameSubmissionTarget(item.target, record.target)
        )
      if (found)
        patch(record.operationId, {
          heldId: found.heldId,
          state: found.state,
          error: undefined
        })
      else
        patch(record.operationId, {
          error:
            'No matching held evidence available. This is not proof of cancellation; no delivery or new enqueue was attempted.'
        })
    } catch (error) {
      patch(record.operationId, {
        error:
          error instanceof Error ? error.message : 'Held evidence unavailable'
      })
    } finally {
      active.current.delete(record.operationId)
    }
  }
  const act = async (
    record: IHeldMessage,
    type: 'held-send' | 'held-discard'
  ) => {
    if (
      record.restored ||
      record.state !== 'held' ||
      !record.heldId ||
      active.current.has(record.operationId)
    )
      return
    active.current.add(record.operationId)
    patch(record.operationId, {
      state: type === 'held-send' ? 'sending' : 'discarding',
      error: undefined
    })
    try {
      const response = await sendAction(
        { type, operationId: crypto.randomUUID(), heldId: record.heldId },
        secret()
      )
      patch(record.operationId, {
        state:
          response.result?.state ===
          (type === 'held-send' ? 'consumed' : 'discarded')
            ? type === 'held-send'
              ? 'consumed'
              : 'discarded'
            : 'uncertain'
      })
    } catch (error) {
      const state =
        error instanceof ActionError && error.outcome === 'rejected'
          ? typeof error.result?.state === 'string'
            ? error.result.state
            : error.status === 404
              ? 'invalidated'
              : 'held'
          : 'uncertain'
      patch(record.operationId, {
        state,
        error:
          error instanceof Error
            ? error.message
            : 'Outcome uncertain; inspect Terminal'
      })
    } finally {
      active.current.delete(record.operationId)
    }
  }
  const dismiss = (record: IHeldMessage) => {
    if (
      record.restored ||
      [
        'rejected',
        'consumed',
        'discarded',
        'invalidated',
        'uncertain'
      ].includes(record.state)
    )
      update((previous) => previous.filter((item) => item !== record))
  }
  return {
    records,
    storageError,
    enqueue,
    refresh,
    dismiss,
    send: (record: IHeldMessage) => act(record, 'held-send'),
    discard: (record: IHeldMessage) => act(record, 'held-discard')
  }
}
