import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HerdrPane, SessionSnapshot } from "../shared/protocol.ts";
import * as native from "./herdr/client.ts";
import {
  HistoryChanged,
  paneConversation,
  paneTranscript,
} from "./conversation.ts";
import {
  forgetLettaState,
  LETTA_SCAN_BYTES,
  LettaHistoryLimit,
  lettaConversationPage,
} from "./letta.ts";
import { isAuthenticated, unauthorizedJson } from "./auth.ts";
import { handlePaneRequest } from "./pane-routes.ts";
import { ConversationMonitor } from "./conversation-monitor.ts";

const roots: string[] = [];
const spies: { mockRestore(): void }[] = [];
afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
  forgetLettaState();
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true }));
});
const id = "private-fixture-conversation";
const scope = createHash("sha256").update(id).digest("hex").slice(0, 16);
const pane: HerdrPane = {
  pane_id: "fixture-pane",
  agent: "letta",
  agent_status: "idle",
  focused: false,
  revision: 1,
  tab_id: "fixture-tab",
  terminal_id: "fixture-terminal",
  workspace_id: "fixture-workspace",
  tokens: { letta_scope: scope },
};
const snapshot = {
  panes: [pane],
  workspaces: [],
  tabs: [],
} as unknown as SessionSnapshot;
const text = (value: string) => [{ type: "text", text: value }];
const message = (id: string, role: string, content: unknown, extra = {}) =>
  JSON.stringify({
    type: "message",
    message: { id, role, content, ...extra },
  }) + "\n";
function fixture(count = 40, padding = "") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "letta-history-unit-")));
  roots.push(root);
  const dir = join(
    root,
    Buffer.from(`conversation:${id}`).toString("base64url"),
  );
  mkdirSync(dir);
  writeFileSync(join(dir, "conversation.json"), JSON.stringify({ id }));
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      schema_version: 2,
      message_format: "pi-session-entry-jsonl",
      provider_stack: "pi-ai",
    }),
  );
  const header = JSON.stringify({ type: "session", version: 3, id }) + "\n";
  let body = header;
  for (let n = 0; n < count; n++)
    body +=
      message(`u${n}`, "user", text(`question ${n}`), { padding }) +
      message(`a${n}`, "assistant", text(`answer ${n}`), { padding });
  const file = join(dir, "messages.jsonl");
  writeFileSync(file, body);
  return { root, file, body, header };
}
function stubSnapshot(value = snapshot) {
  const spy = spyOn(native, "sessionSnapshot").mockResolvedValue(value);
  spies.push(spy);
  return spy;
}

