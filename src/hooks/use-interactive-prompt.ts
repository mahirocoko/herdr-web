import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActionError,
  fetchInteractivePrompt,
  sendAction
} from '../services/api-client.ts'
import type { IActionTargetIdentity } from '../types/herdr.ts'
import type {
  IInteractivePrompt,
  PromptAnswerIntent
} from '../types/interactive-prompt.ts'

export const useInteractivePrompt = (
  target: IActionTargetIdentity | undefined,
  enabled: boolean
) => {
  const bind = (value: IActionTargetIdentity | undefined) =>
    JSON.stringify(
      value
        ? [
            value.paneId,
            value.terminalId,
            value.expectedMode,
            value.agentSessionId ?? null
          ]
        : null
    )
  const binding = bind(target)
  const currentBinding = useRef(binding)
  currentBinding.current = binding
  const generation = useRef(0)
  const answering = useRef(false)
  const quarantine = useRef<string | null>(null)
  const [unknownBinding, setUnknownBinding] = useState<string | null>(null)
  const [state, setState] = useState<{
    binding: string
    prompt: IInteractivePrompt | null
    target: IActionTargetIdentity
    suggestion: string | null
    error: string | null
  } | null>(null)
  const refresh = useCallback(
    async (manual = false) => {
      if (
        !target ||
        !enabled ||
        answering.current ||
        (!manual && quarantine.current === binding)
      )
        return
      if (manual) {
        setState(null)
        quarantine.current = null
        setUnknownBinding(null)
      }
      const turn = ++generation.current
      try {
        const read = await fetchInteractivePrompt(target.paneId)
        if (
          turn !== generation.current ||
          currentBinding.current !== binding ||
          answering.current
        )
          return
        if (bind(read.target) !== binding) {
          setState(null)
          return
        }
        setState({
          binding,
          prompt: read.prompt,
          target: read.target,
          suggestion: read.suggestion,
          error: null
        })
      } catch (error) {
        if (turn === generation.current && currentBinding.current === binding)
          setState({
            binding,
            prompt: null,
            target,
            suggestion: null,
            error:
              error instanceof Error ? error.message : 'Prompt read unavailable'
          })
      }
    },
    [binding, enabled]
  )
  useEffect(() => {
    generation.current++
    setState(null)
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 2000)
    return () => {
      generation.current++
      window.clearInterval(timer)
    }
  }, [refresh])
  const active = state?.binding === binding && enabled ? state : null
  const answer = async (intent: PromptAnswerIntent) => {
    const captured = active
    if (
      !captured?.prompt ||
      answering.current ||
      quarantine.current === binding
    )
      return {
        ok: false,
        outcome: 'rejected' as const,
        error: 'Prompt changed; re-read.'
      }
    answering.current = true
    generation.current++
    try {
      const result = await sendAction({
        type: 'prompt-answer',
        operationId: crypto.randomUUID(),
        target: captured.target,
        promptId: captured.prompt.id,
        answer: intent
      })
      return { ok: result.ok, outcome: 'acknowledged' as const }
    } catch (error) {
      if (!(error instanceof ActionError && error.outcome === 'rejected')) {
        quarantine.current = binding
        setUnknownBinding(binding)
      }
      return {
        ok: false,
        outcome:
          error instanceof ActionError && error.outcome === 'rejected'
            ? ('rejected' as const)
            : ('unknown' as const),
        error: error instanceof Error ? error.message : 'Answer outcome unknown'
      }
    } finally {
      answering.current = false
      generation.current++
    }
  }
  return {
    ready: Boolean(active && !active.error && unknownBinding !== binding),
    prompt: active?.prompt ?? null,
    error: active?.error ?? null,
    suggestion: active?.suggestion ?? null,
    unknown: unknownBinding === binding,
    answer,
    refresh: () => refresh(true)
  }
}
