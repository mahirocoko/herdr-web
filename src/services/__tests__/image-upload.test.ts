import { afterEach, expect, test } from 'bun:test'
import { decodeUploadImage } from '../image-upload.ts'
const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image')
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL
afterEach(() => {
  if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage)
  else Reflect.deleteProperty(globalThis, 'Image')
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
})
const png = () =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=',
    'base64'
  )
test('PDF and UTF-8 text never allocate image decoder or object URL', async () => {
  URL.createObjectURL = () => {
    throw new Error('General file preview forbidden')
  }
  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    value: class {
      constructor() {
        throw new Error('Image decoder forbidden')
      }
    }
  })
  await decodeUploadImage(
    new File(['ข้อมูล'], 'ข้อมูล.ts', { type: 'video/mp2t' })
  )
  await decodeUploadImage(
    new File(['%PDF-1.7\n%%EOF'], 'document.pdf', { type: 'application/pdf' })
  )
  await expect(
    decodeUploadImage(new File([new Uint8Array([0xc3, 0x28])], 'bad.txt'))
  ).rejects.toThrow('UTF-8')
  await expect(
    decodeUploadImage(new File(['a\0b'], 'bad.txt'))
  ).rejects.toThrow('UTF-8')
})
test('invalid types/magic/oversized dimensions reject before allocating browser decoder', async () => {
  let decoders = 0
  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    value: class {
      constructor() {
        decoders++
      }
    }
  })
  await expect(
    decodeUploadImage(
      new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' })
    )
  ).rejects.toThrow('PNG or JPEG')
  await expect(
    decodeUploadImage(new File(['<html/>'], 'bad.png', { type: 'image/png' }))
  ).rejects.toThrow('header')
  const huge = png()
  huge.writeUInt32BE(99999, 16)
  await expect(
    decodeUploadImage(new File([huge], 'huge.png', { type: 'image/png' }))
  ).rejects.toThrow('header')
  expect(decoders).toBe(0)
})
test('browser decode is awaited and every temporary object URL is revoked on success/failure', async () => {
  const revoked: string[] = []
  let reject = false,
    decodes = 0
  URL.createObjectURL = () => 'blob:decode'
  URL.revokeObjectURL = (url) => {
    revoked.push(url)
  }
  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    value: class {
      src = ''
      naturalWidth = 1
      naturalHeight = 1
      async decode() {
        decodes++
        if (reject) throw new Error('codec failed')
      }
    }
  })
  const file = new File([png()], 'phone.png', { type: 'image/png' })
  await decodeUploadImage(file)
  reject = true
  await expect(decodeUploadImage(file)).rejects.toThrow('could not be decoded')
  expect(decodes).toBe(2)
  expect(revoked).toEqual(['blob:decode', 'blob:decode'])
})
