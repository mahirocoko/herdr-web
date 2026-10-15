import { useCallback, useEffect, useRef, useState } from 'react'
import {
  restoreSubmissions,
  submissionFailure,
  type IChatSubmission,
  type ISubmissionBaseline
} from '@/utils/chat-submissions.ts'
import type { IActionTargetIdentity } from '@/types/herdr.ts'

const STORAGE_KEY = 'herdr_chat_submission_evidence_v1'

/** Root owns evidence across routes. No method here submits or retries an action. */
export const useChatSubmissions = () => {
  const [records, setRecords] = useState<IChatSubmission[]>([])
  const [storageError, setStorageError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const generation = useRef<string | null>(null)
  const baselines = useRef(
    new Map<
      string,
      { target: IActionTargetIdentity; baseline: ISubmissionBaseline | null }
    >()
  )
  useEffect(() => {
    generation.current = crypto.randomUUID()
    try {
      setRecords(restoreSubmissions(localStorage.getItem(STORAGE_KEY)))
    } catch {
      setStorageError('Submission evidence cannot be restored in this browser.')
    }
    setLoaded(true)
  }, [])
  useEffect(() => {
    if (!loaded) return
    try {
      const raw = JSON.stringify(records)
      if (
        records.length > 128 ||
        new TextEncoder().encode(raw).byteLength > 1024 * 1024
      )
        throw new Error('Evidence limit')
      localStorage.setItem(STORAGE_KEY, raw)
    } catch {
      setStorageError(
        'Submission evidence remains visible now but cannot be saved for reload.'
      )
    }
  }, [loaded, records])
  const observe = useCallback(
    (target: IActionTargetIdentity, baseline: ISubmissionBaseline | null) => {
      baselines.current.set(target.paneId, { target: { ...target }, baseline })
    },
    []
  )
  const begin = (
    operationId: string,
    text: string,
    target: IActionTargetIdentity
  ) => {
    const observed = baselines.current.get(target.paneId)
    const baseline =
      observed &&
      observed.target.terminalId === target.terminalId &&
      observed.target.agentSessionId === target.agentSessionId
        ? observed.baseline
        : null
    setRecords((previous) => [
      ...previous.slice(-127),
      {
        operationId,
        text,
        target: { ...target },
        generation: generation.current ?? 'uninitialized',
        submittedAt: new Date().toISOString(),
        baseline,
        phase: 'sending'
      }
    ])
  }
  const settle = (
    operationId: string,
    phase: IChatSubmission['phase'],
    error?: unknown
  ) => {
    const failure = phase === 'rejected' ? submissionFailure(error) : undefined
    setRecords((previous) =>
      previous.map((record) =>
        record.operationId === operationId
          ? { ...record, phase, failure }
          : record
      )
    )
  }
  const clear = () => {
    setRecords([])
    setStorageError(null)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      setStorageError('Saved evidence could not be cleared in this browser.')
    }
  }
  return { records, storageError, observe, begin, settle, clear }
}
