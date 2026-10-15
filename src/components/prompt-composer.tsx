import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FC, FormEvent, KeyboardEvent, ReactNode } from 'react'
import {
  ArrowUp,
  Folder,
  FolderGit2,
  GitBranch,
  Loader2,
  ImagePlus,
  X,
  RotateCcw,
  SquareTerminal
} from 'lucide-react'
import {
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  calculateComposerHeight,
  evaluateComposerKey,
  resolveDraftAfterSubmit,
  type ActionResultStatus
} from '@/utils/prompt-composer.ts'
import type { IExpectedPaneMode } from '@/types/herdr.ts'
import type { IConversationMetadata } from '@/types/conversation.ts'
import { applyDraftAction } from '@/utils/interaction-picker.ts'
import InteractionPickerSheet, {
  type IPickerSheetTab
} from './interaction-picker-sheet.tsx'
import Button from '@/components/ui/button.tsx'
import Textarea from '@/components/ui/textarea.tsx'
import { MAX_DRAFT_BYTES, utf8Bytes } from '@/utils/composer-draft.ts'
import {
  canSendComposerImage,
  type IComposerImage
} from '@/utils/composer-image.ts'
import { imagePromptBytes } from '@/types/image-upload.ts'

export interface IPromptComposerProps {
  imageAttachment?: {
    image: IComposerImage | null
    allowed: boolean
    notice: string | null
    onChoose: (file: File) => void
    onRemove: () => void
    onRetry: () => void
    onInspect?: () => void
  }
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
  onQueueText?: (text: string) => Promise<ActionResultStatus | void>
  onSendKeys?: (keys: string[]) => void
  draftIdentity?: string | null
  draftRevision?: number
  focusRequest?: number
  draftNotice?: string | null
  contextStrip?: {
    path: string | null
    folder: string | null
    source: string | null
    branch?: string | null
    dirty?: boolean
    worktree?: string | null
  } | null
  draftText?: string
  onDraftChange?: (text: string) => void
  isPickerOpen?: boolean
  onPickerOpenChange?: (open: boolean) => void
  pickerInitialTab?: IPickerSheetTab
  contextControls?: ReactNode
  recordedMetadata?: IConversationMetadata | null
}

