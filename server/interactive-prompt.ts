import { createHash } from 'node:crypto'
import {
  executeKeys,
  executePromptTextOnly,
  getHerdrSnapshot,
  readPaneContent,
  readPromptAnsi
} from './herdr-adapter.ts'
import { isAgentPane, verifyTargetAgainstSnapshot } from './security.ts'
import type { IActionTargetIdentity, ISnapshotResult } from './types.ts'
import {
  readPaneConversation,
  type INativePromptEvidence
} from './conversation/conversation-reader.ts'
import { PromptOccurrences } from './prompt-occurrence.ts'
import {
  answerKeys,
  codexQuestionsCollapsed,
  codexQueuedPrompt,
  modelListWaits,
  omoAskFromCall,
  parseFallbackPrompt,
  parseClaudeSuggestion,
  parseInteractivePrompt,
  promptFromScreen,
  promptMetadata,
  samePromptText,
  type ParsedPrompt
} from './prompt-parser.ts'
import type { PromptAnswerIntent } from '../src/types/interactive-prompt.ts'

export interface IPromptDeps {
  fetchSnapshot?: (timeoutMs?: number) => Promise<ISnapshotResult>
  readScreen?: (paneId: string) => Promise<string>
  readAnsi?: (paneId: string) => Promise<string>
  nativeEvidence?: (paneId: string) => Promise<INativePromptEvidence>
  keys?: (paneId: string, keys: string[]) => Promise<any>
  text?: (paneId: string, text: string) => Promise<any>
}
class PromptChanged extends Error {}
const changed = () =>
  new PromptChanged(
    'The interactive prompt or target changed; inspect and re-read.'
  )
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
export class InteractivePromptService {
  private readonly occurrences = new PromptOccurrences()
  private readonly queueFronts = new Map<
    string,
    { binding: string; question: string; options: string[] }
  >()
  constructor(private readonly deps: IPromptDeps = {}) {}
  private async observe(paneId: string, expected?: IActionTargetIdentity) {
    const snapshot = await (this.deps.fetchSnapshot ?? getHerdrSnapshot)(3000)
    this.occurrences.retain(
      snapshot.panes.flatMap((candidate) => {
        if (!candidate.terminal_id || !isAgentPane(candidate, snapshot.agents))
          return []
        const owner = snapshot.agents?.find(
          (item: any) =>
            item.target === candidate.pane_id ||
            item.pane_id === candidate.pane_id
        )
        const session =
          candidate.agent_session?.value ??
          candidate.agent_session?.id ??
          owner?.agent_session?.value ??
          owner?.agent_session?.id
        return [
          {
            paneId: candidate.pane_id,
            terminalId: candidate.terminal_id,
            expectedMode:
              candidate.agent_status === 'blocked'
                ? ('blocked-agent' as const)
                : ('agent' as const),
            ...(session ? { agentSessionId: session } : {})
          }
        ]
      })
    )
    const pane = snapshot.panes.find((item) => item.pane_id === paneId)
    if (!pane || !pane.terminal_id || !isAgentPane(pane, snapshot.agents))
      throw changed()
    const owner = snapshot.agents?.find(
      (item: any) => item.target === paneId || item.pane_id === paneId
    )
    const session =
      pane.agent_session?.value ??
      pane.agent_session?.id ??
      owner?.agent_session?.value ??
      owner?.agent_session?.id
    const target: IActionTargetIdentity = {
      paneId,
      terminalId: pane.terminal_id,
      expectedMode: pane.agent_status === 'blocked' ? 'blocked-agent' : 'agent',
      ...(session ? { agentSessionId: session } : {})
    }
    if (
      expected &&
      !verifyTargetAgainstSnapshot(snapshot, expected, {
        actionType: 'prompt-answer'
      }).ok
    )
      throw changed()
    const ticket = this.occurrences.beginRead(target)
    const screen = await (
      this.deps.readScreen ??
      (async (id) =>
        (await readPaneContent(id, { source: 'detection' })).content)
    )(paneId)
    let agent = (pane.agent || pane.display_agent || '').toLowerCase()
    let evidence: INativePromptEvidence | undefined
    if (
      (agent === 'codex' && codexQuestionsCollapsed(screen)) ||
      /\b1-9 select\b|enter save and next|\btab next question\b|\bor just type your reply\b/.test(
        screen
      )
    ) {
      evidence = await (
        this.deps.nativeEvidence ??
        (async (id) => {
          let value: INativePromptEvidence | undefined
          await readPaneConversation(id, {
            promptEvidence: (record) => {
              value = record
            }
          })
          if (!value) throw changed()
          return value
        })
      )(paneId)
      if (evidence.source === 'omo-transcript') agent = 'omo'
    }
    const asks =
      evidence?.omo
        .flatMap(
          (call) =>
            omoAskFromCall({
              ...call,
              id: `${evidence!.binding}\0${call.id}`
            }) ?? []
        )
        .reverse() ?? []
    let prompt = parseInteractivePrompt(
      agent,
      screen,
      asks[0] ?? null,
      agent === 'omo' || agent === 'pi',
      asks
    )
    if (!prompt && agent === 'codex' && evidence)
      prompt = codexQueuedPrompt(
        screen,
        evidence.codex,
        this.queueFronts.get(paneId)?.binding === evidence.binding
          ? this.queueFronts.get(paneId)!
          : null
      )
    if (
      !prompt &&
      pane.agent_status === 'blocked' &&
      agent &&
      !modelListWaits(agent, screen) &&
      !(agent === 'codex' && codexQuestionsCollapsed(screen))
    )
      prompt = parseFallbackPrompt(agent, screen)
    const post = await (this.deps.fetchSnapshot ?? getHerdrSnapshot)(3000)
    if (
      !verifyTargetAgainstSnapshot(post, target, {
        actionType: 'prompt-answer'
      }).ok
    )
      throw changed()
    const content = prompt
      ? hash([promptMetadata(prompt)!.id, evidence?.binding ?? null])
      : null
    return {
      target,
      prompt,
      screen,
      agent,
      asks,
      ticket,
      content,
      status: pane.agent_status,
      evidenceBinding: evidence?.binding
    }
  }
  async read(paneId: string) {
    const read = await this.observe(paneId)
    const id = this.occurrences.publish(read.ticket, read.content)
    if (read.prompt && id) read.prompt.id = id
    const suggestion =
      !read.prompt &&
      read.agent === 'claude' &&
      ['idle', 'done'].includes(read.status)
        ? await (this.deps.readAnsi ?? readPromptAnsi)(paneId).then(
            parseClaudeSuggestion,
            () => null
          )
        : null
    return { prompt: id ? read.prompt : null, target: read.target, suggestion }
  }

