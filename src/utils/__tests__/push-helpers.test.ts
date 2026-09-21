import { describe, expect, test } from 'bun:test'
import {
  resolvePushState,
  urlBase64ToUint8Array
} from '../push-helpers.ts'

describe('src/utils/push-helpers: pure helpers and state machine resolution', () => {
  test('urlBase64ToUint8Array decodes base64url strings', () => {
    // Standard test string 'Hello World' in base64url: 'SGVsbG8gV29ybGQ'
    const arr = urlBase64ToUint8Array('SGVsbG8gV29ybGQ')
    const decoded = new TextDecoder().decode(arr)
    expect(decoded).toBe('Hello World')
  })

  test('resolvePushState returns busy when operation in flight', () => {
    const state = resolvePushState({
      isSupported: true,
      isIos: false,
      isStandalone: false,
      permission: 'granted',
      hasSubscription: true,
      isBusy: true,
      backendError: null
    })
    expect(state).toBe('busy')
  })

  test('resolvePushState returns backend-error when error present', () => {
    const state = resolvePushState({
      isSupported: true,
      isIos: false,
      isStandalone: false,
      permission: 'granted',
      hasSubscription: false,
      isBusy: false,
      backendError: 'Failed to connect'
    })
    expect(state).toBe('backend-error')
  })

  test('resolvePushState returns unsupported when Web Push is unavailable', () => {
    const state = resolvePushState({
      isSupported: false,
      isIos: false,
      isStandalone: false,
      permission: null,
      hasSubscription: false,
      isBusy: false,
      backendError: null
    })
    expect(state).toBe('unsupported')
  })

  test('resolvePushState returns install-required on iOS when not in standalone mode', () => {
    const state = resolvePushState({
      isSupported: true,
      isIos: true,
      isStandalone: false,
      permission: 'default',
      hasSubscription: false,
      isBusy: false,
      backendError: null
    })
    expect(state).toBe('install-required')
  })

  test('resolvePushState returns denied when Notification permission is denied', () => {
    const state = resolvePushState({
      isSupported: true,
      isIos: false,
      isStandalone: false,
      permission: 'denied',
      hasSubscription: false,
      isBusy: false,
      backendError: null
    })
    expect(state).toBe('denied')
  })

  test('permission denial wins over a rejected subscribe error', () => {
    const state = resolvePushState({
      isSupported: true,
      isIos: false,
      isStandalone: false,
      permission: 'denied',
      hasSubscription: false,
      isBusy: false,
      backendError: 'NotAllowedError'
    })
    expect(state).toBe('denied')
  })

  test('resolvePushState returns active when subscribed and permission granted', () => {
    const state = resolvePushState({
      isSupported: true,
      isIos: false,
      isStandalone: false,
      permission: 'granted',
      hasSubscription: true,
      isBusy: false,
      backendError: null
    })
    expect(state).toBe('active')
  })

  test('resolvePushState returns inactive when permission is default or not subscribed', () => {
    const state = resolvePushState({
      isSupported: true,
      isIos: false,
      isStandalone: false,
      permission: 'default',
      hasSubscription: false,
      isBusy: false,
      backendError: null
    })
    expect(state).toBe('inactive')
  })

})
