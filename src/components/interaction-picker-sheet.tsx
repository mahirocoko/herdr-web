import { useEffect, useRef, useState } from 'react'
import type { FC, FormEvent } from 'react'
import {
  AlertTriangle,
  ChevronRight,
  Edit2,
  Loader2,
  Pin,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react'
import type { IInteractionCatalog } from '@/types/herdr.ts'
import { CatalogError, fetchInteractionCatalog } from '@/services/api-client.ts'
import { groupMergedItemsByCategory } from '@/utils/interaction-picker.ts'
import Button from '@/components/ui/button.tsx'
import Input from '@/components/ui/input.tsx'
import Textarea from '@/components/ui/textarea.tsx'
import Checkbox from '@/components/ui/checkbox.tsx'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group.tsx'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet.tsx'
import { Tabs, TabsList, TabsTab, TabsPanel } from '@/components/ui/tabs.tsx'
import { Toggle } from '@/components/ui/toggle.tsx'
import { ToggleGroup } from '@/components/ui/toggle-group.tsx'

import {
  CANONICAL_TERMINAL_KEYS,
  KEY_PRESETS,
  TERMINAL_KEY_META_MAP,
  type CanonicalTerminalKey,
} from '@/utils/terminal-keys.ts'
import {
  deleteCustomAction,
  getActionsForScope,
  getRailKeys,
  getStorageIntegrityStatus,
  MAX_STORAGE_BYTES,
  mergeCatalogWithUserActions,
  resetRailKeys,
  saveCustomAction,
  setRailKeys,
  type ActionKind,
  type ActionScopeType,
  type IMergedCatalogItem,
  type IUserCustomAction,
} from '@/utils/custom-actions-storage.ts'

export type PickerSheetTab = 'commands' | 'actions' | 'rail'
export type IPickerSheetTab = PickerSheetTab

export interface IInteractionPickerSheetProps {
  isOpen: boolean
  paneId: string | null
  terminalId: string | null
  workspaceId?: string | null
  mode: 'agent' | 'shell'
  existingDraft: string
  initialTab?: PickerSheetTab
  onFillDraft: (value: string) => void
  onReplaceDraft: (value: string) => void
  onAppendDraft: (value: string) => void
  onSendKeys?: (keys: string[]) => void
  onClose: () => void
  triggerRef?: React.RefObject<HTMLElement | null>
}

const InteractionPickerSheet: FC<IInteractionPickerSheetProps> = ({
  isOpen,
  paneId,
  terminalId,
  workspaceId,
  mode,
  existingDraft,
  initialTab = 'commands',
  onFillDraft,
  onReplaceDraft,
  onAppendDraft,
  onSendKeys,
  onClose,
  triggerRef,
}) => {
  const [activeTab, setActiveTab] = useState<PickerSheetTab>(initialTab)
  const [catalog, setCatalog] = useState<IInteractionCatalog | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedItemForConfirm, setSelectedItemForConfirm] =
    useState<IMergedCatalogItem | null>(null)

  // User actions state
  const [, setUserActionsRev] = useState(0)
  const [editingAction, setEditingAction] = useState<IUserCustomAction | null>(
    null,
  )
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // Action form state
  const [formLabel, setFormLabel] = useState('')
  const [formKind, setFormKind] = useState<ActionKind>('draft-fill')
  const [formFillValue, setFormFillValue] = useState('')
  const [formKeys, setFormKeys] = useState<string[]>([])
  const [formScope, setFormScope] = useState<ActionScopeType>('global')
  const [formCategory, setFormCategory] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formPinned, setFormPinned] = useState(false)

  // Rail configuration state
  const [railScope, setRailScope] = useState<ActionScopeType>('global')
  const [activeRailKeys, setActiveRailKeys] = useState<string[]>(() =>
    getRailKeys(workspaceId),
  )
  const [railMessage, setRailMessage] = useState<string | null>(null)

  const sheetRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  // Refresh active tab if initialTab changes on open
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab)
      setActiveRailKeys(getRailKeys(workspaceId))
      setDeleteConfirmId(null)
      setFormError(null)
      setRailMessage(null)
    }
  }, [isOpen, initialTab, workspaceId])

  // Fetch catalog lazily on open
  useEffect(() => {
    if (!isOpen || !paneId || !terminalId) {
      setCatalog(null)
      setError(null)
      setErrorStatus(null)
      setSelectedItemForConfirm(null)
      setSearchQuery('')
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)
    setErrorStatus(null)
    setSelectedItemForConfirm(null)
    setSearchQuery('')

    fetchInteractionCatalog(paneId, terminalId)
      .then((data) => {
        if (!cancelled) {
          setCatalog(data.catalog)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setIsLoading(false)
          const status =
            err instanceof CatalogError ? err.status : (err?.status ?? 500)
          setErrorStatus(status)
          setError(err instanceof Error ? err.message : String(err))
        }
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, paneId, terminalId])

  // Base UI Dialog handles focus containment, Escape dismissal, and outside click natively.
  // We keep close button initial focus and trigger restoration.
  useEffect(() => {
    if (!isOpen) return

    const frame = requestAnimationFrame(() => {
      closeButtonRef.current?.focus()
    })

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [isOpen])

  const handleManualDismiss = () => {
    setSelectedItemForConfirm(null)
    setEditingAction(null)
    setDeleteConfirmId(null)
    onClose()
    requestAnimationFrame(() => {
      triggerRef?.current?.focus()
    })
  }

  const openNewActionForm = () => {
    setEditingAction(null)
    setFormLabel('')
    setFormKind('draft-fill')
    setFormFillValue('')
    setFormKeys([])
    setFormScope(workspaceId ? 'space' : 'global')
    setFormCategory('')
    setFormDescription('')
    setFormPinned(false)
    setFormError(null)
    setDeleteConfirmId(null)
    setActiveTab('actions')
  }

  const openEditActionForm = (action: IUserCustomAction) => {
    setEditingAction(action)
    setFormLabel(action.label)
    setFormKind(action.kind)
    setFormFillValue(action.fillValue || '')
    setFormKeys(action.keys || [])
    setFormScope(action.scope)
    setFormCategory(action.category || '')
    setFormDescription(action.description || '')
    setFormPinned(Boolean(action.pinned))
    setFormError(null)
    setDeleteConfirmId(null)
    setActiveTab('actions')
  }

  const handleSaveActionSubmit = (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const integrity = getStorageIntegrityStatus()
    if (integrity.oversized) {
      setFormError(
        'Existing storage is oversized; refusing to overwrite existing store',
      )
      return
    }
    if (integrity.corrupt) {
      setFormError(
        'Existing storage contains corrupt data; refusing to overwrite existing store',
      )
      return
    }

    if (formLabel.trim().length === 0) {
      setFormError('Action name/label is required')
      return
    }

    if (formKind === 'draft-fill' && formFillValue.trim().length === 0) {
      setFormError('Fill value is required for Draft Fill actions')
      return
    }

    if (formKind === 'terminal-key' && formKeys.length === 0) {
      setFormError('Select at least one terminal key')
      return
    }

    const res = saveCustomAction(
      {
        id: editingAction?.id,
        label: formLabel.trim(),
        kind: formKind,
        ...(formKind === 'draft-fill' ? { fillValue: formFillValue } : {}),
        ...(formKind === 'terminal-key' ? { keys: formKeys } : {}),
        category: formCategory.trim() || undefined,
        description: formDescription.trim() || undefined,
        pinned: formPinned,
        scope: formScope,
        spaceId: formScope === 'space' ? workspaceId || undefined : undefined,
      },
      workspaceId,
    )

    if (!res.ok) {
      setFormError(res.error || 'Failed to save action')
      return
    }

    setUserActionsRev((r) => r + 1)
    setEditingAction(null)
    setActiveTab('commands')
  }

  const handleDeleteAction = (id: string) => {
    const integrity = getStorageIntegrityStatus()
    if (integrity.oversized || integrity.corrupt) {
      setFormError(
        'Existing storage is corrupt or oversized; refusing to modify store',
      )
      return
    }

    const res = deleteCustomAction(id)
    if (!res.ok) {
      setFormError(res.error || 'Failed to delete action')
      return
    }

    setUserActionsRev((r) => r + 1)
    setEditingAction(null)
    setDeleteConfirmId(null)
    setActiveTab('commands')
  }

  const handleApplyRailPreset = (keys: readonly CanonicalTerminalKey[]) => {
    const integrity = getStorageIntegrityStatus()
    if (integrity.oversized || integrity.corrupt) {
      setRailMessage(
        'Existing storage is corrupt or oversized; refusing to update rail',
      )
      return
    }

    const keyArray = [...keys]
    const res = setRailKeys(keyArray, workspaceId, railScope)
    if (res.ok) {
      setActiveRailKeys(keyArray)
      setRailMessage('Preset applied')
    } else {
      setRailMessage(res.error || 'Failed to apply preset')
    }
  }

  const handleResetRailToDefault = () => {
    const integrity = getStorageIntegrityStatus()
    if (integrity.oversized || integrity.corrupt) {
      setRailMessage(
        'Existing storage is corrupt or oversized; refusing to update rail',
      )
      return
    }

    const res = resetRailKeys(workspaceId, railScope)
    if (res.ok) {
      setActiveRailKeys(getRailKeys(workspaceId))
      setRailMessage('Reset to default keys')
    } else {
      setRailMessage(res.error || 'Failed to reset rail')
    }
  }

  if (!isOpen) return null

  // Collect user actions for active scope
  const { global: globalUserActions, space: spaceUserActions } =
    getActionsForScope(workspaceId)
  const relevantUserActions = [...globalUserActions, ...spaceUserActions]

  // Merge repo catalog and user actions
  const mergedItems = mergeCatalogWithUserActions(
    catalog?.items || [],
    relevantUserActions,
    mode,
    searchQuery,
  )

  const hasExistingDraft = Boolean(
    existingDraft && existingDraft.trim().length > 0,
  )

  const handleItemClick = (item: IMergedCatalogItem) => {
    // If it's a terminal key action, dispatch through existing mutation pipeline directly
    if (item.kind === 'terminal-key' && item.keys && item.keys.length > 0) {
      onSendKeys?.(item.keys)
      handleManualDismiss()
      return
    }

    // Direct execution out of scope for draft fill: pre-fill composer inertly
    const fillVal = item.fillValue || ''
    if (!hasExistingDraft) {
      setSelectedItemForConfirm(null)
      onFillDraft(fillVal)
      handleManualDismiss()
    } else {
      setSelectedItemForConfirm(item)
    }
  }

  const handleConfirmReplace = () => {
    if (selectedItemForConfirm && selectedItemForConfirm.fillValue) {
      const val = selectedItemForConfirm.fillValue
      setSelectedItemForConfirm(null)
      onReplaceDraft(val)
      handleManualDismiss()
    }
  }

  const handleConfirmAppend = () => {
    if (selectedItemForConfirm && selectedItemForConfirm.fillValue) {
      const val = selectedItemForConfirm.fillValue
      setSelectedItemForConfirm(null)
      onAppendDraft(val)
      handleManualDismiss()
    }
  }

  const categoriesMap = groupMergedItemsByCategory(mergedItems)
  const shouldShowSearch = mergedItems.length > 8

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleManualDismiss()
      }}
    >
      <SheetContent
        id="interaction-picker-sheet"
        ref={sheetRef}
        side="bottom"
        className="drawer-sheet interaction-picker-sheet"
        aria-label="Quick Commands and Custom Actions"
      >

        <SheetHeader className="drawer-sheet__header">
          <div className="drawer-sheet__title-group">
            <SheetTitle className="drawer-sheet__title">
              Commands &amp; Keys
            </SheetTitle>
            <span
              className="interaction-picker__scope-badge"
              title="Saved in browser storage only"
            >
              Browser-local
            </span>
          </div>
          <Button
            ref={closeButtonRef}
            type="button"
            variant="ghost"
            size="icon"
            className="drawer-sheet__close-btn"
            onClick={handleManualDismiss}
            aria-label="Close command picker"
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </SheetHeader>

        {/* In-Sheet Navigation Tabs (Never stack modal sheets) */}
        <Tabs
          value={activeTab}
          onValueChange={(val) => {
            const nextTab = val as PickerSheetTab
            if (nextTab === 'actions') {
              openNewActionForm()
            } else {
              setEditingAction(null)
              setActiveTab(nextTab)
            }
          }}
          className="interaction-picker__tabs-root"
        >
          <TabsList
            className="interaction-picker__tabs"
            aria-label="Sheet views"
          >
            <TabsTab
              value="commands"
              className={`interaction-picker__tab ${activeTab === 'commands' ? 'interaction-picker__tab--active' : ''}`}
            >
              <SquareTerminal size={14} aria-hidden="true" />
              <span>Commands</span>
            </TabsTab>
            <TabsTab
              value="actions"
              className={`interaction-picker__tab ${activeTab === 'actions' ? 'interaction-picker__tab--active' : ''}`}
            >
              <Plus size={14} aria-hidden="true" />
              <span>{editingAction ? 'Edit Action' : 'New Action'}</span>
            </TabsTab>
            <TabsTab
              value="rail"
              className={`interaction-picker__tab ${activeTab === 'rail' ? 'interaction-picker__tab--active' : ''}`}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span>Key Rail</span>
            </TabsTab>
          </TabsList>

          {/* TAB 1: COMMANDS CATALOG */}
          <TabsPanel value="commands" className="interaction-picker__tab-panel">
            {/* Existing Draft Collision Confirmation */}
            {selectedItemForConfirm && (
              <div
                className="picker-confirm-panel"
                role="alertdialog"
                aria-label="Confirm Draft Fill"
              >
                <div className="picker-confirm-panel__header">
                  <AlertTriangle
                    size={16}
                    className="picker-confirm-panel__icon"
                    aria-hidden="true"
                  />
                  <span className="picker-confirm-panel__title">
                    Draft has existing text
                  </span>
                </div>
                <p className="picker-confirm-panel__desc">
                  Choose how to apply{' '}
                  <strong>{selectedItemForConfirm.label}</strong>:
                </p>
                <div className="picker-confirm-panel__preview">
                  <code>{selectedItemForConfirm.fillValue}</code>
                </div>
                <div className="picker-confirm-panel__actions">
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    className="picker-confirm-btn picker-confirm-btn--replace"
                    onClick={handleConfirmReplace}
                  >
                    Replace
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="picker-confirm-btn picker-confirm-btn--append"
                    onClick={handleConfirmAppend}
                  >
                    Append
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="picker-confirm-btn picker-confirm-btn--cancel"
                    onClick={() => setSelectedItemForConfirm(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {!selectedItemForConfirm && (
              <>
                <div className="interaction-picker__toolbar">
                  {shouldShowSearch && (
                    <div className="interaction-picker__search-bar">
                      <Search
                        size={14}
                        className="interaction-picker__search-icon"
                        aria-hidden="true"
                      />
                      <Input
                        type="text"
                        className="interaction-picker__search-input"
                        placeholder="Filter commands..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        aria-label="Filter commands"
                      />
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="interaction-picker__add-btn"
                    onClick={openNewActionForm}
                    aria-label="Add custom action"
                  >
                    <Plus size={14} aria-hidden="true" />
                    <span>Add Custom Action</span>
                  </Button>
                </div>

                <div className="interaction-picker__body">
                  {isLoading && (
                    <div className="interaction-picker__loading">
                      <Loader2 size={16} className="spin" aria-hidden="true" />
                      <span>Loading commands...</span>
                    </div>
                  )}

                  {!isLoading && error && (
                    <div className="interaction-picker__error" role="alert">
                      <AlertTriangle
                        size={16}
                        className="interaction-picker__error-icon"
                        aria-hidden="true"
                      />
                      <div className="interaction-picker__error-text">
                        {errorStatus === 409
                          ? 'Terminal replaced or stale. Refresh pane to update commands.'
                          : errorStatus === 422
                            ? `Invalid commands configuration: ${error}`
                            : error}
                      </div>
                    </div>
                  )}

                  {!isLoading && mergedItems.length === 0 && (
                    <div className="interaction-picker__empty" role="status">
                      <span>
                        {searchQuery.trim()
                          ? `No commands match "${searchQuery}".`
                          : `No commands available for this mode (${mode}). Click "Add Custom Action" to create one.`}
                      </span>
                    </div>
                  )}

                  {!isLoading && mergedItems.length > 0 && (
                    <div className="interaction-picker__categories">
                      {Array.from(categoriesMap.entries()).map(
                        ([cat, items]) => (
                          <div
                            key={cat}
                            className="interaction-picker__category"
                          >
                            <div className="interaction-picker__category-title">
                              {cat}
                            </div>
                            <div className="interaction-picker__items-list">
                              {items.map((item) => {
                                const isUserAction = item.provenance === 'user'
                                return (
                                  <div
                                    key={item.id}
                                    className="interaction-picker__item-row"
                                  >
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className="interaction-picker__item-btn"
                                      onClick={() => handleItemClick(item)}
                                      aria-label={`Select ${item.label}`}
                                    >
                                      <div className="interaction-picker__item-main">
                                        <div className="interaction-picker__item-header">
                                          <span className="interaction-picker__item-label">
                                            {item.label}
                                          </span>
                                          {item.pinned && (
                                            <Pin
                                              size={11}
                                              className="interaction-picker__pin-icon"
                                              aria-label="Pinned"
                                            />
                                          )}
                                          <span
                                            className={`interaction-picker__provenance-badge interaction-picker__provenance-badge--${item.provenance}`}
                                          >
                                            {isUserAction
                                              ? item.userAction?.scope ===
                                                'space'
                                                ? 'Space'
                                                : 'Personal'
                                              : 'Repo'}
                                          </span>
                                          {item.kind === 'terminal-key' && (
                                            <span className="interaction-picker__kind-badge">
                                              Key
                                            </span>
                                          )}
                                        </div>
                                        {item.description && (
                                          <div className="interaction-picker__item-desc">
                                            {item.description}
                                          </div>
                                        )}
                                        {item.kind === 'draft-fill' &&
                                          item.fillValue && (
                                            <code className="interaction-picker__item-preview">
                                              {item.fillValue}
                                            </code>
                                          )}
                                        {item.kind === 'terminal-key' &&
                                          item.keys && (
                                            <div className="interaction-picker__keys-preview">
                                              {item.keys.map((k) => (
                                                <kbd
                                                  key={k}
                                                  className="interaction-picker__key-tag"
                                                >
                                                  {TERMINAL_KEY_META_MAP[
                                                    k as CanonicalTerminalKey
                                                  ]?.label || k.toUpperCase()}
                                                </kbd>
                                              ))}
                                            </div>
                                          )}
                                      </div>
                                      <ChevronRight
                                        size={14}
                                        className="interaction-picker__item-chevron"
                                        aria-hidden="true"
                                      />
                                    </Button>

                                    {isUserAction && item.userAction && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="interaction-picker__edit-btn"
                                        onClick={() =>
                                          openEditActionForm(item.userAction!)
                                        }
                                        aria-label={`Edit ${item.label}`}
                                        title="Edit custom action"
                                      >
                                        <Edit2 size={13} aria-hidden="true" />
                                      </Button>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </TabsPanel>

          {/* TAB 2: ACTION EDITOR (CREATE / EDIT) */}
          <TabsPanel value="actions" className="interaction-picker__tab-panel">
            <form
              className="interaction-picker__form"
              onSubmit={handleSaveActionSubmit}
            >
              <div className="interaction-picker__form-header">
                <span className="interaction-picker__form-title">
                  {editingAction
                    ? 'Edit Custom Action'
                    : 'Create Custom Action'}
                </span>
                <p className="interaction-picker__form-hint">
                  Persisted in this browser only (
                  {getStorageIntegrityStatus().bytes} / {MAX_STORAGE_BYTES} B
                  used).
                </p>
              </div>

              {getStorageIntegrityStatus().corrupt && (
                <div className="interaction-picker__form-error" role="alert">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>
                    Existing browser storage contains corrupt data. Modification
                    is blocked to prevent data loss.
                  </span>
                </div>
              )}

              {getStorageIntegrityStatus().oversized && (
                <div className="interaction-picker__form-error" role="alert">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>
                    Existing browser storage is oversized (
                    {getStorageIntegrityStatus().bytes} &gt; {MAX_STORAGE_BYTES}{' '}
                    B). Modification is blocked.
                  </span>
                </div>
              )}

              {formError && (
                <div className="interaction-picker__form-error" role="alert">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="interaction-picker__field">
                <label
                  htmlFor="action-label"
                  className="interaction-picker__field-label"
                >
                  Action Name (Label) *
                </label>
                <Input
                  id="action-label"
                  type="text"
                  name="label"
                  maxLength={100}
                  required
                  className="interaction-picker__input"
                  placeholder="e.g., Explain Error, Git Status..."
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                />
              </div>

              <div className="interaction-picker__field">
                <span className="interaction-picker__field-label">
                  Action Kind *
                </span>
                <RadioGroup
                  value={formKind}
                  onValueChange={(val) => setFormKind(val as ActionKind)}
                  name="kind"
                  aria-label="Action Kind"
                  className="interaction-picker__radio-group"
                >
                  <label className="interaction-picker__radio-label">
                    <RadioGroupItem value="draft-fill" id="kind-draft-fill" />
                    <span>Draft Fill (Fill Prompt)</span>
                  </label>
                  <label className="interaction-picker__radio-label">
                    <RadioGroupItem
                      value="terminal-key"
                      id="kind-terminal-key"
                    />
                    <span>Terminal Key Action</span>
                  </label>
                </RadioGroup>
              </div>

              {formKind === 'draft-fill' && (
                <div className="interaction-picker__field">
                  <label
                    htmlFor="action-fill-value"
                    className="interaction-picker__field-label"
                  >
                    Prompt Draft Text *
                  </label>
                  <Textarea
                    id="action-fill-value"
                    name="fillValue"
                    rows={3}
                    maxLength={1000}
                    required
                    className="interaction-picker__textarea"
                    placeholder="Draft text to fill into composer (requires explicit Send)..."
                    value={formFillValue}
                    onChange={(e) => setFormFillValue(e.target.value)}
                  />
                </div>
              )}

              {formKind === 'terminal-key' && (
                <div className="interaction-picker__field">
                  <span className="interaction-picker__field-label">
                    Terminal Keys (Select up to 16) *
                  </span>
                  <ToggleGroup
                    value={formKeys}
                    multiple={true}
                    onValueChange={(val) => {
                      if (val.length <= 16) {
                        setFormKeys(val)
                      }
                    }}
                    className="interaction-picker__keys-grid"
                    aria-label="Terminal Keys"
                  >
                    {CANONICAL_TERMINAL_KEYS.map((k) => {
                      const isSelected = formKeys.includes(k)
                      const meta = TERMINAL_KEY_META_MAP[k]
                      return (
                        <Toggle
                          key={k}
                          value={k}
                          size="compact"
                          className={`interaction-picker__key-chip ${isSelected ? 'interaction-picker__key-chip--selected' : ''}`}
                        >
                          {meta.label}
                        </Toggle>
                      )
                    })}
                  </ToggleGroup>
                  {formKeys.length > 0 && (
                    <div className="interaction-picker__selected-keys">
                      <span>Sequence: </span>
                      {formKeys.map((k, idx) => (
                        <span
                          key={`${k}-${idx}`}
                          className="interaction-picker__key-badge"
                        >
                          {TERMINAL_KEY_META_MAP[k as CanonicalTerminalKey]
                            ?.label || k}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="interaction-picker__field">
                <span className="interaction-picker__field-label">
                  Storage Scope *
                </span>
                <RadioGroup
                  value={formScope}
                  onValueChange={(val) => setFormScope(val as ActionScopeType)}
                  name="scope"
                  aria-label="Storage Scope"
                  className="interaction-picker__radio-group"
                >
                  <label className="interaction-picker__radio-label">
                    <RadioGroupItem value="global" id="scope-global" />
                    <span>Global (All Spaces in this browser)</span>
                  </label>
                  {workspaceId && (
                    <label className="interaction-picker__radio-label">
                      <RadioGroupItem value="space" id="scope-space" />
                      <span>Selected Space only (ID: {workspaceId})</span>
                    </label>
                  )}
                </RadioGroup>
              </div>

              <div className="interaction-picker__field">
                <label
                  htmlFor="action-category"
                  className="interaction-picker__field-label"
                >
                  Category (Optional)
                </label>
                <Input
                  id="action-category"
                  type="text"
                  name="category"
                  maxLength={50}
                  className="interaction-picker__input"
                  placeholder="e.g., Git, Diagnostics, Review"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                />
              </div>

              <div className="interaction-picker__field">
                <label
                  htmlFor="action-desc"
                  className="interaction-picker__field-label"
                >
                  Description (Optional)
                </label>
                <Input
                  id="action-desc"
                  type="text"
                  name="description"
                  maxLength={250}
                  className="interaction-picker__input"
                  placeholder="Brief explanation..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                />
              </div>

              <div className="interaction-picker__checkbox-row">
                <label
                  className="interaction-picker__checkbox-label"
                  htmlFor="action-pinned"
                >
                  <Checkbox
                    id="action-pinned"
                    name="pinned"
                    checked={formPinned}
                    onCheckedChange={(checked) =>
                      setFormPinned(Boolean(checked))
                    }
                  />
                  <span>Pin to top of list</span>
                </label>
              </div>

              <div className="interaction-picker__form-actions">
                <Button
                  type="submit"
                  variant="default"
                  className="interaction-picker__submit-btn"
                >
                  {editingAction ? 'Save Changes' : 'Create Action'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="interaction-picker__cancel-btn"
                  onClick={() => {
                    setEditingAction(null)
                    setActiveTab('commands')
                  }}
                >
                  Cancel
                </Button>

                {editingAction && !deleteConfirmId && (
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    className="interaction-picker__delete-btn"
                    onClick={() => setDeleteConfirmId(editingAction.id)}
                    aria-label="Delete this custom action"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    <span>Delete</span>
                  </Button>
                )}
              </div>

              {/* Inline Delete Confirmation */}
              {deleteConfirmId && (
                <div
                  className="interaction-picker__delete-confirm"
                  role="alertdialog"
                >
                  <span>
                    Delete action "{editingAction?.label}" permanently?
                  </span>
                  <div className="interaction-picker__delete-confirm-btns">
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      className="picker-confirm-btn picker-confirm-btn--replace"
                      onClick={() => handleDeleteAction(deleteConfirmId)}
                    >
                      Confirm Delete
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="picker-confirm-btn picker-confirm-btn--cancel"
                      onClick={() => setDeleteConfirmId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </form>
          </TabsPanel>

          {/* TAB 3: KEY RAIL CONFIGURATOR */}
          <TabsPanel value="rail" className="interaction-picker__tab-panel">
            <div className="interaction-picker__rail-panel">
              <div className="interaction-picker__form-header">
                <span className="interaction-picker__form-title">
                  Terminal Key Rail
                </span>
                <p className="interaction-picker__form-hint">
                  Configure which touch keys appear on your terminal rail in
                  this browser.
                </p>
              </div>

              {railMessage && (
                <div className="interaction-picker__rail-notice" role="status">
                  {railMessage}
                </div>
              )}

              <div className="interaction-picker__field">
                <span className="interaction-picker__field-label">
                  Rail Presets
                </span>
                <div className="interaction-picker__presets-row">
                  {KEY_PRESETS.map((p) => (
                    <Button
                      key={p.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="interaction-picker__preset-btn"
                      onClick={() => handleApplyRailPreset(p.keys)}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="interaction-picker__field">
                <span className="interaction-picker__field-label">
                  Active Rail Keys ({activeRailKeys.length}) · Click to Toggle
                </span>
                <ToggleGroup
                  value={activeRailKeys}
                  multiple={true}
                  onValueChange={(val) => {
                    if (val.length === 0) {
                      setRailMessage('Rail must contain at least one key')
                      return
                    }
                    const integrity = getStorageIntegrityStatus()
                    if (integrity.oversized || integrity.corrupt) {
                      setRailMessage(
                        'Existing storage is corrupt or oversized; refusing to update rail',
                      )
                      return
                    }
                    const res = setRailKeys(val, workspaceId, railScope)
                    if (res.ok) {
                      setActiveRailKeys(val)
                      setRailMessage('Key rail updated')
                    } else {
                      setRailMessage(res.error || 'Failed to update rail')
                    }
                  }}
                  className="interaction-picker__keys-grid"
                  aria-label="Active Rail Keys"
                >
                  {CANONICAL_TERMINAL_KEYS.map((k) => {
                    const isActive = activeRailKeys.includes(k)
                    const meta = TERMINAL_KEY_META_MAP[k]
                    return (
                      <Toggle
                        key={k}
                        value={k}
                        size="compact"
                        className={`interaction-picker__key-chip ${isActive ? 'interaction-picker__key-chip--selected' : ''}`}
                      >
                        {meta.label}
                      </Toggle>
                    )
                  })}
                </ToggleGroup>
              </div>

              <div className="interaction-picker__field">
                <span className="interaction-picker__field-label">
                  Configuration Scope
                </span>
                <RadioGroup
                  value={railScope}
                  onValueChange={(val) => setRailScope(val as ActionScopeType)}
                  name="railScope"
                  aria-label="Configuration Scope"
                  className="interaction-picker__radio-group"
                >
                  <label className="interaction-picker__radio-label">
                    <RadioGroupItem value="global" id="rail-scope-global" />
                    <span>Global (All Spaces)</span>
                  </label>
                  {workspaceId && (
                    <label className="interaction-picker__radio-label">
                      <RadioGroupItem value="space" id="rail-scope-space" />
                      <span>This Space only</span>
                    </label>
                  )}
                </RadioGroup>
              </div>

              <div className="interaction-picker__rail-actions">
                <Button
                  type="button"
                  variant="outline"
                  className="interaction-picker__reset-btn"
                  onClick={handleResetRailToDefault}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  <span>Reset to Default (6 Keys)</span>
                </Button>
                <Button
                  type="button"
                  variant="default"
                  className="interaction-picker__submit-btn"
                  onClick={() => setActiveTab('commands')}
                >
                  Done
                </Button>
              </div>
            </div>
          </TabsPanel>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

export default InteractionPickerSheet