  /** Called only inside the index action's one shared-topology/pane coordinator claim. */
  async answer(
    target: IActionTargetIdentity,
    promptId: string,
    answer: PromptAnswerIntent
  ) {
    let dispatched = false
    let ticket: ReturnType<PromptOccurrences['beginAnswer']> = null
    try {
      let initial = await this.observe(target.paneId, target)
      const currentId = this.occurrences.publish(
        initial.ticket,
        initial.content
      )
      if (!initial.prompt || currentId !== promptId) throw changed()
      let steps = answerKeys(initial.prompt, answer)
      ticket = this.occurrences.beginAnswer(target, promptId)
      if (!ticket) throw changed()
      const send = async (step: { keys?: string[]; text?: string }) => {
        const snapshot = await (this.deps.fetchSnapshot ?? getHerdrSnapshot)(
          3000
        )
        if (
          !this.occurrences.stillCurrent(ticket!) ||
          !verifyTargetAgainstSnapshot(snapshot, target, {
            actionType: 'prompt-answer'
          }).ok
        )
          throw changed()
        dispatched = true // BEFORE awaiting native IO: lost acknowledgement must not replay.
        if (step.keys)
          await (this.deps.keys ?? executeKeys)(target.paneId, step.keys)
        else if (step.text !== undefined)
          await (this.deps.text ?? executePromptTextOnly)(
            target.paneId,
            step.text
          )
      }
      const original = promptMetadata(initial.prompt)!
      const queue = original.responder === 'codex-queued-question'
      const pending = original.responder === 'omo-pending'
      if (queue || pending) {
        // Revalidate the still-collapsed occurrence immediately before our opening key.
        const before = await this.observe(target.paneId, target)
        if (before.content !== initial.content) throw changed()
        await send({ keys: ['alt+up'] })
        let opened:
          Awaited<ReturnType<InteractivePromptService['observe']>> | undefined
        for (let attempt = 0; attempt < 20; attempt++) {
          await Bun.sleep(50)
          const next = await this.observe(target.paneId, target)
          const parsed = next.prompt && promptMetadata(next.prompt)
          if (
            parsed?.responder ===
            (queue ? 'codex-async-question' : 'omo-question')
          ) {
            opened = next
            break
          }
        }
        const shown = opened?.prompt && promptMetadata(opened.prompt)
        const matches =
          shown &&
          (queue
            ? samePromptText(shown.question, original.question) &&
              shown.options.length === original.options.length &&
              shown.options.every((option, index) =>
                samePromptText(option.label, original.options[index]!.label)
              )
            : shown.question === original.question &&
              JSON.stringify(shown.options) ===
                JSON.stringify(original.options) &&
              shown.omoQuestion?.call === original.omoQuestion?.call &&
              shown.omoQuestion?.index === original.omoQuestion?.index)
        if (!opened || !matches) {
          // Only close a queue whose opening acknowledged and whose actual open question we saw.
          // No cleanup at all follows uncertain IO (send throws straight to unknown).
          if (queue && opened && shown?.responder === 'codex-async-question') {
            if (initial.evidenceBinding) {
              this.queueFronts.set(target.paneId, {
                binding: initial.evidenceBinding,
                question: shown.question,
                options: shown.options.map((option) => option.label)
              })
              if (this.queueFronts.size > 64)
                this.queueFronts.delete(this.queueFronts.keys().next().value!)
            }
            const recheck = await this.observe(target.paneId, target)
            if (
              recheck.prompt &&
              promptMetadata(recheck.prompt)?.id === shown.id
            )
              await send({ keys: ['alt+down'] })
          }
          throw changed()
        }
        initial = opened
        steps = answerKeys(opened.prompt!, answer)
      }
      let expected = promptMetadata(initial.prompt!)!
      let typed = false
      let typing = false
      for (let index = 0; index < steps.length; index++) {
        const step = steps[index]!
        let read:
          Awaited<ReturnType<InteractivePromptService['observe']>> | undefined
        let shown: ParsedPrompt | undefined
        for (let attempt = 0; attempt < 30; attempt++) {
          read = await this.observe(target.paneId, target)
          const raw =
            promptFromScreen(
              read.agent,
              read.screen,
              read.asks[0] ?? null,
              read.agent === 'omo' || read.agent === 'pi',
              read.asks
            ) ??
            (initial.prompt?.fallback
              ? parseFallbackPrompt(read.agent, read.screen)
              : null)
          shown = raw ? promptMetadata(raw) : undefined
          const structural =
            shown &&
            shown.responder === expected.responder &&
            shown.question === expected.question &&
            shown.fullBodyHash === expected.fullBodyHash &&
            JSON.stringify(shown.options) ===
              JSON.stringify(expected.options) &&
            JSON.stringify(shown.omoQuestion) ===
              JSON.stringify(expected.omoQuestion)
          const same =
            shown &&
            (shown.id === expected.id ||
              ((typing || typed || expected.multi_select) && structural)) &&
            shown.selectedIndex === expected.selectedIndex &&
            JSON.stringify(shown.checkedOptionIndices) ===
              JSON.stringify(expected.checkedOptionIndices)
          const model =
            shown &&
            ['pi-model', 'claude-model', 'codex-model'].includes(
              expected.responder
            ) &&
            shown.responder === expected.responder &&
            shown.question === expected.question &&
            shown.menuLabels[shown.selectedIndex] ===
              expected.menuLabels[expected.selectedIndex]
          const formTyping =
            typing &&
            shown?.responder === 'omo-typing' &&
            shown.omoQuestion?.call === expected.omoQuestion?.call &&
            shown.omoQuestion?.index === expected.omoQuestion?.index
          if (same || model || formTyping) break
          shown = undefined
          await Bun.sleep(50)
        }
        if (!read || !shown) throw changed()
        const actual = step.pick ? shown.rowKey : step
        if (!actual) throw changed()
        await send(actual)
        // The final commit ends this answer. Never interpret/answer a following question.
        if (index === steps.length - 1) break
        if (actual.text !== undefined) {
          typed = true
          continue
        }
        const keys = actual.keys ?? []
        for (const key of keys) {
          if (key === 'up')
            expected = {
              ...expected,
              selectedIndex: Math.max(0, expected.selectedIndex - 1)
            }
          else if (key === 'down')
            expected = {
              ...expected,
              selectedIndex: expected.selectedIndex + 1
            }
          else if (key === 'backspace' && expected.responder === 'omo-question')
            expected = { ...expected, checkedOptionIndices: [] }
          else if (
            key === 'space' ||
            (key === 'enter' &&
              expected.multi_select &&
              ['claude-question', 'omo-question'].includes(expected.responder))
          ) {
            const checks = new Set(expected.checkedOptionIndices)
            if (checks.has(expected.selectedIndex))
              checks.delete(expected.selectedIndex)
            else checks.add(expected.selectedIndex)
            expected = {
              ...expected,
              checkedOptionIndices: [...checks].sort((a, b) => a - b)
            }
          } else if (
            key === 'enter' &&
            answer.custom_text !== undefined &&
            !typed
          )
            typing = true
          // Non-question form phases are verified by the same source parser on the next read.
        }
      }
      this.queueFronts.delete(target.paneId)
      if (
        queue ||
        promptMetadata(initial.prompt!)?.responder === 'codex-async-question'
      ) {
        for (let attempt = 0; attempt < 10; attempt++) {
          await Bun.sleep(100)
          const read = await this.observe(target.paneId, target)
          const parsed = read.prompt && promptMetadata(read.prompt)
          if (
            parsed?.responder === 'codex-async-question' &&
            (parsed.id !== promptMetadata(initial.prompt!)!.id || attempt >= 6)
          ) {
            await send({ keys: ['alt+down'] })
            break
          }
          if (!parsed || codexQuestionsCollapsed(read.screen)) break
        }
      }
      return { ok: true, outcome: 'acknowledged' as const, status: 200 }
    } catch (error) {
      return {
        ok: false,
        outcome: dispatched ? ('unknown' as const) : ('rejected' as const),
        status: dispatched ? 502 : error instanceof PromptChanged ? 409 : 400,
        error:
          error instanceof PromptChanged
            ? error.message
            : dispatched
              ? 'Interactive answer outcome unknown; inspect the terminal before submitting again.'
              : 'The answer or native prompt evidence could not be verified.'
      }
    } finally {
      if (ticket) this.occurrences.endAnswer(ticket)
    }
  }
}
