import { useCallback, useReducer, useRef } from 'react'
import { ActionError, sendAction } from '@/services/api-client.ts'
import type { IActionResponse, ILifecycleActionRequest } from '@/types/herdr.ts'
import {
  boundLifecycleMessage,
  getLifecycleUnknownCopy,
  initialLifecycleState,
  lifecycleReducer,
  type ILifecycleTicket
} from '@/utils/lifecycle-operations.ts'

const freezeTarget = (request: ILifecycleActionRequest): Readonly<Record<string, unknown>> => {
  if (request.type === 'workspace-create') {
    const target: Record<string, string> = request.source
      ? {
          workspaceId: request.source.workspaceId,
          paneId: request.source.paneId,
          terminalId: request.source.terminalId
        }
      : {}
    return Object.freeze(target)
  }
  if (request.type === 'workspace-close') {
    return Object.freeze({
      workspaceId: request.target.workspaceId,
      expected: Object.freeze({
        tabIds: Object.freeze([...request.target.expected.tabIds]),
        paneIds: Object.freeze([...request.target.expected.paneIds])
      })
    })
  }
  return Object.freeze({
    workspaceId: request.target.workspaceId,
    tabId: request.target.tabId,
    expected: Object.freeze({
      paneIds: Object.freeze([...request.target.expected.paneIds])
    })
  })
}

const projectLifecycleResult = (
  request: ILifecycleActionRequest,
  response: IActionResponse
): IActionResponse['result'] => {
  if (request.type === 'workspace-create') {
    return {
      workspaceId: response.result?.workspaceId,
      tabId: response.result?.tabId,
      paneId: response.result?.paneId
    }
  }
  if (request.type === 'workspace-close') {
    return { workspaceId: response.result?.workspaceId }
  }
  return {
    workspaceId: response.result?.workspaceId,
    tabId: response.result?.tabId
  }
}

export const useLifecycleOperations = () => {
  const [state, dispatch] = useReducer(lifecycleReducer, initialLifecycleState)
  const stateRef = useRef(state)
  stateRef.current = state

  const dispatchLifecycle = useCallback(async (
    request: ILifecycleActionRequest
  ): Promise<{ accepted: boolean; requestIdentity?: string; response?: IActionResponse }> => {
    if (stateRef.current.ticket && stateRef.current.ticket.phase !== 'rejected') {
      return { accepted: false }
    }

    const requestIdentity = crypto.randomUUID()
    const ticket: ILifecycleTicket = Object.freeze({
      requestIdentity,
      operationId: request.operationId,
      type: request.type,
      target: freezeTarget(request),
      phase: 'pending',
      reconciliationAttempt: 0,
      error: null,
      result: null
    })
    stateRef.current = { ticket, latestRequestIdentity: requestIdentity }
    dispatch({ type: 'BEGIN', ticket })

    try {
      const response = await sendAction(request)
      const phase = response.outcome === 'observed' ? 'observed' : 'unknown'
      dispatch({
        type: 'SETTLE',
        requestIdentity,
        phase,
        error: phase === 'unknown' ? getLifecycleUnknownCopy(request.type) : null,
        result: projectLifecycleResult(request, response)
      })
      return { accepted: true, requestIdentity, response }
    } catch (err) {
      const isUnknown = err instanceof ActionError && err.outcome === 'unknown'
      dispatch({
        type: 'SETTLE',
        requestIdentity,
        phase: isUnknown ? 'unknown' : 'rejected',
        error: isUnknown
          ? getLifecycleUnknownCopy(request.type)
          : boundLifecycleMessage(err instanceof Error ? err.message : err, 'Lifecycle action was rejected')
      })
      return { accepted: true, requestIdentity }
    }
  }, [])

  const clearUnknownAfterRefresh = useCallback(() => {
    dispatch({ type: 'CLEAR_UNKNOWN_AFTER_REFRESH' })
  }, [])

  const clearObserved = useCallback((requestIdentity: string) => {
    dispatch({ type: 'CLEAR_OBSERVED', requestIdentity })
  }, [])

  const reportReconciliationFailure = useCallback((requestIdentity: string, attempt: number, error: string) => {
    dispatch({ type: 'RECONCILE_FAILED', requestIdentity, attempt, error })
  }, [])

  const retryReconciliation = useCallback((requestIdentity: string) => {
    dispatch({ type: 'RETRY_RECONCILIATION', requestIdentity })
  }, [])

  return {
    ticket: state.ticket,
    isBusy: state.ticket?.phase === 'pending' || state.ticket?.phase === 'observed',
    dispatchLifecycle,
    clearUnknownAfterRefresh,
    clearObserved,
    reportReconciliationFailure,
    retryReconciliation
  }
}

export type ILifecycleOperations = ReturnType<typeof useLifecycleOperations>
