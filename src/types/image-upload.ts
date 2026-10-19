export const MAX_IMAGE_PROMPT_BYTES = 4096
export const imagePromptBytes = (text: string, imageContextBytes = 0) => {
  if (!Number.isSafeInteger(imageContextBytes) || imageContextBytes < 0)
    throw new Error('Invalid image context byte cost')
  return new TextEncoder().encode(text).length + imageContextBytes
}
// Legacy opaque imageId names supplied image/file context, not its media type.
export interface IUploadedImage {
  fileKind?: 'image' | 'pdf' | 'text'
  imageId: string
  mime: string
  size: number
  expiresAt: number
  imageContextBytes: number
}