test("streams a >8MiB store, pages all turns without omission, keeps append identity", () => {
  const { root, file, body } = fixture(200, "x".repeat(32768));
  expect(Buffer.byteLength(body)).toBeGreaterThan(8 * 1024 * 1024);
  const newest = lettaConversationPage(pane, root);
  expect(newest.turns).toHaveLength(50);
  let cursor = newest.cursor;
  let count = newest.turns.length;
  while (cursor) {
    const older = lettaConversationPage(pane, root, { before: cursor });
    count += older.turns.length;
    cursor = older.cursor;
  }
  expect(count).toBe(400);
  appendFileSync(file, message("u200", "user", text("new question")));
  const appended = lettaConversationPage(pane, root, { from: newest.cursor! });
  expect(appended.history_id).toBe(newest.history_id);
  expect(appended.version).not.toBe(newest.version);
  expect(appended.turns).toHaveLength(50);
});
test("later revision of old assistant stays before its tool result across pages", () => {
  const { root, file } = fixture(80);
  appendFileSync(
    file,
    message("result", "toolResult", text("exact old tool output"), {
      toolCallId: "old-call",
    }),
  );
  const newest = lettaConversationPage(pane, root);
  appendFileSync(
    file,
    message(
      "a0",
      "assistant",
      [
        {
          type: "toolCall",
          id: "old-call",
          name: "Bash",
          arguments: { command: "true" },
        },
        ...text("revised old answer"),
      ],
      { stopReason: "stop" },
    ),
  );
  let page = lettaConversationPage(pane, root);
  expect(page.history_id).not.toBe(newest.history_id);
  while (page.cursor)
    page = lettaConversationPage(pane, root, { before: page.cursor });
  expect(page.turns[0]?.parts[0]).toMatchObject({ text: "question 0" });
  expect(page.turns[1]?.parts).toMatchObject([
    { kind: "tool", output: "exact old tool output" },
    { kind: "text", text: "revised old answer" },
  ]);
});
for (const revision of ["assistant", "tool-result", "new-tool-result"] as const)
  test(`loaded older ${revision} revision makes the consumer resynchronize`, async () => {
    const { root, file } = fixture(80);
    if (revision !== "assistant") {
      appendFileSync(
        file,
        message("a40", "assistant", [
          {
            type: "toolCall",
            id: "loaded-old-call",
            name: "Bash",
            arguments: {},
          },
        ]),
      );
      if (revision === "tool-result")
        appendFileSync(
          file,
          message("loaded-result", "toolResult", text("old output"), {
            toolCallId: "loaded-old-call",
          }),
        );
    }
    stubSnapshot();
    const call = async (query = "", etag?: string) => {
      const request = new Request(
        `http://127.0.0.1/api/pane/conversation?pane_id=${pane.pane_id}${query}`,
        {
          headers: {
            authorization: "Bearer fixture-owner-token",
            ...(etag ? { "if-none-match": etag } : {}),
          },
        },
      );
      expect(isAuthenticated(request, "fixture-owner-token")).toBe(true);
      return (await handlePaneRequest(
        request,
        new URL(request.url),
        "/api/pane/conversation",
        { lettaRoot: root },
      ))!;
    };
    const initialResponse = await call();
    const initial = await initialResponse.json(); // logical turns 110..159
    const loaded = await (await call(`&before=${initial.cursor}`)).json(); // 60..109 retained by ChatView
    expect(loaded.turns[21].parts[0]).toMatchObject(
      revision === "assistant"
        ? { text: "answer 40" }
        : {
            kind: "tool",
            output: revision === "tool-result" ? "old output" : "",
          },
    );
    appendFileSync(
      file,
      revision === "assistant"
        ? message("a40", "assistant", text("revised loaded answer"))
        : message(
            "loaded-result",
            "toolResult",
            text("revised loaded output"),
            { toolCallId: "loaded-old-call" },
          ),
    );
    // Match the pinned ChatView's ACTUAL sequence: poll held newest, 409 drops
    // retained older pages, refetch unpaged newest, then reload the older page.
    const poll = await call(
      `&from=${initial.cursor}`,
      initialResponse.headers.get("etag")!,
    );
    expect(poll.status).toBe(409);
    expect(await poll.json()).toMatchObject({
      error: { code: "history_changed" },
    });
    expect((await call(`&before=${loaded.cursor}`)).status).toBe(409);
    const freshResponse = await call();
    const fresh = await freshResponse.json();
    expect(fresh.history_id).not.toBe(initial.history_id);
    const updated = await (await call(`&before=${fresh.cursor}`)).json();
    expect(updated.turns[21].parts[0]).toMatchObject(
      revision === "assistant"
        ? { text: "revised loaded answer" }
        : { kind: "tool", output: "revised loaded output" },
    );
    expect(
      (await call(`&from=${fresh.cursor}`, freshResponse.headers.get("etag")!))
        .status,
    ).toBe(304);
    expect((await call(`&from=${initial.cursor}`)).status).toBe(409);
  });
