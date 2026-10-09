import { useEffect, useState } from 'react'
import {
  CHAT_PREFERENCES_KEY,
  DEFAULT_CHAT_PREFERENCES,
  sanitizeChatPreferences,
  type IChatPreferences
} from '@/utils/chat-preferences.ts'
const read = () => {
  try {
    return sanitizeChatPreferences(
      JSON.parse(localStorage.getItem(CHAT_PREFERENCES_KEY) ?? 'null')
    )
  } catch {
    return { ...DEFAULT_CHAT_PREFERENCES }
  }
}
export const useChatPreferences = () => {
  const [preferences, setPreferences] = useState(read)
  const [storageError, setStorageError] = useState(false)
  useEffect(() => {
    const sync = () => setPreferences(read())
    window.addEventListener('storage', sync)
    window.addEventListener('herdr-chat-preferences', sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener('herdr-chat-preferences', sync)
    }
  }, [])
  const update = (value: IChatPreferences) => {
    const next = sanitizeChatPreferences(value)
    setPreferences(next)
    try {
      localStorage.setItem(CHAT_PREFERENCES_KEY, JSON.stringify(next))
      setStorageError(false)
      window.dispatchEvent(new Event('herdr-chat-preferences'))
    } catch {
      setStorageError(true)
    }
  }
  return { preferences, update, storageError }
}
