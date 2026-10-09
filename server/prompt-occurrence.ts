// Adapted from devswha/herdr-web-ui@5979118 server/prompt.ts asking/answerTurns.
// MIT License, Copyright (c) 2026 devswha.
import { createHash, randomBytes } from 'node:crypto'
import type { IActionTargetIdentity } from './types.ts'

interface IAsking {
  content: string | null
  generation: number
  turn: number
  answering: string | null
}
export interface IPromptReadTicket {
  readonly binding: string
  readonly turn: number
}
export interface IPromptAnswerTicket {
  readonly binding: string
  readonly token: string
  readonly generation: number
}

/** Includes native terminal and session identity, never CWD/newest-file guesses. */
export const promptTargetBinding = (target: IActionTargetIdentity): string =>
  JSON.stringify([
    target.paneId,
    target.terminalId,
    target.agentSessionId ?? null
  ])

/**
 * Process-local observed occurrence fence, NOT native CAS. An identical question answered
 * and repeated wholly between reads is indistinguishable on the installed native API.
 * Content IDs must hash full semantic content before any display clipping. Cursor/checks
 * and form input phase are execution state, not semantic occurrence identity.
 */
export class PromptOccurrences {
  private readonly run = randomBytes(16).toString('hex')
  private readonly askings = new Map<string, IAsking>()
  private generation = 0

  beginRead(target: IActionTargetIdentity): IPromptReadTicket {
    const binding = promptTargetBinding(target)
    let asking = this.askings.get(binding)
    if (!asking) {
      asking = {
        content: null,
        generation: ++this.generation,
        turn: 0,
        answering: null
      }
      this.askings.set(binding, asking)
    }
    return { binding, turn: asking.turn }
  }

  /** null also suppresses old/in-answer reads: they must never republish pre-answer state. */
  publish(ticket: IPromptReadTicket, content: string | null): string | null {
    const asking = this.askings.get(ticket.binding)
    if (!asking || asking.answering !== null || asking.turn !== ticket.turn)
      return null
    if (content === null) {
      asking.content = null
      return null
    }
    if (asking.content !== content) {
      asking.content = content
      asking.generation = ++this.generation
    }
    return this.id(ticket.binding, asking)
  }

  beginAnswer(
    target: IActionTargetIdentity,
    occurrenceId: string
  ): IPromptAnswerTicket | null {
    const binding = promptTargetBinding(target)
    const asking = this.askings.get(binding)
    if (
      !asking ||
      asking.content === null ||
      asking.answering !== null ||
      this.id(binding, asking) !== occurrenceId
    )
      return null
    const token = randomBytes(16).toString('hex')
    asking.answering = token
    asking.turn += 1
    return { binding, token, generation: asking.generation }
  }

  stillCurrent(ticket: IPromptAnswerTicket): boolean {
    const asking = this.askings.get(ticket.binding)
    return Boolean(
      asking &&
      asking.answering === ticket.token &&
      asking.generation === ticket.generation &&
      asking.content !== null
    )
  }

  /** Called after success OR possibly-applied IO. Unknown is not replayed automatically. */
  endAnswer(ticket: IPromptAnswerTicket): void {
    const asking = this.askings.get(ticket.binding)
    if (!asking || asking.answering !== ticket.token) return
    asking.content = null
    asking.answering = null
    asking.turn += 1
  }

  /** Authoritative replacement/work/no-prompt observation can retire an in-flight asking. */
  ended(target: IActionTargetIdentity): void {
    const asking = this.askings.get(promptTargetBinding(target))
    if (asking) {
      asking.content = null
      asking.turn += 1
    }
  }

  /** Reader lifecycle supplies current exact bindings; never evict a live asking for capacity. */
  retain(targets: readonly IActionTargetIdentity[]): void {
    const live = new Set(targets.map(promptTargetBinding))
    for (const binding of this.askings.keys()) {
      if (!live.has(binding)) this.askings.delete(binding)
    }
  }

  private id(binding: string, asking: IAsking): string {
    return createHash('sha256')
      .update(
        JSON.stringify([this.run, binding, asking.generation, asking.content])
      )
      .digest('hex')
  }
}