test("identical old snapshot repeats do not invalidate loaded history", () => {
  const { root, file } = fixture(80);
  const initial = lettaConversationPage(pane, root);
  const duplicate = JSON.parse(
    message("a40", "assistant", text("answer 40"), { padding: "" }),
  );
  duplicate.append_entry_timestamp = "different wrapper metadata";
  appendFileSync(file, JSON.stringify(duplicate) + "\n");
  const poll = lettaConversationPage(pane, root, { from: initial.cursor! });
  expect(poll.history_id).toBe(initial.history_id);
  expect(poll.cursor).toBe(initial.cursor);
});
test("recent streaming revisions and new message appends keep history identity", () => {
  const { root, file } = fixture(80);
  const initial = lettaConversationPage(pane, root);
  appendFileSync(
    file,
    message("a79", "assistant", text("streaming latest answer")),
  );
  const streaming = lettaConversationPage(pane, root, {
    from: initial.cursor!,
  });
  expect(streaming.history_id).toBe(initial.history_id);
  expect(streaming.turns.at(-1)?.parts[0]).toMatchObject({
    text: "streaming latest answer",
  });
  appendFileSync(file, message("u80", "user", text("brand new question")));
  const appended = lettaConversationPage(pane, root, { from: initial.cursor! });
  expect(appended.history_id).toBe(initial.history_id);
  expect(appended.turns.at(-1)?.parts[0]).toMatchObject({
    text: "brand new question",
  });
});
test("before/since floor and from follow source cursor semantics", () => {
  const { root } = fixture(80);
  const newest = lettaConversationPage(pane, root);
  const older = lettaConversationPage(pane, root, { before: newest.cursor! });
  expect(
    lettaConversationPage(pane, root, {
      before: newest.cursor!,
      since: older.cursor!,
    }).turns,
  ).toEqual(older.turns);
  expect(
    lettaConversationPage(pane, root, {
      before: older.cursor!,
      since: older.cursor!,
    }).turns,
  ).toEqual([]);
  expect(
    lettaConversationPage(pane, root, { from: newest.cursor! }).turns,
  ).toEqual(newest.turns);
  expect(() =>
    lettaConversationPage(pane, root, {
      before: older.cursor!,
      since: newest.cursor!,
    }),
  ).toThrow(HistoryChanged);
});
for (const kind of ["same-inode-rewrite", "truncation", "replacement"])
  test(`${kind} invalidates history and old cursors`, () => {
    const { root, file, body, header } = fixture();
    const first = lettaConversationPage(pane, root);
    if (kind === "same-inode-rewrite")
      writeFileSync(file, body.replace("answer 0", "ANSWER 0"));
    else if (kind === "truncation")
      writeFileSync(file, header + message("u-new", "user", text("new")));
    else {
      renameSync(file, file + ".old");
      writeFileSync(file, body);
    }
    expect(() =>
      lettaConversationPage(pane, root, { before: first.cursor! }),
    ).toThrow(HistoryChanged);
    expect(lettaConversationPage(pane, root).history_id).not.toBe(
      first.history_id,
    );
  });
