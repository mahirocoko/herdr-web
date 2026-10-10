import { useLayoutEffect, useRef, useState } from 'react'
import type { FC, FormEvent, KeyboardEvent, ReactNode } from 'react'
import { Loader2, SendHorizontal, SquareTerminal } from 'lucide-react'
import {
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  calculateComposerHeight,
  evaluateComposerKey,
  resolveDraftAfterSubmit,
  type ActionResultStatus
} from '@/utils/prompt-composer.ts'
import type { IExpectedPaneMode } from '@/types/herdr.ts'
import { applyDraftAction } from '@/utils/interaction-picker.ts'
import InteractionPickerSheet, {
  type IPickerSheetTab
} from './interaction-picker-sheet.tsx'
import Button from '@/components/ui/button.tsx'
import Textarea from '@/components/ui/textarea.tsx'

export interface IPromptComposerProps {
  paneId: string | null
  terminalId?: string | null
  workspaceId?: string | null
  agentName?: string
  promptPlaceholder?: string
  isBlocked?: boolean
  hasAgent?: boolean
  expectedMode?: IExpectedPaneMode
  isBusy: boolean
  isControlActive?: boolean
  hasValidTarget?: boolean
  isPromptEvidenceReady?: boolean
  error?: string | null
  onSubmitText: (text: string) => Promise<ActionResultStatus | void>
  onSendKeys?: (keys: string[]) => void
  draftText?: string
  onDraftChange?: (text: string) => void
  isPickerOpen?: boolean
  onPickerOpenChange?: (open: boolean) => void
  pickerInitialTab?: IPickerSheetTab
  contextControls?: ReactNode
}