const PromptComposer: FC<IPromptComposerProps> = ({
  imageAttachment,
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
  onQueueText,
  onSendKeys,
  draftText,
  draftIdentity,
  draftRevision,
  focusRequest = 0,
  draftNotice,
  contextStrip,
  onDraftChange,
  isPickerOpen,
  onPickerOpenChange,
  pickerInitialTab,
  contextControls,
  recordedMetadata
}) => {
  const effectiveMode: IExpectedPaneMode =
    expectedMode ?? (isBlocked ? 'blocked-agent' : hasAgent ? 'agent' : 'shell')
  const effectiveIsBlocked = effectiveMode === 'blocked-agent'
  const effectiveHasAgent =
    effectiveMode === 'agent' || effectiveMode === 'blocked-agent'

  const [internalText, setInternalText] = useState('')
  const [draftInputError, setDraftInputError] = useState<string | null>(null)
  const isControlled = draftText !== undefined
  const text = isControlled ? draftText : internalText
  const isComposingRef = useRef(false)
  const imageInput = useRef<HTMLInputElement | null>(null)
  const image = imageAttachment?.image ?? null
  const combinedBytes = imagePromptBytes(
    text,
    image?.uploaded?.imageContextBytes ?? 0
  )
  const imageReady = canSendComposerImage(image, text)
  const hasSendContent = !!text.trim() || !!image?.uploaded

  const setText = (updater: string | ((prev: string) => string)) => {
    const nextVal = typeof updater === 'function' ? updater(text) : updater
    if (utf8Bytes(nextVal) > MAX_DRAFT_BYTES) {
      setDraftInputError(
        `Text exceeds ${MAX_DRAFT_BYTES} UTF-8 bytes. Your previous draft is unchanged.`
      )
      return
    }
    setDraftInputError(null)
    if (!isControlled) {
      setInternalText(nextVal)
    }
    onDraftChange?.(nextVal)
  }

  const liveDraftRef = useRef({ text, onDraftChange, draftRevision })
  liveDraftRef.current = { text, onDraftChange, draftRevision }
  const scopeIdentity = draftIdentity ?? paneId
  useEffect(() => setDraftInputError(null), [scopeIdentity])
  const previousIdentityRef = useRef(scopeIdentity)
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
  if (scopeIdentity !== previousIdentityRef.current) {
    previousIdentityRef.current = scopeIdentity
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

  const mountedRef = useRef(true)
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const submittingRef = useRef(false)
  const submitDraft = async (queue = false) => {
    // Strictly prevent submission while IME composition is active
    if (isComposingRef.current) return

    const trimmed = text.trim()
    // Prevent duplicate submission while already sending or empty or disabled target
    if (
      !hasSendContent ||
      !imageReady ||
      (queue && !!image) ||
      combinedBytes > MAX_DRAFT_BYTES ||
      !paneId ||
      !hasValidTarget ||
      (!queue && !isPromptEvidenceReady) ||
      submittingRef.current ||
      isBusy ||
      isControlActive
    )
      return

    const submittedPaneId = paneId
    const submittedGeneration = paneGenerationRef.current
    const submittedDraft = text
    const submittedRevision = draftRevision
    if (queue && !onQueueText) return
    submittingRef.current = true
    try {
      const status = await (queue ? onQueueText! : onSubmitText)(
        image ? text : trimmed
      )
      // Clear only when status is acknowledged and exact draft/pane/generation remain unchanged
      if (status === 'acknowledged' && mountedRef.current) {
        const currentPaneId = prevPaneIdRef.current
        const currentGeneration = paneGenerationRef.current
        const current = liveDraftRef.current
        const next = resolveDraftAfterSubmit(
          current.text,
          submittedDraft,
          'acknowledged',
          currentPaneId,
          submittedPaneId,
          currentGeneration,
          submittedGeneration
        )
        if (
          next !== current.text &&
          current.draftRevision === submittedRevision
        ) {
          if (!isControlled) setInternalText(next)
          current.onDraftChange?.(next)
        }
      }
    } catch {
      // Retain draft on failure
    } finally {
      submittingRef.current = false
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
      hasSendContent ? Math.max(1, trimmed.length) : 0,
      isBusy,
      !paneId ||
        !hasValidTarget ||
        !isPromptEvidenceReady ||
        isControlActive ||
        !imageReady,
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
  const consumedFocusRequest = useRef(0)
  useEffect(() => {
    if (
      !focusRequest ||
      consumedFocusRequest.current === focusRequest ||
      isInputDisabled
    )
      return
    consumedFocusRequest.current = focusRequest
    const input = textareaRef.current
    // Do not steal focus if the reader chose another control while waiting.
    if (
      !input ||
      (document.activeElement !== document.body &&
        document.activeElement !== input)
    )
      return
    input.focus({ preventScroll: true })
    input.setSelectionRange(input.value.length, input.value.length)
  }, [focusRequest, isInputDisabled])
  const isSubmitDisabled =
    isInputDisabled ||
    isBusy ||
    !hasSendContent ||
    !imageReady ||
    combinedBytes > MAX_DRAFT_BYTES
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
        {image && (
          <div
            className="prompt-composer__image"
            aria-label="Image context attachment"
          >
            {image.preview && (
              <img src={image.preview} alt="Selected image preview" />
            )}
            <div className="prompt-composer__image-copy">
              <strong>{image.file.name}</strong>
              <span>
                {Math.ceil(image.file.size / 1024)} KiB ·{' '}
                {image.phase === 'ready'
                  ? 'Ready'
                  : image.phase === 'decoding'
                    ? 'Checking image…'
                    : image.phase === 'uploading'
                      ? 'Uploading…'
                      : image.phase === 'sending'
                        ? 'Sending context…'
                        : 'Not ready'}
              </span>
              <span role="status">
                {image.error ??
                  (image.uploaded && image.uploaded.expiresAt <= Date.now()
                    ? 'Image expired. Remove it and upload again.'
                    : '24-hour local-file context. Send ACK is not image-read proof.')}
              </span>
              {image.phase === 'error' && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={imageAttachment?.onRetry}
                  disabled={!imageAttachment?.allowed}
                >
                  <RotateCcw size={16} aria-hidden="true" /> Retry image
                </Button>
              )}
              {image.phase === 'handled' && imageAttachment?.onInspect && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={imageAttachment.onInspect}
                >
                  <SquareTerminal size={16} aria-hidden="true" /> Inspect
                  Terminal
                </Button>
              )}
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={imageAttachment?.onRemove}
              aria-label={
                ['uploading', 'decoding'].includes(image.phase)
                  ? 'Cancel image upload'
                  : 'Remove image from draft'
              }
            >
              <X size={18} aria-hidden="true" />
            </Button>
          </div>
        )}
        <div className="prompt-composer__input-wrapper">
          <Textarea
            ref={textareaRef}
            id="herdr-prompt-input"
            name="prompt"
            rows={1}
            className="prompt-composer__input prompt-composer__textarea"
            placeholder={promptPlaceholder ?? placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby="herdr-prompt-byte-limit"
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
          {(recordedMetadata?.model ||
            recordedMetadata?.reasoning_effort ||
            recordedMetadata?.context) && (
            <div
              className="prompt-composer__metadata"
              aria-label="Recorded conversation metadata"
            >
              <span className="prompt-composer__recorded">Recorded</span>
              {recordedMetadata.model && (
                <span
                  className="prompt-composer__model"
                  title={`Recorded model: ${recordedMetadata.model}`}
                >
                  {recordedMetadata.model}
                </span>
              )}
              {recordedMetadata.reasoning_effort && (
                <span
                  className="prompt-composer__reasoning"
                  title={`Recorded reasoning effort: ${recordedMetadata.reasoning_effort}`}
                >
                  {recordedMetadata.reasoning_effort}
                </span>
              )}
              {recordedMetadata.context && (
                <span
                  className="prompt-composer__tokens"
                  title="Recorded token usage, not live context remaining"
                >
                  {recordedMetadata.context.used.toLocaleString()}
                  {recordedMetadata.context.window
                    ? ` / ${recordedMetadata.context.window.toLocaleString()}`
                    : ''}{' '}
                  tokens
                </span>
              )}
            </div>
          )}
          <div className="prompt-composer__controls-left">
            {imageAttachment && (
              <>
                <input
                  ref={imageInput}
                  className="prompt-composer__image-input"
                  type="file"
                  accept="image/png,image/jpeg"
                  aria-label="Choose PNG or JPEG image context"
                  disabled={!imageAttachment.allowed || isControlActive}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ''
                    if (file) imageAttachment.onChoose(file)
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={!imageAttachment.allowed || isControlActive}
                  onClick={() => imageInput.current?.click()}
                  aria-label="Attach image context"
                  title="One PNG/JPEG, up to 8 MiB; local file expires in 24 hours"
                >
                  <ImagePlus size={18} aria-hidden="true" />
                </Button>
              </>
            )}
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
            {contextControls && (
              <div className="prompt-composer__context-controls">
                {contextControls}
              </div>
            )}
            {onQueueText && (
              <Button
                type="button"
                variant="ghost"
                disabled={
                  !!image ||
                  !text.trim() ||
                  combinedBytes > MAX_DRAFT_BYTES ||
                  !paneId ||
                  !hasValidTarget ||
                  isBusy ||
                  isControlActive
                }
                onClick={() => void submitDraft(true)}
                title="Held in Web — send manually"
              >
                Queue
              </Button>
            )}
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
                <ArrowUp size={18} aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
      </form>

      {contextStrip && (
        <div className="prompt-composer__strip" aria-label="Composer context">
          {contextStrip.folder && (
            <span
              className="prompt-composer__strip-item prompt-composer__strip-folder"
              title={contextStrip.path ?? undefined}
              aria-label={`Pane working folder: ${contextStrip.path ?? contextStrip.folder}`}
            >
              <Folder aria-hidden="true" />
              <span className="prompt-composer__strip-text">
                {contextStrip.folder}
              </span>
            </span>
          )}
          {contextStrip.source && (
            <span
              className="prompt-composer__strip-item prompt-composer__strip-branch"
              title={contextStrip.source}
              aria-label={contextStrip.source}
            >
              {contextStrip.branch ? (
                <GitBranch aria-hidden="true" />
              ) : (
                <FolderGit2 aria-hidden="true" />
              )}
              <span className="prompt-composer__strip-text">
                Space checkout:{' '}
                {contextStrip.branch
                  ? `${contextStrip.branch}${contextStrip.dirty ? ' *' : ''}`
                  : contextStrip.dirty
                    ? 'dirty *'
                    : contextStrip.worktree}
              </span>
              {contextStrip.worktree && (
                <span
                  className="prompt-composer__strip-kind"
                  title={`Space worktree: ${contextStrip.worktree}`}
                >
                  Worktree
                </span>
              )}
            </span>
          )}
        </div>
      )}
      <p
        id="herdr-prompt-byte-limit"
        className="prompt-composer__byte-limit"
        role="status"
      >
        {draftInputError ??
          `${combinedBytes} / ${MAX_DRAFT_BYTES} UTF-8 bytes${image?.uploaded ? ' including image context' : image ? ' (text only; image context not ready)' : ''}`}
      </p>
      {image && onQueueText && (
        <p className="prompt-composer__byte-limit">
          Images cannot be held in Web. Use Send or remove the image.
        </p>
      )}
      {imageAttachment?.notice && (
        <p className="prompt-composer__byte-limit" role="status">
          {imageAttachment.notice}
        </p>
      )}
      {draftNotice && <p role="status">{draftNotice}</p>}
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
