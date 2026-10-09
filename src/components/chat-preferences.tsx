import { useEffect, useState, type CSSProperties } from 'react'
import type { IChatPreferences } from '@/utils/chat-preferences.ts'
import { DEFAULT_CHAT_PREFERENCES } from '@/utils/chat-preferences.ts'
import Button from './ui/button.tsx'
interface IChatPreferencesProps {
  preferences: IChatPreferences
  onChange: (value: IChatPreferences) => void
  storageError: boolean
}
const ChatPreferences = ({
  preferences,
  onChange,
  storageError
}: IChatPreferencesProps) => {
  const [family, setFamily] = useState(preferences.fontFamily)
  useEffect(() => setFamily(preferences.fontFamily), [preferences.fontFamily])
  return (
    <details className="chat-preferences">
      <summary>Chat appearance</summary>
      <div className="chat-preferences-controls">
        <label>
          Text size
          <select
            name="chat-font-size"
            value={preferences.fontSize ?? ''}
            onChange={(e) =>
              onChange({
                ...preferences,
                fontSize: e.target.value ? Number(e.target.value) : null
              })
            }
          >
            <option value="">Default</option>
            {Array.from({ length: 14 }, (_, i) => i + 11).map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
        </label>
        <label>
          Lane width
          <select
            name="chat-lane-width"
            value={preferences.width}
            onChange={(e) =>
              onChange({
                ...preferences,
                width: e.target.value as IChatPreferences['width']
              })
            }
          >
            {['narrow', 'default', 'wide', 'full'].map((width) => (
              <option key={width} value={width}>
                {width}
              </option>
            ))}
          </select>
        </label>
        <label>
          Font family
          <input
            name="chat-font-family"
            value={family}
            placeholder="Default UI font"
            onChange={(e) => setFamily(e.target.value)}
            onBlur={() => onChange({ ...preferences, fontFamily: family })}
          />
        </label>
        <label>
          <input
            name="chat-show-thinking"
            type="checkbox"
            checked={preferences.showThinking}
            onChange={(e) =>
              onChange({ ...preferences, showThinking: e.target.checked })
            }
          />
          Show thinking
        </label>
        <Button
          variant="ghost"
          onClick={() => {
            setFamily('')
            onChange({ ...DEFAULT_CHAT_PREFERENCES })
          }}
        >
          Reset Chat appearance
        </Button>
        {storageError && (
          <p role="status">
            Preference changed for this view; browser storage is unavailable.
          </p>
        )}
      </div>
    </details>
  )
}
export const chatPreferenceStyle = (prefs: IChatPreferences): CSSProperties => {
  const style: Record<string, string> = {
    '--chat-w':
      prefs.width === 'narrow'
        ? '42rem'
        : prefs.width === 'wide'
          ? '72rem'
          : prefs.width === 'full'
            ? '100%'
            : '720px',
    '--font-chat': prefs.fontFamily
      ? `${prefs.fontFamily}, var(--font-sans)`
      : 'var(--font-sans)'
  }
  if (prefs.fontSize !== null)
    for (const [role, ratio] of Object.entries({
      body: 1,
      md: 14 / 15,
      sm: 13 / 15,
      xs: 12 / 15,
      '2xs': 11 / 15,
      lg: 16 / 15,
      xl: 18 / 15
    }))
      style[`--chat-fs-${role}`] = `${prefs.fontSize * ratio}px`
  return style as CSSProperties
}
export { ChatPreferences }