const PromptComposer: FC<IPromptComposerProps> = ({
  paneId,
  terminalId,
  workspaceId,
  agentName,
  promptPlaceholder,
  isBlocked = false,
  hasAgent = true,
  expectedMode,
  isBusy,
  isControlActive = false,
  hasValidTarget = true,
  isPromptEvidenceReady = true,
  error,
  onSubmitText,
  onSendKeys,
  draftText,
  onDraftChange,
  isPickerOpen,
  onPickerOpenChange,
  pickerInitialTab,
  contextControls
}) => {
  const effectiveMode: IExpectedPaneMode =
    expectedMode ?? (isBlocked ? 'blocked-agent' : hasAgent ? 'agent' : 'shell')
  const effectiveIsBlocked = effectiveMode === 'blocked-agent'
  const effectiveHasAgent =
    effectiveMode === 'agent' || effectiveMode === 'blocked-agent'

  const [internalText, setInternalText] = useState('')
  const isControlled = draftText !== undefined
  const text = isControlled ? draftText : internalText
  const isComposingRef = useRef(false)

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
  const isControlledPicker = isPickerOpen !== undefined
  const [internalPickerOpen, setInternalPickerOpen] = useState(false)
  const effectivePickerOpen = isControlledPicker
    ? isPickerOpen
    : internalPickerOpen

  const setPickerOpen = (open: boolean) => {
    if (isControlledPicker) {
      onPickerOpenChange?.(open)
    } else {
      setInternalPickerOpen(open)
    }
  }

  // Track a monotonically increasing pane-generation whenever paneId changes, including A -> B -> A
  if (paneId !== prevPaneIdRef.current) {
    prevPaneIdRef.current = paneId
    paneGenerationRef.current += 1
  }

  // Adjust textarea height on text change, pane switch, or draft clear
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const resizeTextarea = () => {
      el.style.height = 'auto'
      const minHeight = Math.max(
        Number.parseFloat(window.getComputedStyle(el).minHeight) || 0,
        COMPOSER_MIN_HEIGHT
      )
      const parsedMaxHeight = Number.parseFloat(
        window.getComputedStyle(el).maxHeight
      )
      const maxHeight =
        Number.isFinite(parsedMaxHeight) && parsedMaxHeight > 0
          ? Math.min(parsedMaxHeight, COMPOSER_MAX_HEIGHT)
          : COMPOSER_MAX_HEIGHT
      const targetHeight = calculateComposerHeight(
        el.scrollHeight,
        minHeight,
        maxHeight
      )
      el.style.height = `${targetHeight}px`
      el.style.overflowY = el.scrollHeight > targetHeight ? 'auto' : 'hidden'
    }
    resizeTextarea()
    window.addEventListener('resize', resizeTextarea)
    return () => window.removeEventListener('resize', resizeTextarea)
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
    if (
      !trimmed ||
      !paneId ||
      !hasValidTarget ||
      !isPromptEvidenceReady ||
      isBusy ||
      isControlActive
    )
      return

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
    const isComposing =
      e.nativeEvent.isComposing || e.keyCode === 229 || isComposingRef.current
    const trimmed = text.trim()
    const decision = evaluateComposerKey(
      e.key,
      e.shiftKey,
      isComposing,
      trimmed.length,
      isBusy,
      !paneId || !hasValidTarget || !isPromptEvidenceReady || isControlActive,
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
  } else if (!isPromptEvidenceReady) {
    placeholder = 'Inspect or re-read the current prompt before sending'
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
  const isInputDisabled =
    !paneId || !hasValidTarget || !isPromptEvidenceReady || isControlActive
  const isSubmitDisabled = isInputDisabled || isBusy || text.trim().length === 0
  const isQuickDisabled =
    !paneId ||
    !terminalId ||
    !hasValidTarget ||
    !isPromptEvidenceReady ||
    isBusy ||
    isControlActive

  const pickerMode: 'agent' | 'shell' = effectiveHasAgent ? 'agent' : 'shell'
  const subtleRoleTag = effectiveIsBlocked
    ? 'Answer · agent'
    : effectiveHasAgent
      ? 'Prompt · agent'
      : 'Shell · pane'

  return (
    <div className="prompt-composer">
      {error && (
        <div className="prompt-composer__error" role="alert">
          {error}
        </div>
      )}

      <form className="prompt-composer__form" onSubmit={handleSubmit}>
        {contextControls && (
          <div className="prompt-composer__context-controls">
            {contextControls}
          </div>
        )}
        <div className="prompt-composer__input-wrapper">
          <Textarea
            ref={textareaRef}
            id="herdr-prompt-input"
            name="prompt"
            rows={1}
            maxLength={4096}
            className="prompt-composer__input prompt-composer__textarea"
            placeholder={promptPlaceholder ?? placeholder}
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

        <div className="prompt-composer__toolbar">
          <div className="prompt-composer__controls-left">
            <Button
              ref={quickTriggerRef}
              type="button"
              variant="ghost"
              size="icon"
              className="prompt-composer__quick-btn"
              onClick={() => setPickerOpen(true)}
              disabled={isQuickDisabled}
              aria-label="Quick Commands"
              title="Quick Commands"
            >
              <SquareTerminal size={18} aria-hidden="true" />
            </Button>
          </div>

          <div className="prompt-composer__controls-right">
            <Button
              type="submit"
              variant="default"
              size="icon"
              className="prompt-composer__submit-btn"
              disabled={isSubmitDisabled}
              aria-label="Send input"
            >
              {isBusy ? (
                <Loader2
                  size={18}
                  className="prompt-composer__spinner spin"
                  aria-hidden="true"
                />
              ) : (
                <SendHorizontal size={18} aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
      </form>

      {/* Quick Commands Interaction Picker Sheet */}
      {effectivePickerOpen && (
        <InteractionPickerSheet
          isOpen={effectivePickerOpen}
          paneId={paneId}
          terminalId={terminalId || null}
          workspaceId={workspaceId}
          mode={pickerMode}
          existingDraft={text}
          initialTab={pickerInitialTab || 'commands'}
          onFillDraft={(val: string) => {
            setText(val)
            focusTextareaAtEnd()
          }}
          onReplaceDraft={(val: string) => {
            setText(val)
            focusTextareaAtEnd()
          }}
          onAppendDraft={(val: string) => {
            setText((cur) => applyDraftAction(cur, val, 'append'))
            focusTextareaAtEnd()
          }}
          onSendKeys={onSendKeys}
          onClose={() => setPickerOpen(false)}
          triggerRef={quickTriggerRef}
        />
      )}
    </div>
  )
}

export default PromptComposer
