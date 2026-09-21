import type { FC } from 'react'

export interface IThumbDeckProps {
  paneId: string | null
  isBusy: boolean
  onSendKeys: (keys: string[]) => void
  onSendPrompt?: (text: string) => void
}

const PRIMARY_KEYS: { label: string; key: string; ariaLabel: string }[] = [
  { label: 'ESC', key: 'esc', ariaLabel: 'Send key ESC' },
  { label: 'TAB', key: 'tab', ariaLabel: 'Send key TAB' },
  { label: 'CTRL+C', key: 'ctrl+c', ariaLabel: 'Send key CTRL+C' },
  { label: '↑', key: 'up', ariaLabel: 'Send key Arrow Up' },
  { label: '↓', key: 'down', ariaLabel: 'Send key Arrow Down' },
  { label: 'ENTER', key: 'enter', ariaLabel: 'Send terminal Enter key' }
]

const ThumbDeck: FC<IThumbDeckProps> = ({
  paneId,
  isBusy,
  onSendKeys
}) => {
  const disabled = !paneId || isBusy

  return (
    <div className="thumb-deck" role="toolbar" aria-label="Terminal quick keys">
      <div className="thumb-deck__keys-row">
        {PRIMARY_KEYS.map((k) => (
          <button
            key={k.key}
            type="button"
            className="thumb-key-btn"
            disabled={disabled}
            onClick={() => onSendKeys([k.key])}
            aria-label={k.ariaLabel}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default ThumbDeck
