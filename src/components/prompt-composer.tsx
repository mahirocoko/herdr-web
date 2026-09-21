import { useLayoutEffect, useRef, useState } from 'react'
import type { FC, FormEvent, KeyboardEvent } from 'react'
import { Loader2, SendHorizontal, SquareTerminal } from 'lucide-react'
import {
  calculateComposerHeight,
  evaluateComposerKey,
  resolveDraftAfterSubmit,
  type ActionResultStatus
} from '@/utils/prompt-composer.ts'
import type { IExpectedPaneMode } from '@/types/herdr.ts'
import { applyDraftAction } from '@/utils/interaction-picker.ts'
import InteractionPickerSheet from './interaction-picker-sheet.tsx'

export interface IPromptComposerProps {
  paneId: string | null
  terminalId?: string | null
  agentName?: string
  isBlocked?: boolean
  hasAgent?: boolean
  expectedMode?: IExpectedPaneMode
  isBusy: boolean
  isControlActive?: boolean
  hasValidTarget?: boolean
  error?: string | null
  onSubmitText: (text: string) => Promise<ActionResultStatus | void>
  draftText?: string
  onDraftChange?: (text: string) => void
}

const PromptComposer: FC<IPromptComposerProps> = ({
  paneId,
  terminalId,
  agentName,
  isBlocked = false,
  hasAgent = true,
  expectedMode,
  isBusy,
  isControlActive = false,
  hasValidTarget = true,
  error,
  onSubmitText,
  draftText,
  onDraftChange
}) => {
  const effectiveMode: IExpectedPaneMode =
    expectedMode ?? (isBlocked ? 'blocked-agent' : hasAgent ? 'agent' : 'shell')
  const effectiveIsBlocked = effectiveMode === 'blocked-agent'
  const effectiveHasAgent = effectiveMode === 'agent' || effectiveMode === 'blocked-agent'

  const [internalText, setInternalText] = useState('')
  const isControlled = draftText !== undefined
  const text = isControlled ? draftText : internalText

  const setText = (updater: string | ((prev: string) => string)) => {
    const nextVal = typeof updater === 'function' ? updater(text) : updater
    if (!isControlled) {
      setInternalText(nextVal)
    }
    onDraftChange?.(nextVal)
  }

  const prevPaneIdRef = useRef<string | null>(paneId)
  const paneGenerationRef = useRef<number>(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const quickTriggerRef = useRef<HTMLButtonElement | null>(null)
  const isComposingRef = useRef(false)
  const [isPickerOpen, setIsPickerOpen] = useState(false)

  // Track a monotonically increasing pane-generation whenever paneId changes, including A -> B -> A
  if (paneId !== prevPaneIdRef.current) {
    prevPaneIdRef.current = paneId
    paneGenerationRef.current += 1
  }

  // Adjust textarea height on text change, pane switch, or draft clear
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const targetHeight = calculateComposerHeight(el.scrollHeight)
    el.style.height = `${targetHeight}px`
    el.style.overflowY = el.scrollHeight > 132 ? 'auto' : 'hidden'
  }, [text, paneId])

  const focusTextareaAtEnd = () => {
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        const len = el.value.length
        el.setSelectionRange(len, len)
      }
    })
  }

  const submitDraft = async () => {
    // Strictly prevent submission while IME composition is active
    if (isComposingRef.current) return

    const trimmed = text.trim()
    // Prevent duplicate submission while already sending or empty or disabled target
    if (!trimmed || !paneId || !hasValidTarget || isBusy || isControlActive) return

    const submittedPaneId = paneId
    const submittedGeneration = paneGenerationRef.current
    const submittedDraft = text
    try {
      const status = await onSubmitText(trimmed)
      // Clear only when status is acknowledged and exact draft/pane/generation remain unchanged
      if (status === 'acknowledged') {
        const currentPaneId = prevPaneIdRef.current
        const currentGeneration = paneGenerationRef.current
        setText((current) =>
          resolveDraftAfterSubmit(
            current,
            submittedDraft,
            'acknowledged',
            currentPaneId,
            submittedPaneId,
            currentGeneration,
            submittedGeneration
          )
        )
      }
    } catch {
      // Retain draft on failure
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    // Strictly prevent submission while IME composition is active
    if (isComposingRef.current) return
    void submitDraft()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const isComposing = e.nativeEvent.isComposing || e.keyCode === 229 || isComposingRef.current
    const trimmed = text.trim()
    const decision = evaluateComposerKey(
      e.key,
      e.shiftKey,
      isComposing,
      trimmed.length,
      isBusy,
      !paneId || !hasValidTarget || isControlActive,
      e.keyCode
    )

    if (decision.shouldPreventDefault) {
      e.preventDefault()
    }

    if (decision.shouldSubmit) {
      if (!isComposingRef.current) {
        void submitDraft()
      }
    }
  }

  let placeholder = 'Select a pane to send input'

  if (!paneId) {
    placeholder = 'Select a pane to send input'
  } else if (!hasValidTarget) {
    placeholder = 'Terminal identity missing — refresh snapshot'
  } else if (isBusy) {
    placeholder = 'Sending...'
  } else if (effectiveIsBlocked) {
    placeholder = 'Answer question or send text...'
  } else if (effectiveHasAgent) {
    placeholder = `Prompt ${agentName || 'agent'}...`
  } else {
    placeholder = 'Type shell command...'
  }

  // Never disable textarea during submission so mobile keyboard stays up and caret is preserved.
  // Textarea is disabled only when there is no pane selected or no valid target identity.
  const isInputDisabled = !paneId || !hasValidTarget || isControlActive
  const isSubmitDisabled = isInputDisabled || isBusy || text.trim().length === 0
  const isQuickDisabled = !paneId || !terminalId || !hasValidTarget || isBusy || isControlActive

  const pickerMode: 'agent' | 'shell' = effectiveHasAgent ? 'agent' : 'shell'
  const subtleRoleTag = effectiveIsBlocked ? 'Answer · agent' : effectiveHasAgent ? 'Prompt · agent' : 'Shell · pane'

  return (
    <div className="prompt-composer">
      {error && (
        <div className="prompt-composer__error" role="alert">
          {error}
        </div>
      )}

      <form className="prompt-composer__form" onSubmit={handleSubmit}>
        {/* Quick Commands Trigger Inline Left */}
        <button
          ref={quickTriggerRef}
          type="button"
          className="prompt-composer__quick-btn"
          onClick={() => setIsPickerOpen(true)}
          disabled={isQuickDisabled}
          aria-label="Quick Commands"
          title="Quick Commands"
        >
          <SquareTerminal size={18} aria-hidden="true" />
        </button>

        <div className="prompt-composer__input-wrapper">
          <textarea
            ref={textareaRef}
            id="herdr-prompt-input"
            name="prompt"
            rows={1}
            maxLength={4096}
            className="prompt-composer__input prompt-composer__textarea"
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false
            }}
            disabled={isInputDisabled}
            aria-label={`Text input for ${subtleRoleTag}`}
          />
        </div>

        <button
          type="submit"
          className="prompt-composer__submit-btn"
          disabled={isSubmitDisabled}
          aria-label="Send input"
        >
          {isBusy ? (
            <Loader2 size={18} className="prompt-composer__spinner spin" aria-hidden="true" />
          ) : (
            <SendHorizontal size={18} aria-hidden="true" />
          )}
        </button>
      </form>

      {/* Quick Commands Interaction Picker Sheet */}
      {isPickerOpen && (
        <InteractionPickerSheet
          isOpen={isPickerOpen}
          paneId={paneId}
          terminalId={terminalId || null}
          mode={pickerMode}
          existingDraft={text}
          onFillDraft={(val) => {
            setText(val)
            focusTextareaAtEnd()
          }}
          onReplaceDraft={(val) => {
            setText(val)
            focusTextareaAtEnd()
          }}
          onAppendDraft={(val) => {
            setText((cur) => applyDraftAction(cur, val, 'append'))
            focusTextareaAtEnd()
          }}
          onClose={() => setIsPickerOpen(false)}
          triggerRef={quickTriggerRef}
        />
      )}
    </div>
  )
}

export default PromptComposer
