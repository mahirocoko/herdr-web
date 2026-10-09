// Adapted from devswha/herdr-web-ui@5979118 src/components/PromptCard.tsx.
// MIT License, Copyright (c) 2026 devswha.
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { Check, Send } from 'lucide-react'
import { Button } from './ui/button.tsx'
import { Input } from './ui/input.tsx'
import { Checkbox } from './ui/checkbox.tsx'
import { dismissKeyboardOn } from '@/utils/chat-keyboard.ts'
import {
  promptAcceptsIntent,
  validatePromptAnswerIntent,
  type IInteractivePrompt,
  type PromptAnswerIntent
} from '../types/interactive-prompt.ts'
import { focusFollowsAnswer, pressOrigin } from '../utils/prompt-answer.ts'
import './prompt-card.css'

export interface IPromptCardProps {
  paneId: string
  prompt: IInteractivePrompt
  /** Caller owns frozen target, operation ID and the authenticated typed action pipeline. */
  answerPrompt: (answer: PromptAnswerIntent) => Promise<{
    ok: boolean
    outcome: 'acknowledged' | 'rejected' | 'unknown'
    error?: string
  }>
  onPromptChanged: () => void
  onAnswered: (toMessageBox: boolean) => void
  typedAnswer?: PromptAnswerIntent | null
  isUnknown?: boolean
  onTypedAnswerDone?: () => void
}

/** Selection, drafts, focus and late callbacks cannot pass into a different asking. */
export const PromptCard = (props: IPromptCardProps) => (
  <PromptOccurrenceCard
    key={`${props.paneId}\0${props.prompt.id}`}
    {...props}
  />
)

