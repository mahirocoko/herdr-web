// MIT License - Copyright (c) 2026 devswha
// Adapted from dc2f11de components/TurnChangedFiles.tsx; ChatFiles owns on-demand reads.
import { createContext, useContext } from 'react'
import type { ConversationPart } from '@/types/conversation.ts'
import { turnChangedFiles } from '@/utils/turn-changed-files.ts'
import Button from './ui/button.tsx'
export const ChatPatchContext = createContext<((path: string) => void) | null>(
  null
)
export const TurnChangedFiles = ({
  parts
}: {
  parts: readonly ConversationPart[]
}) => {
  const open = useContext(ChatPatchContext)
  const files = turnChangedFiles(parts)
  if (!files.length) return null
  return (
    <section
      className="turn-changed-files"
      aria-label="Files edited in this turn"
    >
      <p className="turn-changed-files-title">
        Files edited in this turn{' '}
        <span>· Current working tree, not historical</span>
      </p>
      <ul>
        {files.map((path) => (
          <li key={path}>
            {open ? (
              <Button
                variant="ghost"
                className="turn-changed-file-link"
                title={`Open current unstaged / untracked changes for ${path}, not the historical edit`}
                onClick={() => open(path)}
              >
                {path}
              </Button>
            ) : (
              path
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