test("partial append tail is ignored then incorporated only once completed", () => {
  const { root, file } = fixture(1);
  appendFileSync(
    file,
    '{"type":"message","message":{"id":"u-new","role":"user","content":"par',
  );
  const first = lettaConversationPage(pane, root);
  expect(first.turns).toHaveLength(2);
  appendFileSync(file, 'tial"}}\n');
  const next = lettaConversationPage(pane, root);
  expect(next.turns).toHaveLength(3);
  expect(next.history_id).toBe(first.history_id);
});
test("scan overflow is explicit, not a newest-window answer", () => {
  const { root, file } = fixture(1);
  truncateSync(file, LETTA_SCAN_BYTES + 1);
  expect(() => lettaConversationPage(pane, root)).toThrow(LettaHistoryLimit);
});
test("a giant exact record is explicitly unsupported", () => {
  const { root, file } = fixture(1);
  appendFileSync(
    file,
    message("giant", "assistant", text("x".repeat(8 * 1024 * 1024))),
  );
  expect(() => lettaConversationPage(pane, root)).toThrow(LettaHistoryLimit);
});
test("oversized selected work turns fail explicitly rather than dropping records", () => {
  const { root, file } = fixture(0);
  const content = text("x".repeat(900_000));
  for (let n = 0; n < 10; n++)
    appendFileSync(file, message(`work-${n}`, "assistant", content));
  expect(() => lettaConversationPage(pane, root)).toThrow(LettaHistoryLimit);
});
test("bounded cache eviction rejects stale cursors instead of rebinding them", () => {
  const first = fixture();
  const before = lettaConversationPage(pane, first.root).cursor!;
  for (let n = 0; n < 4; n++) lettaConversationPage(pane, fixture(1).root);
  expect(() => lettaConversationPage(pane, first.root, { before })).toThrow(
    HistoryChanged,
  );
});
test("source paneTranscript resolves validated internal watch path without cwd/session", async () => {
  const { root, file } = fixture(1);
  const resolved = await paneTranscript(
    pane.pane_id,
    undefined,
    snapshot,
    undefined,
    undefined,
    undefined,
    undefined,
    root,
  );
  expect(resolved).toMatchObject({ source: "letta-transcript", path: file });
});
test("generic authenticated route emits only public fields, ETag/304 and 409", async () => {
  const { root } = fixture();
  stubSnapshot();
  const call = async (query = "", authenticated = true, etag?: string) => {
    const request = new Request(
      `http://127.0.0.1/api/pane/conversation?pane_id=${pane.pane_id}${query}`,
      {
        headers: {
          ...(authenticated
            ? { authorization: "Bearer fixture-owner-token" }
            : {}),
          ...(etag ? { "if-none-match": etag } : {}),
        },
      },
    );
    if (!isAuthenticated(request, "fixture-owner-token"))
      return unauthorizedJson();
    return (await handlePaneRequest(
      request,
      new URL(request.url),
      "/api/pane/conversation",
      { lettaRoot: root },
    ))!;
  };
  expect((await call("", false)).status).toBe(401);
  const response = await call();
  expect(response.status).toBe(200);
  const body = await response.text();
  const value = JSON.parse(body);
  expect(Object.keys(value).sort()).toEqual([
    "cursor",
    "history_id",
    "metadata",
    "source",
    "turns",
  ]);
  expect(value.source).toBe("letta-transcript");
  for (const privateValue of [
    id,
    scope,
    root,
    "agent_session",
    "letta_scope",
    "state_labels",
    "binding",
    "offset",
  ])
    expect(body).not.toContain(privateValue);
  expect((await call("", true, response.headers.get("etag")!)).status).toBe(
    304,
  );
  expect((await call("&before=wrong:1")).status).toBe(409);
});
test("fresh native scope after reading must still match", async () => {
  const { root } = fixture(1);
  const spy = stubSnapshot();
  spy.mockResolvedValueOnce(snapshot).mockResolvedValueOnce({
    ...snapshot,
    panes: [{ ...pane, tokens: { letta_scope: "0".repeat(16) } }],
  });
  await expect(
    paneConversation(
      pane.pane_id,
      undefined,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      root,
    ),
  ).rejects.toThrow("transcript_missing");
});
test("route reports unsupported scan bounds explicitly", async () => {
  const { root, file } = fixture(1);
  truncateSync(file, LETTA_SCAN_BYTES + 1);
  stubSnapshot();
  const request = new Request(
    `http://127.0.0.1/api/pane/conversation?pane_id=${pane.pane_id}`,
  );
  const response = await handlePaneRequest(
    request,
    new URL(request.url),
    "/api/pane/conversation",
    { lettaRoot: root },
  );
  expect(response?.status).toBe(503);
  expect(await response?.json()).toMatchObject({
    error: { code: "letta_history_limit" },
  });
});
test("source monitor publishes only opaque signatures for validated Letta path changes", async () => {
  const { root, file } = fixture(1);
  stubSnapshot();
  const events: string[] = [];
  const monitor = new ConversationMonitor(
    (_pane, signature) => events.push(signature),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    root,
  );
  try {
    monitor.watch(pane.pane_id);
    // Resolve is asynchronous; no browser, server or native process is started.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const initial = events.length;
    appendFileSync(file, message("new", "user", text("new")));
    // Exercise the same synchronous stat tick invoked by its timer, without sleeps.
    (monitor as unknown as { poll(): void }).poll();
    expect(events.length).toBeGreaterThan(initial);
    expect(
      events.every((signature) => /^[A-Za-z0-9_-]{22}$/.test(signature)),
    ).toBe(true);
  } finally {
    monitor.stop();
  }
});
