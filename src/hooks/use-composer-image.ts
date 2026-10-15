import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ComposerImageOwner } from '@/utils/composer-image.ts'
import {
  decodeUploadImage,
  uploadImage,
  previewImage,
  removeUploadedImage
} from '@/services/image-upload.ts'
import type { IActionTargetIdentity } from '@/types/herdr.ts'
export const useComposerImage = (
  scope: string | null,
  target?: IActionTargetIdentity | null
) => {
  const ownerRef = useRef<ComposerImageOwner | null>(null)
  if (!ownerRef.current)
    ownerRef.current = new ComposerImageOwner({
      decode: decodeUploadImage,
      upload: uploadImage,
      preview: previewImage,
      remove: removeUploadedImage,
      revoke: (url) => URL.revokeObjectURL(url)
    })
  const owner = ownerRef.current
  useSyncExternalStore(
    owner.subscribe,
    () => owner.read(scope),
    () => null
  )
  const [notice, setNotice] = useState<string | null>(null)
  useLayoutEffect(() => {
    owner.configure(scope)
    setNotice(null)
    return () => owner.configure(null)
  }, [owner, scope])
  return {
    image: owner.read(scope),
    notice,
    get: () => owner.read(scope),
    choose: (file: File) => {
      setNotice(null)
      if (scope && target) void owner.choose(file, target, scope)
    },
    discard: () => {
      owner.discard()
      setNotice(
        'Removed from this draft. Unconfirmed uploads may remain until their 24-hour expiry.'
      )
    },
    retry: () => {
      setNotice(null)
      void owner.retry()
    },
    beginSend: owner.beginSend,
    settle: owner.settle
  }
}
