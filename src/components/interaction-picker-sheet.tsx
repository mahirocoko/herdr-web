import { useEffect, useRef, useState } from 'react'
import type { FC } from 'react'
import { AlertTriangle, ChevronRight, Loader2, Search, X } from 'lucide-react'
import type { ICatalogItem, IInteractionCatalog } from '@/types/herdr.ts'
import { CatalogError, fetchInteractionCatalog } from '@/services/api-client.ts'
import { filterCatalogItems, groupCatalogItemsByCategory } from '@/utils/interaction-picker.ts'

export interface IInteractionPickerSheetProps {
  isOpen: boolean
  paneId: string | null
  terminalId: string | null
  mode: 'agent' | 'shell'
  existingDraft: string
  onFillDraft: (value: string) => void
  onReplaceDraft: (value: string) => void
  onAppendDraft: (value: string) => void
  onClose: () => void
  triggerRef?: React.RefObject<HTMLElement | null>
}

const InteractionPickerSheet: FC<IInteractionPickerSheetProps> = ({
  isOpen,
  paneId,
  terminalId,
  mode,
  existingDraft,
  onFillDraft,
  onReplaceDraft,
  onAppendDraft,
  onClose,
  triggerRef
}) => {
  const [catalog, setCatalog] = useState<IInteractionCatalog | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedItemForConfirm, setSelectedItemForConfirm] = useState<ICatalogItem | null>(null)

  const sheetRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

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
          const status = err instanceof CatalogError ? err.status : (err?.status ?? 500)
          setErrorStatus(status)
          setError(err instanceof Error ? err.message : String(err))
        }
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, paneId, terminalId])

  // Accessibility: Focus trap, Escape key, deterministic trigger return
  useEffect(() => {
    if (!isOpen) return

    const frame = requestAnimationFrame(() => {
      closeButtonRef.current?.focus()
    })

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        handleManualDismiss()
        return
      }

      if (e.key === 'Tab') {
        const el = sheetRef.current
        if (!el) return
        const focusables = Array.from(
          el.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((node) => node.offsetParent !== null || node === closeButtonRef.current)

        if (focusables.length === 0) {
          e.preventDefault()
          return
        }

        const activeIdx = focusables.indexOf(document.activeElement as HTMLElement)
        if (e.shiftKey) {
          if (activeIdx <= 0) {
            e.preventDefault()
            focusables[focusables.length - 1].focus()
          }
        } else {
          if (activeIdx === -1 || activeIdx >= focusables.length - 1) {
            e.preventDefault()
            focusables[0].focus()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const handleManualDismiss = () => {
    setSelectedItemForConfirm(null)
    onClose()
    requestAnimationFrame(() => {
      triggerRef?.current?.focus()
    })
  }

  if (!isOpen) return null

  const rawItems = catalog?.items || []
  const filteredByMode = filterCatalogItems(rawItems, mode)

  // Show search only when catalog size makes it useful (>8)
  const shouldShowSearch = filteredByMode.length > 8
  const displayedItems =
    shouldShowSearch && searchQuery.trim()
      ? filterCatalogItems(filteredByMode, mode, searchQuery)
      : filteredByMode

  const hasExistingDraft = Boolean(existingDraft && existingDraft.trim().length > 0)

  const handleItemClick = (item: ICatalogItem) => {
    if (!hasExistingDraft) {
      setSelectedItemForConfirm(null)
      onFillDraft(item.fillValue)
      onClose()
    } else {
      setSelectedItemForConfirm(item)
    }
  }

  const handleConfirmReplace = () => {
    if (selectedItemForConfirm) {
      const fillValue = selectedItemForConfirm.fillValue
      setSelectedItemForConfirm(null)
      onReplaceDraft(fillValue)
      onClose()
    }
  }

  const handleConfirmAppend = () => {
    if (selectedItemForConfirm) {
      const fillValue = selectedItemForConfirm.fillValue
      setSelectedItemForConfirm(null)
      onAppendDraft(fillValue)
      onClose()
    }
  }

  const handleCancelConfirm = () => {
    setSelectedItemForConfirm(null)
  }

  // Group displayed items by category using pure helper
  const categoriesMap = groupCatalogItemsByCategory(displayedItems)

  return (
    <div className="drawer-overlay" onClick={handleManualDismiss} role="presentation">
      <div
        id="interaction-picker-sheet"
        ref={sheetRef}
        className="drawer-sheet interaction-picker-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Quick Commands"
      >
        <div className="drawer-sheet__handle" />

        <div className="drawer-sheet__header">
          <span className="drawer-sheet__title">Quick Commands</span>
          <button
            ref={closeButtonRef}
            type="button"
            className="drawer-sheet__close-btn"
            onClick={handleManualDismiss}
            aria-label="Close command picker"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Existing Draft Collision Confirmation */}
        {selectedItemForConfirm && (
          <div className="picker-confirm-panel" role="alertdialog" aria-label="Confirm Draft Fill">
            <div className="picker-confirm-panel__header">
              <AlertTriangle size={16} className="picker-confirm-panel__icon" aria-hidden="true" />
              <span className="picker-confirm-panel__title">Draft has existing text</span>
            </div>
            <p className="picker-confirm-panel__desc">
              Choose how to apply <strong>{selectedItemForConfirm.label}</strong>:
            </p>
            <div className="picker-confirm-panel__preview">
              <code>{selectedItemForConfirm.fillValue}</code>
            </div>
            <div className="picker-confirm-panel__actions">
              <button
                type="button"
                className="picker-confirm-btn picker-confirm-btn--replace"
                onClick={handleConfirmReplace}
              >
                Replace
              </button>
              <button
                type="button"
                className="picker-confirm-btn picker-confirm-btn--append"
                onClick={handleConfirmAppend}
              >
                Append
              </button>
              <button
                type="button"
                className="picker-confirm-btn picker-confirm-btn--cancel"
                onClick={handleCancelConfirm}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!selectedItemForConfirm && (
          <>
            {shouldShowSearch && (
              <div className="interaction-picker__search-bar">
                <Search size={14} className="interaction-picker__search-icon" aria-hidden="true" />
                <input
                  type="text"
                  className="interaction-picker__search-input"
                  placeholder="Filter commands..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Filter commands"
                />
              </div>
            )}

            <div className="interaction-picker__body">
              {isLoading && (
                <div className="interaction-picker__loading">
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                  <span>Loading commands...</span>
                </div>
              )}

              {!isLoading && error && (
                <div className="interaction-picker__error" role="alert">
                  <AlertTriangle size={16} className="interaction-picker__error-icon" aria-hidden="true" />
                  <div className="interaction-picker__error-text">
                    {errorStatus === 409
                      ? 'Terminal replaced or stale. Refresh pane to update commands.'
                      : errorStatus === 422
                        ? `Invalid commands configuration: ${error}`
                        : error}
                  </div>
                </div>
              )}

              {!isLoading && !error && filteredByMode.length === 0 && (
                <div className="interaction-picker__empty" role="status">
                  <span>No quick commands configured for this mode ({mode}).</span>
                </div>
              )}

              {!isLoading && !error && filteredByMode.length > 0 && displayedItems.length === 0 && (
                <div className="interaction-picker__empty" role="status">
                  <span>No commands match "{searchQuery}".</span>
                </div>
              )}

              {!isLoading && !error && displayedItems.length > 0 && (
                <div className="interaction-picker__categories">
                  {Array.from(categoriesMap.entries()).map(([cat, items]) => (
                    <div key={cat} className="interaction-picker__category">
                      <div className="interaction-picker__category-title">{cat}</div>
                      <div className="interaction-picker__items-list">
                        {items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="interaction-picker__item-btn"
                            onClick={() => handleItemClick(item)}
                            aria-label={`Select ${item.label}`}
                          >
                            <div className="interaction-picker__item-main">
                              <div className="interaction-picker__item-label">{item.label}</div>
                              {item.description && (
                                <div className="interaction-picker__item-desc">{item.description}</div>
                              )}
                              <code className="interaction-picker__item-preview">{item.fillValue}</code>
                            </div>
                            <ChevronRight size={14} className="interaction-picker__item-chevron" aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default InteractionPickerSheet
