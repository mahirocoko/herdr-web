// MIT License - Copyright (c) 2026 devswha
// Adapted from herdr-web-ui dc2f11d src/components/ChatFind.tsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import Button from './ui/button.tsx'
import Input from './ui/input.tsx'
import Checkbox from './ui/checkbox.tsx'
import {
  searchLoadedChatRows,
  type IChatSearchMatch,
  type IChatSearchRow
} from '@/utils/chat-search.ts'

interface IChatFindProps {
  rows: readonly IChatSearchRow[]
  older: boolean
  loading: boolean
  limited: boolean
  error: string | null
  onOlder: (signal?: AbortSignal) => Promise<boolean>
  onMatch: (match: IChatSearchMatch | null) => void
  onClose: () => void
}

export const ChatFind = ({
  rows,
  older,
  loading,
  limited,
  error,
  onOlder,
  onMatch,
  onClose
}: IChatFindProps) => {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [chosen, setChosen] = useState<IChatSearchMatch | null>(null)
  const [searching, setSearching] = useState(false)
  const [pending, setPending] = useState(false)
  const [hint, setHint] = useState('')
  const priorRows = useRef(new Set<string>())
  const pages = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const result = useMemo(
    () => searchLoadedChatRows(rows, query, matchCase),
    [rows, query, matchCase]
  )
  const chosenIndex = chosen
    ? result.matches.findIndex(
        (match) =>
          match.rowKey === chosen.rowKey && match.start === chosen.start
      )
    : -1
  const index = Math.max(0, chosenIndex)
  const match = result.matches[index] ?? null
  const report = useRef(onMatch)
  report.current = onMatch
  useLayoutEffect(() => {
    input.current?.focus()
  }, [])
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    report.current(match)
  }, [match?.rowKey, match?.start, match?.end, query])
  const cancel = () => {
    controller.current?.abort()
    controller.current = null
    setSearching(false)
    setPending(false)
  }
  useEffect(() => {
    if (!searching || pending) return
    const found = result.matches
      .filter((match) => !priorRows.current.has(match.rowKey))
      .at(-1)
    if (found) {
      setChosen(found)
      setSearching(false)
      return
    }
    if (!older || limited || pages.current >= 20) {
      setSearching(false)
      setHint(
        limited
          ? 'Loaded history limit reached; use Terminal for further history.'
          : older
            ? 'Stopped after 20 pages. Search earlier again to continue.'
            : 'Reached the start of available history.'
      )
      return
    }
    if (loading) return
    const ticket = new AbortController()
    controller.current = ticket
    pages.current++
    setPending(true)
    void onOlder(ticket.signal)
      .then((loaded) => {
        if (controller.current !== ticket || ticket.signal.aborted) return
        controller.current = null
        setPending(false)
        if (!loaded) {
          setSearching(false)
          setHint(
            'No earlier page loaded. Retry when the current read finishes.'
          )
        }
      })
      .catch(() => {
        if (controller.current !== ticket || ticket.signal.aborted) return
        controller.current = null
        setPending(false)
        setSearching(false)
        setHint('Could not load earlier messages. Try again.')
      })
  }, [searching, pending, result, older, loading, limited, onOlder])
  const next = (direction: -1 | 1) => {
    const nextMatch =
      result.matches[(index + direction + result.count) % result.count]
    if (nextMatch) setChosen(nextMatch)
  }
  return (
    <form
      className="chat-find"
      role="search"
      aria-label="Find in Chat"
      onSubmit={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)
          return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          cancel()
          onClose()
        }
        if (event.key === 'Enter' && event.target === input.current) {
          event.preventDefault()
          next(event.shiftKey ? -1 : 1)
        }
      }}
    >
      <div className="chat-find-controls">
        <Input
          ref={input}
          type="search"
          aria-label="Find in Chat"
          placeholder="Find in Chat"
          maxLength={1024}
          value={query}
          onChange={(event) => {
            cancel()
            setQuery(event.target.value)
            setChosen(null)
            setHint('')
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous match"
          disabled={!result.count}
          onClick={() => next(-1)}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next match"
          disabled={!result.count}
          onClick={() => next(1)}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close search"
          onClick={() => {
            cancel()
            onClose()
          }}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="chat-find-options">
        <label>
          <Checkbox
            aria-label="Match case"
            checked={matchCase}
            onCheckedChange={(value) => {
              cancel()
              setMatchCase(value)
              setChosen(null)
            }}
          />{' '}
          Match case
        </label>
        <span role="status">
          {query
            ? result.count
              ? `${index + 1} of ${result.count}${result.limited ? ' (first 10,000 matches)' : ''}`
              : 'No matches'
            : 'Enter a literal query'}
        </span>
        {searching ? (
          <Button variant="ghost" size="sm" onClick={cancel}>
            Cancel search
          </Button>
        ) : (
          older && (
            <Button
              variant="ghost"
              size="sm"
              disabled={!query || loading || pending || limited}
              onClick={() => {
                priorRows.current = new Set(rows.map((row) => row.key))
                pages.current = 0
                setHint('')
                setSearching(true)
              }}
            >
              Search earlier messages
            </Button>
          )
        )}
      </div>
      <p className="chat-find-hint">
        {searching
          ? 'Searching earlier messages… (up to 20 pages)'
          : hint ||
            'Loaded native source, including folded content. Tool-output previews only; omitted or truncated source is not searched.'}
      </p>
      {error && <p role="alert">Could not read conversation: {error}</p>}
    </form>
  )
}

/** Source offsets cannot be applied to rendered Markdown; reveal the actual native passage. */
export const ChatMatchSource = ({
  text,
  match
}: {
  text: string
  match: IChatSearchMatch
}) => (
  <pre
    className="chat-match-source"
    tabIndex={-1}
    aria-label="Matching native source"
  >
    {match.start > 80 ? '…' : ''}
    {text.slice(Math.max(0, match.start - 80), match.start)}
    <mark>{text.slice(match.start, match.end)}</mark>
    {text.slice(match.end, match.end + 120)}
    {text.length > match.end + 120 ? '…' : ''}
  </pre>
)
