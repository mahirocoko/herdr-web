import type { IActionTargetIdentity } from '@/types/herdr.ts'
import type { IUploadedImage } from '@/types/image-upload.ts'
import { imagePromptBytes } from '@/types/image-upload.ts'
export interface IComposerImage {
  file: File
  target: IActionTargetIdentity
  scope: string
  phase: 'decoding' | 'uploading' | 'ready' | 'error' | 'sending' | 'handled'
  uploaded?: IUploadedImage
  preview?: string
  error?: string
  protected: boolean
  abort: AbortController
}
export interface IImageDeps {
  decode: (file: File) => Promise<void>
  upload: (
    file: File,
    target: IActionTargetIdentity,
    signal: AbortSignal
  ) => Promise<IUploadedImage>
  preview: (
    id: string,
    target: IActionTargetIdentity,
    signal: AbortSignal
  ) => Promise<string>
  remove: (id: string, target: IActionTargetIdentity) => Promise<void>
  revoke: (url: string) => void
}
export const canSendComposerImage = (
  image: IComposerImage | null,
  text: string
) =>
  !image ||
  (image.phase === 'ready' &&
    !!image.uploaded &&
    image.uploaded.expiresAt > Date.now() &&
    imagePromptBytes(text, image.uploaded.imageContextBytes) <= 4096)
export class ComposerImageOwner {
  private image: IComposerImage | null = null
  private scope: string | null = null
  private listeners = new Set<() => void>()
  constructor(private deps: IImageDeps) {}
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  private emit() {
    for (const listener of this.listeners) listener()
  }
  read = (scope: string | null) => (this.scope === scope ? this.image : null)
  configure = (scope: string | null) => {
    if (this.scope === scope) return
    this.discard()
    this.scope = scope
  }
  private async cleanup(image: IComposerImage) {
    if (image.preview) this.deps.revoke(image.preview)
    if (image.uploaded && !image.protected) {
      try {
        await this.deps.remove(image.uploaded.imageId, image.target)
      } catch {
        /* Captured target may be stale; bounded server TTL remains. */
      }
    }
  }
  discard = () => {
    const previous = this.image
    this.image = null
    if (previous) {
      previous.abort.abort()
      void this.cleanup(previous)
    }
    this.emit()
  }
  choose = async (file: File, target: IActionTargetIdentity, scope: string) => {
    if (this.scope !== scope) return
    this.discard()
    let image: IComposerImage = {
      file,
      target: { ...target },
      scope,
      phase: 'decoding',
      protected: false,
      abort: new AbortController()
    }
    this.image = image
    this.emit()
    const current = () =>
      this.image?.abort === image.abort &&
      this.scope === scope &&
      !image.abort.signal.aborted
    const update = (patch: Partial<IComposerImage>) => {
      image = { ...image, ...patch }
      if (current()) {
        this.image = image
        this.emit()
      }
    }
    try {
      await this.deps.decode(file)
      if (!current()) return
      update({ phase: 'uploading' })
      const uploaded = await this.deps.upload(
        file,
        image.target,
        image.abort.signal
      )
      image = { ...image, uploaded }
      if (!current()) {
        await this.cleanup(image)
        return
      }
      update({ uploaded })
      const preview = await this.deps.preview(
        uploaded.imageId,
        image.target,
        image.abort.signal
      )
      if (!current()) {
        this.deps.revoke(preview)
        await this.cleanup(image)
        return
      }
      update({ phase: 'ready', preview })
    } catch (error) {
      if (!current()) return
      update({
        phase: 'error',
        error: error instanceof Error ? error.message : 'Image upload failed'
      })
    }
  }
  retry = () => {
    const image = this.image
    if (image && !image.protected)
      return this.choose(image.file, image.target, image.scope)
  }
  beginSend = (expected: IComposerImage) => {
    if (
      this.image !== expected ||
      expected.phase !== 'ready' ||
      !expected.uploaded ||
      expected.uploaded.expiresAt <= Date.now()
    )
      throw new Error(
        'Image changed, expired or is not ready. Upload it again.'
      )
    this.image = { ...expected, protected: true, phase: 'sending' }
    this.emit()
    return this.image
  }
  settle = (ticket: IComposerImage, acknowledged: boolean) => {
    if (this.image?.abort !== ticket.abort) return // Newer attachment is never cleared by an older ACK.
    if (acknowledged) {
      if (this.image.preview) this.deps.revoke(this.image.preview)
      this.image = null
    } else
      this.image = {
        ...this.image,
        phase: 'handled',
        error:
          'Send did not confirm image context. Inspect Terminal before uploading again; no automatic resend.'
      }
    this.emit()
  }
}
