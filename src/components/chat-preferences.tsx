import { useEffect, useState, type CSSProperties } from 'react'
import type { IChatPreferences } from '@/utils/chat-preferences.ts'
import { DEFAULT_CHAT_PREFERENCES } from '@/utils/chat-preferences.ts'
import Button from './ui/button.tsx'
import Input from './ui/input.tsx'
import Select from './ui/select.tsx'
import Checkbox from './ui/checkbox.tsx'
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
          <Select
            aria-label="Text size"
            value={
              preferences.fontSize === null
                ? 'default'
                : String(preferences.fontSize)
            }
            options={[
              { value: 'default', label: 'Default' },
              ...Array.from({ length: 14 }, (_, i) => ({
                value: String(i + 11),
                label: `${i + 11}px`
              }))
            ]}
            onValueChange={(value) =>
              onChange({
                ...preferences,
                fontSize: value === 'default' ? null : Number(value)
              })
            }
          />
        </label>
        <label>
          Lane width
          <Select
            aria-label="Lane width"
            value={preferences.width}
            options={['narrow', 'default', 'wide', 'full'].map((value) => ({
              value,
              label: value
            }))}
            onValueChange={(value) =>
              onChange({
                ...preferences,
                width: value as IChatPreferences['width']
              })
            }
          />
        </label>
        <label>
          Font family
          <Input
            name="chat-font-family"
            value={family}
            placeholder="Default UI font"
            maxLength={256}
            spellCheck={false}
            onKeyDown={(event) => {
              // dc2f11de SettingsDialog.FontFamilyInput: Enter commits, IME keeps Enter.
              if (
                event.key !== 'Enter' ||
                event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229
              )
                return
              event.preventDefault()
              onChange({ ...preferences, fontFamily: family })
            }}
            onChange={(e) => setFamily(e.target.value)}
            onBlur={() => onChange({ ...preferences, fontFamily: family })}
          />
        </label>
        <label>
          <Checkbox
            name="chat-show-thinking"
            checked={preferences.showThinking}
            onCheckedChange={(checked) =>
              onChange({ ...preferences, showThinking: checked })
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
