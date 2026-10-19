import { describe, expect, test } from 'bun:test'
import {
  ComposerImageOwner,
  canSendComposerImage,
  type IImageDeps
} from '../composer-image.ts'
const target = {
  paneId: 'ws:p1',
  terminalId: 'terminal',
  expectedMode: 'agent' as const
}
const file = () => new File(['png'], 'phone.png', { type: 'image/png' })
const uploaded = (id: string) => ({
  imageId: id.repeat(64),
  mime: 'image/png',
  size: 3,
  expiresAt: Date.now() + 86400000,
  imageContextBytes: 200
})
const fixture = (overrides: Partial<IImageDeps> = {}) => {
  const removed: string[] = [],
    revoked: string[] = []
  let counter = 0
  const deps: IImageDeps = {
    decode: async () => {},
    upload: async () => uploaded(String(++counter)),
    preview: async (id) => `blob:${id}`,
    remove: async (id, original) => {
      expect(original).toEqual(target)
      removed.push(id)
    },
    revoke: (url) => {
      revoked.push(url)
    },
    ...overrides
  }
  const owner = new ComposerImageOwner(deps)
  owner.configure('A:0')
  return { owner, removed, revoked }
}
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { resolve, promise }
}

describe('memory-only image intent owner', () => {
  test('general file is ready without Blob preview; Thai byte boundary and old ACK remain fenced', async () => {
    const f = fixture({
      upload: async () => ({
        ...uploaded('a'),
        mime: 'text/plain',
        fileKind: 'text'
      }),
      preview: async () => {
        throw new Error('General files must never be previewed')
      }
    })
    await f.owner.choose(new File(['ข้อมูล'], 'บันทึก.txt'), target, 'A:0')
    const selected = f.owner.read('A:0')!
    expect(selected.phase).toBe('ready')
    expect(selected.preview).toBeUndefined()
    expect(canSendComposerImage(selected, 'ก'.repeat(1298) + 'xx')).toBe(true)
    expect(canSendComposerImage(selected, 'ก'.repeat(1299))).toBe(false)
    const ticket = f.owner.beginSend(selected)
    await f.owner.choose(new File(['new'], 'new.txt'), target, 'A:0')
    const newer = f.owner.read('A:0')
    f.owner.settle(ticket, true)
    expect(f.owner.read('A:0')).toBe(newer)
  })
  test('late upload after A-B-A cannot attach and deletes eventual captured upload', async () => {
    const upload = deferred<ReturnType<typeof uploaded>>()
    const f = fixture({ upload: async () => upload.promise })
    const pending = f.owner.choose(file(), target, 'A:0')
    await Promise.resolve()
    f.owner.configure('B:1')
    f.owner.configure('A:2')
    upload.resolve(uploaded('a'))
    await pending
    expect(f.owner.read('A:2')).toBeNull()
    expect(f.removed).toEqual(['a'.repeat(64)])
  })
  test('cancel after server save but during preview cleans owned file and revokes eventual Blob', async () => {
    const preview = deferred<string>()
    const f = fixture({ preview: async () => preview.promise })
    const pending = f.owner.choose(file(), target, 'A:0')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    f.owner.discard()
    preview.resolve('blob:late')
    await pending
    expect(f.owner.read('A:0')).toBeNull()
    expect(f.removed).toContain('1'.repeat(64))
    expect(f.revoked).toContain('blob:late')
  })
  test('older image ACK preserves newer attachment; protected context is never deleted as unsent', async () => {
    const f = fixture()
    await f.owner.choose(file(), target, 'A:0')
    const ticket = f.owner.beginSend(f.owner.read('A:0')!)
    await f.owner.choose(file(), target, 'A:0')
    const newer = f.owner.read('A:0')
    f.owner.settle(ticket, true)
    expect(f.owner.read('A:0')).toBe(newer)
    expect(f.removed).not.toContain('1'.repeat(64))
    f.owner.discard()
    expect(f.removed).toContain('2'.repeat(64))
  })
  test('unknown protects bytes and blocks reuse; explicit new upload is independent', async () => {
    const f = fixture()
    await f.owner.choose(file(), target, 'A:0')
    const ticket = f.owner.beginSend(f.owner.read('A:0')!)
    f.owner.settle(ticket, false)
    expect(f.owner.read('A:0')?.phase).toBe('handled')
    expect(canSendComposerImage(f.owner.read('A:0'), 'text')).toBe(false)
    expect(() => f.owner.beginSend(f.owner.read('A:0')!)).toThrow()
    f.owner.discard()
    expect(f.removed).toHaveLength(0)
  })
  test('full UTF-8 projection supports image alone and refuses expiry/over-budget', async () => {
    const f = fixture()
    await f.owner.choose(file(), target, 'A:0')
    const image = f.owner.read('A:0')!
    expect(canSendComposerImage(image, '')).toBe(true)
    expect(canSendComposerImage(image, 'é'.repeat(1948))).toBe(true)
    expect(canSendComposerImage(image, 'é'.repeat(1949))).toBe(false)
    expect(
      canSendComposerImage(
        { ...image, uploaded: { ...image.uploaded!, expiresAt: 1 } },
        ''
      )
    ).toBe(false)
  })
  test('decode errors never upload and can be retried only explicitly', async () => {
    let uploads = 0
    const f = fixture({
      decode: async () => {
        throw new Error('Invalid PNG')
      },
      upload: async () => {
        uploads++
        return uploaded('a')
      }
    })
    await f.owner.choose(file(), target, 'A:0')
    expect(f.owner.read('A:0')?.phase).toBe('error')
    expect(uploads).toBe(0)
    expect(canSendComposerImage(f.owner.read('A:0'), 'text')).toBe(false)
    await f.owner.retry()
    expect(uploads).toBe(0)
  })
})
