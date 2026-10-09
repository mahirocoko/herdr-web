import { useEffect, useRef, useState } from 'react'
import Button from '@/components/ui/button.tsx'
import type { ActionResultStatus } from '@/utils/action-orchestrator.ts'

interface IChatControlsProps {
  working: boolean
  nativeStatus?: string
  observation: unknown
  disabled: boolean
  requestStop: () => Promise<ActionResultStatus | void>
  onMore: () => void
}

const ChatControls = ({
  working,
  nativeStatus,
  observation,
  disabled,
  requestStop,
  onMore
}: IChatControlsProps) => {
  const [request, setRequest] = useState<{
    phase: 'sending' | 'waiting' | 'unknown'
    observation: unknown
  } | null>(null)
  const [notice, setNotice] = useState('')
  const locked = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!request) return
    if (
      observation !== request.observation &&
      ['idle', 'done', 'blocked'].includes(nativeStatus ?? '')
    ) {
      locked.current = false
      setRequest(null)
      setNotice(
        nativeStatus === 'blocked'
          ? 'Agent is waiting for input.'
          : 'Agent is no longer working.'
      )
      return
    }
  }, [request, observation, nativeStatus])
  useEffect(() => {
    if (!request || request.phase === 'unknown') return
    const timer = setTimeout(() => {
      locked.current = false
      setRequest((previous) =>
        previous ? { ...previous, phase: 'unknown' } : null
      )
      setNotice('Stop not confirmed. Inspect Terminal before requesting again.')
    }, 15000)
    return () => clearTimeout(timer)
  }, [request?.phase])
  const stop = async () => {
    if (locked.current || disabled || !working) return
    locked.current = true
    setRequest({ phase: 'sending', observation })
    setNotice('Requesting stop…')
    try {
      const result = await requestStop()
      if (!mounted.current || !locked.current) return
      if (result === 'acknowledged') {
        setRequest((previous) =>
          previous ? { ...previous, phase: 'waiting' } : null
        )
        setNotice('Stop requested — waiting for agent status…')
      } else {
        locked.current = false
        setRequest(null)
        setNotice(
          'Stop was not sent. Try again when the current action finishes.'
        )
      }
    } catch {
      if (!mounted.current || !locked.current) return
      locked.current = false
      setRequest({ phase: 'unknown', observation })
      setNotice('Stop not confirmed. Inspect Terminal before requesting again.')
    }
  }
  return (
    <div className="chat-controls">
      {working && (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || Boolean(request && request.phase !== 'unknown')}
          onClick={() => {
            void stop()
          }}
          aria-label="Request agent stop using Ctrl+C"
        >
          ■{' '}
          {request?.phase === 'sending' || request?.phase === 'waiting'
            ? 'Requesting stop…'
            : 'Stop'}
        </Button>
      )}
      <span role="status" aria-live="polite">
        {notice}
      </span>
      <Button variant="ghost" size="sm" onClick={onMore}>
        More controls
      </Button>
    </div>
  )
}
export default ChatControls
