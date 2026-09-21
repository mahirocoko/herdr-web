import { Buffer } from 'node:buffer'
import { createECDH, timingSafeEqual } from 'node:crypto'

const decodeBase64Url = (value: string, expectedBytes: number): Buffer | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const decoded = Buffer.from(value, 'base64url')
    return decoded.byteLength === expectedBytes ? decoded : null
  } catch {
    return null
  }
}

export const isBase64UrlBytes = (value: string, expectedBytes: number): boolean => {
  return decodeBase64Url(value, expectedBytes) !== null
}

export const isValidP256PublicKey = (value: string): boolean => {
  const publicKey = decodeBase64Url(value, 65)
  if (!publicKey || publicKey[0] !== 0x04) return false

  try {
    const probe = createECDH('prime256v1')
    probe.generateKeys()
    probe.computeSecret(publicKey)
    return true
  } catch {
    return false
  }
}

export const isValidVapidKeyPair = (publicValue: string, privateValue: string): boolean => {
  const publicKey = decodeBase64Url(publicValue, 65)
  const privateKey = decodeBase64Url(privateValue, 32)
  if (!publicKey || publicKey[0] !== 0x04 || !privateKey) return false

  try {
    const curve = createECDH('prime256v1')
    curve.setPrivateKey(privateKey)
    const derivedPublicKey = curve.getPublicKey()
    return (
      derivedPublicKey.byteLength === publicKey.byteLength &&
      timingSafeEqual(derivedPublicKey, publicKey)
    )
  } catch {
    return false
  }
}