const PromptOccurrenceCard = ({
  prompt,
  answerPrompt,
  onPromptChanged,
  onAnswered,
  typedAnswer = null,
  isUnknown = false,
  onTypedAnswerDone
}: IPromptCardProps) => {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [custom, setCustom] = useState('')
  const [pending, setPending] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cardRef = useRef<HTMLElement | null>(null)
  const confirmRef = useRef<HTMLDivElement | null>(null)
  const shown = useRef(false)
  const busy = useRef(false)
  const keyed = useRef<EventTarget | null>(null)
  const down = useRef<{ target: EventTarget; pointerType: string } | null>(null)
  useEffect(() => {
    const node = cardRef.current
    return node ? dismissKeyboardOn(node, true) : undefined
  }, [prompt.id])

  useEffect(() => {
    shown.current = true
    return () => {
      shown.current = false
    }
  }, [])
  useEffect(() => {
    confirmRef.current?.scrollIntoView({ block: 'nearest' })
  }, [typedAnswer])
  const answer = async (
    intent: PromptAnswerIntent,
    press?: MouseEvent<HTMLButtonElement>
  ) => {
    if (busy.current || unknown || isUnknown) return
    const validated = validatePromptAnswerIntent(intent)
    if (!validated || !promptAcceptsIntent(prompt, validated)) {
      setError('This prompt does not accept that answer.')
      return
    }
    const fromCard = cardRef.current?.contains(document.activeElement) === true
    const click = press?.nativeEvent as Partial<PointerEvent> | undefined
    const origin = pressOrigin(
      press === undefined
        ? undefined
        : {
            pointerType: click?.pointerType,
            downType:
              down.current?.target === press.currentTarget
                ? down.current.pointerType
                : undefined,
            detail: click?.detail,
            keyed: keyed.current === press.currentTarget
          }
    )
    keyed.current = null
    down.current = null
    const coarse = window.matchMedia?.('(pointer: coarse)').matches === true
    busy.current = true
    setPending(true)
    setError(null)
    try {
      const result = await answerPrompt(validated)
      if (!shown.current) return
      if (result.outcome === 'unknown') {
        setUnknown(true)
        setError(
          result.error ??
            'The answer may have applied. Inspect the terminal before submitting again; it will not be retried.'
        )
      } else if (!result.ok || result.outcome !== 'acknowledged') {
        setError(
          result.error ?? 'The prompt changed — re-read before answering.'
        )
        onPromptChanged()
      } else {
        const card = cardRef.current
        const active = document.activeElement
        onTypedAnswerDone?.()
        onAnswered(
          focusFollowsAnswer({
            fromCard,
            origin,
            coarse,
            cardMounted: card !== null,
            inCard: card?.contains(active) === true,
            onPage: active === null || active === document.body
          })
        )
      }
    } catch (cause) {
      if (!shown.current) return
      // A lost HTTP acknowledgement says nothing about native application. Never replay it.
      setUnknown(true)
      setError(
        `The answer outcome is unknown. Inspect the terminal; no automatic retry. ${cause instanceof Error ? cause.message : String(cause)}`
      )
    } finally {
      busy.current = false
      if (shown.current) setPending(false)
    }
  }
  const customLabelId = useId()
  const hasChoices = prompt.options.some(
    (_, index) => index !== prompt.custom_option_index
  )
  const disabled = pending || unknown || isUnknown
  return (
    <section
      className="prompt-card"
      ref={cardRef}
      role="region"
      aria-label="Agent is asking"
      aria-busy={pending}
      onKeyDown={(event) => {
        down.current = null
        keyed.current =
          event.key === 'Enter' || event.key === ' ' ? event.target : null
      }}
      onPointerDown={(event) => {
        keyed.current = null
        const button = (event.target as Element).closest('button')
        down.current = button
          ? { target: button, pointerType: event.pointerType }
          : null
      }}
    >
      <header className="prompt-card-header">
        <span className="sr-only">input needed</span>
        <h2>{prompt.title}</h2>
      </header>
      {prompt.steps && (
        <ol className="prompt-card-steps" aria-label="Questions">
          {prompt.steps.map((step, index) => (
            <li
              key={index}
              className={`prompt-card-step${step.answered ? ' is-answered' : ''}${step.current ? ' is-current' : ''}`}
              aria-current={step.current ? 'step' : undefined}
            >
              <span className="prompt-card-step-mark" aria-hidden="true">
                {step.answered ? <Check /> : index + 1}
              </span>
              <span className="prompt-card-step-label">{step.label}</span>
              {step.answered && <span className="sr-only">(answered)</span>}
            </li>
          ))}
        </ol>
      )}
      {prompt.question !== prompt.title && (
        <p className="prompt-card-question">{prompt.question}</p>
      )}
      {prompt.queued && (
        <p className="prompt-card-hint">
          {prompt.queued === 'open'
            ? "Codex keeps working meanwhile. Answer here; the question holds the terminal's input until it is answered or closed."
            : 'Codex keeps working meanwhile. Answer here; the message box still talks to Codex.'}
        </p>
      )}
      {prompt.body && (
        <pre
          className={`prompt-card-body${prompt.body.includes('\n') ? '' : ' is-line'}`}
        >
          {prompt.body}
        </pre>
      )}
      {hasChoices && (
        <div
          className="prompt-card-options"
          role={prompt.multi_select ? 'group' : undefined}
          aria-label={prompt.multi_select ? prompt.question : undefined}
        >
          {prompt.options.map((option, index) => {
            if (index === prompt.custom_option_index) return null
            const text = option.label.replace(/\s*\(recommended\)$/i, '')
            const content = (
              <>
                <span className="prompt-card-number">
                  <span aria-hidden="true">{index + 1}</span>
                  <span className="sr-only">{index + 1}.</span>
                </span>
                <span className="prompt-card-option-text">
                  <span className="prompt-card-option-label">
                    {text}
                    {text !== option.label && (
                      <>
                        {' '}
                        <span className="prompt-card-tag">Recommended</span>
                      </>
                    )}
                  </span>
                  {option.description !== null && (
                    <span className="prompt-card-option-description">
                      {option.description}
                    </span>
                  )}
                </span>
              </>
            )
            const className = `prompt-card-option${option.description !== null ? ' has-description' : ''}`
            return prompt.multi_select ? (
              <label
                className={`${className}${selected.has(index) ? ' is-checked' : ''}`}
                key={index}
              >
                <Checkbox
                  checked={selected.has(index)}
                  disabled={disabled}
                  aria-label={option.label}
                  onCheckedChange={(checked) =>
                    setSelected((current) => {
                      const next = new Set(current)
                      if (checked) next.add(index)
                      else next.delete(index)
                      return next
                    })
                  }
                />
                {content}
              </label>
            ) : (
              <Button
                variant="ghost"
                key={index}
                className={`${className}${typedAnswer?.option_index === index ? ' is-typed' : ''}`}
                disabled={disabled}
                onClick={(event) => void answer({ option_index: index }, event)}
              >
                {content}
              </Button>
            )
          })}
        </div>
      )}
      {prompt.multi_select && (
        <Button
          className="prompt-card-submit"
          variant={selected.size > 0 ? 'default' : 'secondary'}
          disabled={disabled || selected.size === 0}
          onClick={(event) =>
            void answer(
              { option_indices: [...selected].sort((a, b) => a - b) },
              event
            )
          }
        >
          {selected.size > 0 ? `Submit (${selected.size})` : 'Submit'}
        </Button>
      )}
      {prompt.custom_option_index !== null && (
        <div className="prompt-card-custom">
          <label
            className="prompt-card-custom-label"
            id={customLabelId}
            htmlFor={`${customLabelId}-field`}
          >
            {hasChoices ? 'Or type your own answer' : 'Custom answer'}
          </label>
          <div className="prompt-card-custom-row">
            <Input
              id={`${customLabelId}-field`}
              name="custom-answer"
              value={custom}
              disabled={disabled}
              placeholder={
                prompt.options[prompt.custom_option_index]?.label ??
                'Type an answer'
              }
              onChange={(event) => setCustom(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229
                ) {
                  event.preventDefault()
                  if (custom.trim()) void answer({ custom_text: custom })
                }
              }}
            />
            <Button
              disabled={disabled || !custom.trim()}
              onClick={(event) => void answer({ custom_text: custom }, event)}
            >
              <Send aria-hidden="true" /> Send
            </Button>
          </div>
        </div>
      )}
      {typedAnswer?.option_index !== undefined && (
        <div className="prompt-card-confirm" role="alert" ref={confirmRef}>
          <span className="prompt-card-confirm-text">
            Send {typedAnswer.option_index + 1}.{' '}
            {prompt.options[typedAnswer.option_index]?.label ?? ''}?
          </span>
          <span className="prompt-card-confirm-actions">
            <Button
              disabled={disabled}
              onClick={(event) => void answer(typedAnswer, event)}
            >
              Confirm
            </Button>
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={onTypedAnswerDone}
            >
              Cancel
            </Button>
          </span>
        </div>
      )}
      {(unknown || isUnknown) && (
        <>
          <p className="prompt-card-error" role="alert">
            Outcome unknown — inspect the terminal before submitting again. No
            automatic replay.
          </p>
          <Button variant="secondary" onClick={onPromptChanged}>
            Re-read after inspection
          </Button>
        </>
      )}
      {error !== null && (
        <p className="prompt-card-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
