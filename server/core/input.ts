/**
 * Each pane's input order: the one queue its input waits in, and when its attach pty was last
 * typed into, which input sent around the pty waits on.
 */
export function createInputLane({ TYPED_SETTLE_MS, KEY_SETTLE_MS }: { TYPED_SETTLE_MS: number; KEY_SETTLE_MS: number }) {
  /** each pane's input while a composer message is in flight, one step after another */
  const paneQueues = new Map<string, Promise<unknown>>();
  /** when each pane last got keystrokes through its attach pty */
  const lastTyped = new Map<string, number>();
  /** panes whose last pty keystroke ended in an ESC, which herdr holds ~150ms: a key waits TYPED_SETTLE_MS there */
  const typedEscape = new Set<string>();

  /**
   * Runs `task` after everything queued for the pane. While a composer message is in
   * flight, the pane's other input (keystrokes, keys, prompt answers) waits behind it:
   * a Stop tapped right after Send must not land between the text and its Enter.
   */
  function serialize<T>(paneId: string, task: () => T | Promise<T>): Promise<T> {
    const run = (paneQueues.get(paneId) ?? Promise.resolve()).catch(() => {}).then(task);
    paneQueues.set(paneId, run);
    run.catch(() => {}).finally(() => { if (paneQueues.get(paneId) === run) paneQueues.delete(paneId); });
    return run;
  }

  /**
   * Waits until input sent through herdr's RPC can no longer overtake the pane's last pty keystroke
   * still on its way through the sidecar and the attach: KEY_SETTLE_MS after it, or TYPED_SETTLE_MS
   * when it ended in an ESC herdr may still be holding.
   */
  async function settleAfterTyping(paneId: string): Promise<void> {
    const settle = typedEscape.has(paneId) ? TYPED_SETTLE_MS : KEY_SETTLE_MS;
    const typed = Date.now() - (lastTyped.get(paneId) ?? 0);
    // fixed wait: a pty keystroke on its way through the sidecar and the attach says nothing when it lands
    if (typed < settle) await Bun.sleep(settle - typed);
  }

  /**
   * The WebSocket input and keys handlers, still in server/index.ts, read `paneQueues` and write
   * `lastTyped` and `typedEscape` themselves until they move here.
   */
  return { serialize, settleAfterTyping, paneQueues: paneQueues as ReadonlyMap<string, Promise<unknown>>, lastTyped, typedEscape };
}
