export type IPushState =
  | 'unsupported'
  | 'install-required'
  | 'inactive'
  | 'active'
  | 'denied'
  | 'busy'
  | 'backend-error'

export const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData =
    typeof atob === 'function'
      ? atob(base64)
      : Buffer.from(base64, 'base64').toString('binary')
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export const isStandaloneDisplay = (): boolean => {
  if (typeof window === 'undefined') return false
  const nav = window.navigator as { standalone?: boolean }
  if (nav && typeof nav.standalone === 'boolean') {
    return nav.standalone
  }
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(display-mode: standalone)').matches
  }
  return false
}

export const isIosDevice = (): boolean => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return isIos
}

export interface IResolvePushStateParams {
  isSupported: boolean
  isIos: boolean
  isStandalone: boolean
  permission: NotificationPermission | null
  hasSubscription: boolean
  isBusy: boolean
  backendError: string | null
}

export const resolvePushState = (params: IResolvePushStateParams): IPushState => {
  if (params.isBusy) return 'busy'
  if (!params.isSupported) return 'unsupported'
  if (params.isIos && !params.isStandalone) return 'install-required'
  if (params.permission === 'denied') return 'denied'
  if (params.backendError) return 'backend-error'
  if (params.hasSubscription && params.permission === 'granted') return 'active'
  return 'inactive'
}
