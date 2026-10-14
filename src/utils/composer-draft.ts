// Adapted from devswha/herdr-web-ui composerDraft.ts (MIT, copyright 2026 devswha).
// Draft-only memory/subscription ownership; no send leases, replay or prefix settlement.
export const MAX_DRAFT_BYTES = 4096 // Matches native input and held-text UTF-8 limits.
export const DRAFT_STORAGE_KEY = 'herdr_composer_drafts_v1'
const MAX_SCOPES = 100
const MAX_STORAGE_BYTES = 512 * 1024
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).length
export const composerDraftScope = (
  paneId?: string | null,
  terminalId?: string | null,
  sessionId?: string | null
) =>
  paneId && terminalId
    ? JSON.stringify([paneId, terminalId, sessionId ?? null])
    : null
interface IDraft {
  text: string
  revision: number
  memoryOnly: boolean
}
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const EMPTY: IDraft = { text: '', revision: 0, memoryOnly: false }
export class ComposerDraftStore {
  private drafts = new Map<string, IDraft>()
  private loaded = false
  private failed = false
  private listeners = new Set<() => void>()
  constructor(
    private storage: () => DraftStorage = () => window.localStorage
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private load() {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = this.storage().getItem(DRAFT_STORAGE_KEY)
      if (raw === null) return
      if (utf8Bytes(raw) > MAX_STORAGE_BYTES)
        throw new Error('Oversize storage')
      const value = JSON.parse(raw)
      if (
        value?.version !== 1 ||
        !Array.isArray(value.drafts) ||
        value.drafts.length > MAX_SCOPES ||
        Object.keys(value).length !== 2
      )
        throw new Error('Invalid storage')
      const next = new Map<string, IDraft>()
      for (const entry of value.drafts) {
        if (!Array.isArray(entry) || entry.length !== 2)
          throw new Error('Invalid entry')
        const [key, text] = entry
        const scope = JSON.parse(key)
        if (
          !Array.isArray(scope) ||
          scope.length !== 3 ||
          !scope[0] ||
          !scope[1] ||
          scope.some(
            (part: unknown, index: number) =>
              !(typeof part === 'string' && part.length <= 1024) &&
              !(index === 2 && part === null)
          ) ||
          typeof text !== 'string' ||
          utf8Bytes(text) > MAX_DRAFT_BYTES ||
          next.has(key)
        )
          throw new Error('Foreign or invalid draft')
        next.set(key, { text, revision: 0, memoryOnly: false })
      }
      this.drafts = next
    } catch {
      this.failed = true
    }
  }
  read = (key: string | null): IDraft => {
    this.load()
    if (!key) return EMPTY
    let draft = this.drafts.get(key)
    if (!draft) {
      draft = { ...EMPTY, memoryOnly: this.failed }
      if (this.drafts.size >= MAX_SCOPES)
        this.drafts.delete(this.drafts.keys().next().value!)
      this.drafts.set(key, draft)
    }
    return draft
  }
  set(key: string | null, text: string): boolean {
    if (!key || utf8Bytes(text) > MAX_DRAFT_BYTES) return false
    const previous = this.read(key)
    this.drafts.set(key, {
      text,
      revision: previous.revision + 1,
      memoryOnly: this.failed
    })
    try {
      const raw = JSON.stringify({
        version: 1,
        drafts: [...this.drafts]
          .filter(([, draft]) => draft.text)
          .map(([scope, draft]) => [scope, draft.text])
      })
      if (utf8Bytes(raw) > MAX_STORAGE_BYTES)
        throw new Error('Oversize storage')
      if ([...this.drafts.values()].some((draft) => draft.text))
        this.storage().setItem(DRAFT_STORAGE_KEY, raw)
      else this.storage().removeItem(DRAFT_STORAGE_KEY)
      this.failed = false
    } catch {
      this.failed = true
    }
    for (const [scope, draft] of this.drafts)
      this.drafts.set(scope, { ...draft, memoryOnly: this.failed })
    for (const listener of this.listeners) listener()
    return true
  }
}
export const composerDrafts = new ComposerDraftStore()
