import type { IActionTargetIdentity } from '@/types/herdr.ts'
import type { IUploadedImage } from '@/types/image-upload.ts'
const headers = (target: IActionTargetIdentity) => ({
  'X-Herdr-Image-Target': JSON.stringify(target)
})
const checked = async (response: Response) => {
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(
      body?.error ??
        'Image request failed. Inspect the target and try again explicitly.'
    )
  }
  return response
}
export const decodeUploadImage = async (file: File) => {
  if (!file.size || file.size > 8 * 1024 * 1024)
    throw new Error('Choose one image, PDF or UTF-8 text file, up to 8 MiB.')
  const data = new Uint8Array(await file.arrayBuffer())
  const png =
    data.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => data[index] === value
    )
  const jpeg = data[0] === 255 && data[1] === 216
  // General files are never browser-rendered. Server remains the final byte/MIME authority.
  if (!png && !jpeg) {
    if (file.type === 'image/png' || file.type === 'image/jpeg')
      throw new Error('Image header is invalid.')
    if (new TextDecoder().decode(data.subarray(0, 5)) === '%PDF-') return
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    } catch {
      throw new Error('Choose PNG or JPEG, PDF or a valid UTF-8 text file.')
    }
    if (
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) ||
      /<\s*(?:!doctype\s+html|html|svg|script)\b/i.test(text)
    )
      throw new Error('Choose PNG or JPEG, PDF or a plain UTF-8 text file.')
    return
  }
  const view = new DataView(data.buffer)
  let width = 0,
    height = 0
  if (
    png &&
    data.length >= 33 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => data[index] === value
    )
  ) {
    width = view.getUint32(16)
    height = view.getUint32(20)
  } else if (jpeg) {
    let offset = 2
    while (offset + 4 <= data.length) {
      if (data[offset++] !== 255) break
      while (data[offset] === 255) offset++
      const marker = data[offset++]
      if (offset + 2 > data.length || marker === 218 || marker === 217) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > data.length) break
      if ([192, 194].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3)
        width = view.getUint16(offset + 5)
        break
      }
      offset += length
    }
  }
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 32 * 1024 * 1024
  )
    throw new Error(
      'Image header is invalid or exceeds 8192 pixels per side or 32 megapixels.'
    )
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth > 8192 ||
      image.naturalHeight > 8192 ||
      image.naturalWidth * image.naturalHeight > 32 * 1024 * 1024
    )
      throw new Error('Image exceeds 8192 pixels per side or 32 megapixels.')
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Image exceeds'))
      throw error
    throw new Error(
      'This image could not be decoded. Choose a valid PNG or JPEG.'
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}
export const uploadImage = async (
  file: File,
  target: IActionTargetIdentity,
  signal: AbortSignal
): Promise<IUploadedImage> => {
  const response = await checked(
    await fetch('/api/media/uploads', {
      method: 'POST',
      headers: {
        ...headers(target),
        'content-type': ['image/png', 'image/jpeg', 'application/pdf'].includes(
          file.type
        )
          ? file.type
          : 'application/octet-stream'
      },
      body: file,
      signal,
      cache: 'no-store'
    })
  )
  const value = await response.json()
  if (
    !value.ok ||
    !/^[a-f0-9]{64}$/.test(value.imageId) ||
    !['image/png', 'image/jpeg', 'application/pdf', 'text/plain'].includes(
      value.mime
    ) ||
    (value.fileKind !== undefined &&
      value.fileKind !==
        (value.mime.startsWith('image/')
          ? 'image'
          : value.mime === 'application/pdf'
            ? 'pdf'
            : 'text')) ||
    !Number.isSafeInteger(value.imageContextBytes) ||
    value.imageContextBytes < 0 ||
    value.imageContextBytes > 4096 ||
    !Number.isSafeInteger(value.expiresAt) ||
    !Number.isSafeInteger(value.size)
  )
    throw new Error(
      'Invalid image upload response; any unconfirmed file expires within 24 hours.'
    )
  return value
}
export const previewImage = async (
  id: string,
  target: IActionTargetIdentity,
  signal: AbortSignal
) => {
  const response = await checked(
    await fetch(`/api/media/uploads/${id}`, {
      headers: {
        ...headers(target),
        'X-Herdr-Image-Origin': window.location.origin
      },
      signal,
      cache: 'no-store'
    })
  )
  const blob = await response.blob()
  if (
    !['image/png', 'image/jpeg'].includes(blob.type) ||
    blob.size > 8 * 1024 * 1024
  )
    throw new Error('Invalid image preview')
  return URL.createObjectURL(blob)
}
export const removeUploadedImage = async (
  id: string,
  target: IActionTargetIdentity
) => {
  await checked(
    await fetch(`/api/media/uploads/${id}`, {
      method: 'DELETE',
      headers: headers(target),
      cache: 'no-store'
    })
  )
}
