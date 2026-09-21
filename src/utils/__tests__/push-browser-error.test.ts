import { describe, expect, test } from 'bun:test'
import { runInNewContext } from 'node:vm'
import { describePushBrowserError, describePushSubscribeError, isAndroidChrome } from '../push-browser-error.ts'

describe('describePushBrowserError', () => {
  for (const name of ['AbortError', 'NotAllowedError']) {
    test(`${name} is classified across realms and structural error shapes`, () => {
      const foreignError = runInNewContext('Object.assign(new Error(), { name })', { name })
      expect(foreignError instanceof Error).toBe(false)
      const shapes = [foreignError, { name }, Object.assign(Object.create(null), { name })]
      for (const error of shapes) {
        if (name === 'NotAllowedError') {
          expect(describePushBrowserError('Push failed', error)).toBe('Push permission was not granted')
          expect(describePushSubscribeError('Push failed', error, 'Android Chrome/140')).toBe('Push permission was not granted')
        } else {
          expect(describePushBrowserError('Push failed', error)).toBe('Push failed (AbortError)')
          expect(describePushSubscribeError('Push failed', error, 'Android Chrome/140')).toContain('Google Play services')
          expect(describePushSubscribeError('Push failed', error, '')).toBe('Push failed (AbortError)')
        }
      }
    })
  }

  test('reads only name, exactly once, including the generic subscribe fallback', () => {
    for (const name of ['AbortError', 'NotAllowedError', 'SecurityError']) {
      for (const describe of [
        (error: unknown) => describePushBrowserError('Push failed', error),
        (error: unknown) => describePushSubscribeError('Push failed', error, 'Android Chrome/140'),
        (error: unknown) => describePushSubscribeError('Push failed', error, '')
      ]) {
        const reads: PropertyKey[] = []
        const error = new Proxy({}, {
          get: (_target, key) => {
            reads.push(key)
            if (key !== 'name') throw new Error('Forbidden field access')
            return name
          },
          getPrototypeOf: () => { throw new Error('Forbidden realm identity check') }
        })
        expect(describe(error)).not.toBe('Push failed')
        expect(reads).toEqual(['name'])
      }
    }
  })

  test('hostile name getters fail closed without inspecting the thrown value', () => {
    let reads = 0
    const error = { get name() { reads++; throw new Proxy({}, { get: () => { throw 'unreadable' } }) } }
    expect(describePushBrowserError('Push failed', error)).toBe('Push failed')
    expect(describePushSubscribeError('Push failed', error, 'Android Chrome/140')).toBe('Push failed')
    expect(reads).toBe(2)
  })

  test('non-string, oversized, unknown names and non-object values fail closed', () => {
    const noCoercion = { toString: () => { throw new Error('Must not coerce') } }
    for (const error of [
      null, undefined, 'AbortError', 42, Symbol('AbortError'),
      { name: null }, { name: 42 }, { name: noCoercion },
      { name: 'AbortError' + ' '.repeat(1000) }, { name: 'VendorPrivateFailure' },
      { name: 'aborterror' }, {}
    ]) {
      expect(describePushBrowserError('Push failed', error)).toBe('Push failed')
      expect(describePushSubscribeError('Push failed', error, 'Android Chrome/140')).toBe('Push failed')
    }
  })

  test('maps denied permission to fixed actionable copy', () => {
    expect(describePushBrowserError(
      'Failed to create the browser push subscription',
      new DOMException('private browser detail', 'NotAllowedError')
    )).toBe('Push permission was not granted')
  })

  test.each([
    'AbortError',
    'InvalidStateError',
    'NotSupportedError',
    'SecurityError'
  ])('exposes only allowlisted DOMException class %s', (name) => {
    const result = describePushBrowserError(
      'Failed to create the browser push subscription',
      new DOMException('private browser detail', name)
    )
    expect(result).toBe(`Failed to create the browser push subscription (${name})`)
    expect(result).not.toContain('private browser detail')
  })

  test('exposes TypeError class without raw message', () => {
    const result = describePushBrowserError(
      'Failed to start the browser push subscription',
      new TypeError('applicationServerKey and private data')
    )
    expect(result).toBe('Failed to start the browser push subscription (TypeError)')
    expect(result).not.toContain('applicationServerKey')
  })

  test('falls back without leaking arbitrary error names or messages', () => {
    const error = new Error('endpoint=https://secret.example/token')
    error.name = 'VendorPrivateFailure'
    expect(describePushBrowserError('Push failed', error)).toBe('Push failed')
  })

  test('Android Chrome subscribe AbortError gives bounded provider guidance without raw details', () => {
    const result = describePushSubscribeError(
      'Failed to create the browser push subscription',
      new DOMException('SERVICE_ERROR endpoint=https://private.example/token auth=secret p256dh=secret', 'AbortError'),
      'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36'
    )
    expect(result).toContain('Browser push-provider registration failed (AbortError)')
    expect(result).toContain('Chrome and Google Play services')
    expect(result).toContain('network')
    expect(result).toContain('Retry only after an update or network change')
    expect(result).toContain('Herdr cannot repair')
    expect(result.length).toBeLessThan(256)
    for (const secret of ['SERVICE_ERROR', 'private.example', 'token', 'auth=', 'p256dh=', 'Android 16']) {
      expect(result).not.toContain(secret)
    }
  })

  test.each([
    '',
    'Mozilla/5.0 (Macintosh) Chrome/140.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone) Version/18.0 Mobile Safari/604.1',
    'Mozilla/5.0 (Android 16) Firefox/140.0',
    'Mozilla/5.0 (Android 16) Chrome/140.0.0.0 EdgA/140.0',
    'Mozilla/5.0 (Android 16) Chrome/140.0.0.0 SamsungBrowser/28.0',
    'Mozilla/5.0 (Android 16) Chrome/140.0.0.0 OPR/80.0',
    'Mozilla/5.0 (Linux; Android 16; wv) Chrome/140.0.0.0'
  ])('keeps other or unknown platforms generic: %s', (ua) => {
    expect(isAndroidChrome(ua)).toBe(false)
    expect(describePushSubscribeError('Push failed', new DOMException('secret', 'AbortError'), ua))
      .toBe('Push failed (AbortError)')
  })

  test('Android permission errors and inspection aborts are not diagnosed as provider registration', () => {
    expect(describePushSubscribeError('Push failed', new DOMException('secret', 'NotAllowedError'), 'Android Chrome/140'))
      .toBe('Push permission was not granted')
    expect(describePushBrowserError('Could not inspect push notification status', new DOMException('secret', 'AbortError')))
      .toBe('Could not inspect push notification status (AbortError)')
  })
})
