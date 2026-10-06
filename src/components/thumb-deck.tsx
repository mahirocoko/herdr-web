import { useEffect, useState } from 'react'
import type { FC } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import Button from '@/components/ui/button.tsx'

import {
  TERMINAL_KEY_META_MAP,
  type CanonicalTerminalKey,
} from '@/utils/terminal-keys.ts'
import {
  CUSTOM_ACTIONS_CHANGE_EVENT,
  getRailKeys,
} from '@/utils/custom-actions-storage.ts'

export interface IThumbDeckProps {
  paneId: string | null
  isBusy: boolean
  workspaceId?: string | null
  onSendKeys: (keys: string[]) => void
  onSendPrompt?: (text: string) => void
  onOpenManage?: () => void
}

const ThumbDeck: FC<IThumbDeckProps> = ({
  paneId,
  isBusy,
  workspaceId,
  onSendKeys,
  onOpenManage,
}) => {
  const [railKeys, setRailKeysState] = useState<string[]>(() =>
    getRailKeys(workspaceId),
  )

  // Synchronize when workspaceId changes
  useEffect(() => {
    setRailKeysState(getRailKeys(workspaceId))
  }, [workspaceId])

  // Subscribe to same-scope editor updates and storage events
  useEffect(() => {
    const handleStorageChange = () => {
      setRailKeysState(getRailKeys(workspaceId))
    }

    try {
      if (typeof window !== 'undefined') {
        window.addEventListener(
          CUSTOM_ACTIONS_CHANGE_EVENT,
          handleStorageChange,
        )
        window.addEventListener('storage', handleStorageChange)
      }
    } catch {
      // ignore
    }

    try {
      if (
        typeof globalThis !== 'undefined' &&
        typeof (globalThis as unknown as { addEventListener?: Function })
          .addEventListener === 'function'
      ) {
        ;(
          globalThis as unknown as { addEventListener: Function }
        ).addEventListener(CUSTOM_ACTIONS_CHANGE_EVENT, handleStorageChange)
      }
    } catch {
      // ignore
    }

    return () => {
      try {
        if (typeof window !== 'undefined') {
          window.removeEventListener(
            CUSTOM_ACTIONS_CHANGE_EVENT,
            handleStorageChange,
          )
          window.removeEventListener('storage', handleStorageChange)
        }
      } catch {
        // ignore
      }
      try {
        if (
          typeof globalThis !== 'undefined' &&
          typeof (globalThis as unknown as { removeEventListener?: Function })
            .removeEventListener === 'function'
        ) {
          ;(
            globalThis as unknown as { removeEventListener: Function }
          ).removeEventListener(
            CUSTOM_ACTIONS_CHANGE_EVENT,
            handleStorageChange,
          )
        }
      } catch {
        // ignore
      }
    }
  }, [workspaceId])

  const disabled = !paneId || isBusy

  return (
    <div className="thumb-deck" role="toolbar" aria-label="Terminal quick keys">
      <div className="thumb-deck__scroll-container">
        <div className="thumb-deck__keys-row">
          {railKeys.map((key) => {
            const meta = TERMINAL_KEY_META_MAP[key as CanonicalTerminalKey] ?? {
              label: key.toUpperCase(),
              ariaLabel: `Send key ${key}`,
            }

            return (
              <Button
                key={key}
                type="button"
                variant="secondary"
                size="sm"
                className="thumb-key-btn"
                data-key={key}
                disabled={disabled}
                onClick={() => onSendKeys([key])}
                aria-label={meta.ariaLabel}
              >
                {meta.label}
              </Button>
            )
          })}

          {onOpenManage && (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="thumb-key-btn thumb-key-btn--manage"
              onClick={onOpenManage}
              aria-label="Manage key rail and custom actions"
              title="Manage key rail and custom actions"
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ThumbDeck
