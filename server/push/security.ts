import { type IValidationResult } from '../security.ts'
import { isBase64UrlBytes, isValidP256PublicKey } from './crypto.ts'
import type { IPushSubscription } from './types.ts'

export const validatePushSubscriptionPayload = (
  body: unknown
): IValidationResult<IPushSubscription> => {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' }
  }

  const raw = body as Record<string, unknown>
  if (typeof raw.endpoint !== 'string' || raw.endpoint.trim().length === 0) {
    return { valid: false, error: 'Missing or empty "endpoint"' }
  }

  const endpoint = raw.endpoint.trim()
  if (endpoint.length > 1024) {
    return { valid: false, error: 'Endpoint exceeds maximum allowed length of 1024 characters' }
  }

  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:') {
      return { valid: false, error: 'Push subscription endpoint must use HTTPS' }
    }
  } catch {
    return { valid: false, error: 'Invalid push subscription endpoint URL' }
  }

  if (!raw.keys || typeof raw.keys !== 'object') {
    return { valid: false, error: 'Missing or invalid "keys" object' }
  }

  const keys = raw.keys as Record<string, unknown>
  if (typeof keys.p256dh !== 'string' || keys.p256dh.trim().length === 0) {
    return { valid: false, error: 'Missing or empty "keys.p256dh"' }
  }
  if (typeof keys.auth !== 'string' || keys.auth.trim().length === 0) {
    return { valid: false, error: 'Missing or empty "keys.auth"' }
  }

  const p256dh = keys.p256dh.trim()
  const auth = keys.auth.trim()

  if (!isValidP256PublicKey(p256dh) || !isBase64UrlBytes(auth, 16)) {
    return { valid: false, error: 'Push subscription keys are invalid' }
  }

  let expirationTime: number | null | undefined = undefined
  if (raw.expirationTime !== undefined && raw.expirationTime !== null) {
    if (
      typeof raw.expirationTime !== 'number' ||
      !Number.isSafeInteger(raw.expirationTime) ||
      raw.expirationTime < 0
    ) {
      return { valid: false, error: 'Invalid "expirationTime": must be a non-negative safe integer or null' }
    }
    expirationTime = raw.expirationTime
  }

  return {
    valid: true,
    data: {
      endpoint,
      keys: {
        p256dh,
        auth
      },
      expirationTime
    }
  }
}

export const validatePushEndpointPayload = (
  body: unknown
): IValidationResult<{ endpoint: string }> => {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' }
  }

  const raw = body as Record<string, unknown>
  if (typeof raw.endpoint !== 'string' || raw.endpoint.trim().length === 0) {
    return { valid: false, error: 'Missing or empty "endpoint"' }
  }

  const endpoint = raw.endpoint.trim()
  if (endpoint.length > 1024) {
    return { valid: false, error: 'Endpoint exceeds maximum allowed length of 1024 characters' }
  }

  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:') {
      return { valid: false, error: 'Push subscription endpoint must use HTTPS' }
    }
  } catch {
    return { valid: false, error: 'Invalid push subscription endpoint URL' }
  }

  return {
    valid: true,
    data: { endpoint }
  }
}

import {
  isApprovedLoopback,
  validateOwnerAuth,
  type IOwnerAuthOptions,
  type IOwnerAuthResult
} from '../security.ts'

export { isApprovedLoopback }
export type IPushAuthOptions = IOwnerAuthOptions
export type IPushAuthResult = IOwnerAuthResult

export const validatePushAuth = (
  req: Request,
  hostHeader?: string | null,
  originHeader?: string | null,
  configuredOwnerLogin?: string,
  options: IPushAuthOptions = {}
): IPushAuthResult => {
  return validateOwnerAuth(req, hostHeader, originHeader, configuredOwnerLogin, options)
}
