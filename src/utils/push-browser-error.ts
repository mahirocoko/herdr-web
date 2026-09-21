const SAFE_BROWSER_ERROR_NAMES = new Set([
  'AbortError',
  'NotAllowedError',
  'InvalidStateError',
  'NotSupportedError',
  'SecurityError',
  'TypeError'
])

const readSafeBrowserErrorName = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') return null
  try {
    const name = (error as { name?: unknown }).name
    return typeof name === 'string' && name.length <= 32 && SAFE_BROWSER_ERROR_NAMES.has(name)
      ? name
      : null
  } catch {
    return null
  }
}

const describeErrorName = (fallback: string, name: string | null): string => {
  if (name === 'NotAllowedError') {
    return 'Push permission was not granted'
  }
  return name ? `${fallback} (${name})` : fallback
}

export const describePushBrowserError = (fallback: string, error?: unknown): string =>
  describeErrorName(fallback, readSafeBrowserErrorName(error))

// A coarse, local copy decision only: never retain or send the user agent.
export const isAndroidChrome = (userAgent: string): boolean =>
  /Android/i.test(userAgent) && /Chrome\//.test(userAgent) &&
  !/EdgA\/|OPR\/|SamsungBrowser\/|; wv\)/.test(userAgent)

export const describePushSubscribeError = (
  fallback: string,
  error: unknown,
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
): string => {
  const name = readSafeBrowserErrorName(error)
  // Only subscribe failures get provider guidance; an inspection or HTTP abort
  // says nothing about browser push-provider registration.
  if (name === 'AbortError' && isAndroidChrome(userAgent)) {
    return 'Browser push-provider registration failed (AbortError). Check or update Chrome and Google Play services, and check your network. Retry only after an update or network change. Herdr cannot repair the push provider.'
  }
  return describeErrorName(fallback, name)
}
