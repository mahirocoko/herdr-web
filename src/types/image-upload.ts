export const MAX_IMAGE_PROMPT_BYTES = 4096
export const imagePromptBytes = (text: string, imageContextBytes = 0) => {
  if (!Number.isSafeInteger(imageContextBytes) || imageContextBytes < 0)
    throw new Error('Invalid image context byte cost')
  return new TextEncoder().encode(text).length + imageContextBytes
}
export interface IUploadedImage {
  imageId: string
  mime: string
  size: number
  expiresAt: number
  imageContextBytes: number
}
