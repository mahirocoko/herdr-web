import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createServer } from "../server/index.ts";
import {
  paneProcessInfo,
  paneRead,
  ping,
  sessionSnapshot,
  workspaceClose,
} from "../server/herdr/client.ts";
import {
  DISPOSABLE_CONFIG_FILE,
  disposableConfig,
} from "./disposable-config.ts";

const config = process.env["XDG_CONFIG_HOME"];
if (
  !config ||
  !existsSync(join(config, DISPOSABLE_CONFIG_FILE)) ||
  !process.env["HERDR_TEST_SESSION"]?.startsWith("check-") ||
  process.env["HERDR_TEST_LIVE"] === "1" ||
  resolve(config).startsWith(join(homedir(), ".config"))
)
  throw new Error(
    "Run through scripts/check.ts run; main/default native targets are forbidden",
  );
await import("./test-herdr.ts");
const socket = process.env["HERDR_SOCKET"]!;
if (!disposableConfig(process.env, socket))
  throw new Error("Native receipt does not bind the disposable config/socket");
const home = homedir();
if (process.env["HOME"] !== home)
  throw new Error("Authenticated HOME must remain unchanged");
const root = realpathSync(
  mkdtempSync(join(process.env["HERDR_WEB_STATE_DIR"]!, "t195-shell-")),
);
const git = (args: string[]) => {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error("Disposable fixture Git setup failed");
};
git(["init", "--initial-branch=main"]);
writeFileSync(join(root, "fixture.txt"), "T195 disposable shell fixture\n");
git(["add", "fixture.txt"]);
// Identity is per-command and only this disposable test repository receives a seed commit.
git([
  "-c",
  "user.name=T195 Fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "commit",
  "-m",
  "Seed disposable native fixture",
]);
const receipt: Record<string, unknown> = {
  mode: "owned-shell-native",
  socket,
  config,
  homeUnchanged: true,
  steps: [],
};
const steps = receipt.steps as string[];
const native = await ping(socket);
if (native.protocol !== 22 || !native.terminal_attach)
  throw new Error("Native protocol/attach preflight failed");
receipt.native = native;
const owned = new Set<string>();
let server: ReturnType<typeof createServer> | undefined;
const sockets = new Set<WebSocket>();
const policy = { port: 0 };
const record = () =>
  writeFileSync(
    join(process.env["HERDR_WEB_STATE_DIR"]!, "fork-native-receipt.json"),
    JSON.stringify(receipt, null, 2),
    { mode: 0o600 },
  );
const until = async (
  check: () => boolean | Promise<boolean>,
  label: string,
) => {
  const deadline = Date.now() + 15_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await Bun.sleep(40);
  }
};
try {
  server = createServer({
    port: 0,
    hostname: "127.0.0.1",
    stateDir: process.env["HERDR_WEB_STATE_DIR"],
    registerBridge: false,
    remoteOperations: false,
    token: "",
    tailscaleOwner: null,
    forkPolicy: policy,
  });
  policy.port = server.port;
  await server.statusReady;
  const origin = `http://127.0.0.1:${server.port}`;
  const api = async (
    path: string,
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) => {
    const response = await fetch(origin + path, {
      method,
      headers: { origin, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<any>;
  };
  const created = await api("/api/workspace/create", {
    cwd: root,
    label: "T195 owned native shell",
  });
  owned.add(created.workspace_id);
  const pane = created.pane_id as string;
  receipt.workspace = created.workspace_id;
  receipt.pane = pane;
  record();
  const processInfo = await paneProcessInfo(pane, socket);
  if (!processInfo?.shell_pid)
    throw new Error("Owned pane lacks shell process identity");
  steps.push(
    "source HTTP workspace create + exact native shell process identity",
  );
  process.env["HERDR_WEB_PASTE_DIR"] = join(root, "attachments");
  const imageData =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iGJ0AAAAASUVORK5CYII=";
  const image = await api("/api/pane/image", {
    pane_id: pane,
    content_type: "image/png",
    data_base64: imageData,
    name: "owned-native.png",
  });
  if (!image.path.startsWith(join(root, "attachments") + "/"))
    throw new Error("Image escaped its fixture-owned directory");
  const imageResponse = await fetch(
    origin + "/api/fs/file?path=" + encodeURIComponent(image.path),
  );
  if (
    !imageResponse.ok ||
    imageResponse.headers.get("content-type") !== "image/png" ||
    !Buffer.from(await imageResponse.arrayBuffer()).equals(
      Buffer.from(imageData, "base64"),
    )
  )
    throw new Error("Source image upload/readback changed bytes or MIME");
  const textResponse = await fetch(
    origin +
      "/api/fs/file?path=" +
      encodeURIComponent(join(root, "fixture.txt")),
  );
  if (
    !textResponse.ok ||
    !(await textResponse.text()).includes("T195 disposable shell fixture")
  )
    throw new Error("Source file reader did not return the owned fixture");
  writeFileSync(
    join(root, "fixture.txt"),
    "T195 disposable shell fixture changed\n",
  );
  const changes = await api(
    "/api/workspace/diff/files?directory=" + encodeURIComponent(root),
  );
  if (!JSON.stringify(changes).includes("fixture.txt"))
    throw new Error("Owned repository changes not listed");
  const diff = await api(
    "/api/workspace/diff/file?directory=" +
      encodeURIComponent(root) +
      "&path=fixture.txt",
  );
  if (
    diff.file?.path !== "fixture.txt" ||
    diff.unavailable !== null ||
    !diff.patch?.includes("-T195 disposable shell fixture\n") ||
    !diff.patch?.includes("+T195 disposable shell fixture changed\n")
  )
    throw new Error("Owned diff did not return the exact before/after content");
  steps.push(
    "source image upload + byte/MIME-exact readback, text file read, repository change listing and exact diff content round trip",
  );
  const tab = await api("/api/tab/create", {
    workspace_id: created.workspace_id,
    cwd: root,
    label: "T195 disposable tab",
  });
  const snapshot = await sessionSnapshot(socket);
  const tabId = snapshot.panes.find(
    (entry) => entry.pane_id === tab.pane_id,
  )?.tab_id;
  if (!tabId) throw new Error("Created tab identity absent");
  await api("/api/tab/rename", { tab_id: tabId, label: "T195 renamed" });
  if (
    !(await sessionSnapshot(socket)).tabs.some(
      (entry) => entry.tab_id === tabId && entry.label === "T195 renamed",
    )
  )
    throw new Error("Tab rename not observed");
  steps.push("source HTTP tab create/rename + native readback");
  const frames: any[] = [];
  const connect = async () => {
    // Bun's Node-side WebSocket extension accepts headers; the DOM overload does not declare it.
    const ws = new WebSocket(origin.replace("http", "ws") + "/ws", {
      headers: { origin },
    } as unknown as string[]);
    sockets.add(ws);
    ws.addEventListener("message", (event) => {
      frames.push(JSON.parse(String(event.data)));
    });
    await until(() => ws.readyState === WebSocket.OPEN, "source websocket");
    return ws;
  };
  let ws = await connect();
  ws.send(
    JSON.stringify({ type: "attach", pane_id: pane, cols: 80, rows: 24 }),
  );
  await until(
    () =>
      frames.some(
        (f) =>
          f.type === "input-ready" && f.pane_id === pane && f.ready !== false,
      ),
    "Node-sidecar attachment ready",
  );
  steps.push("source WS snapshot + real Node PTY attach/input-ready");
  ws.send(
    JSON.stringify({ type: "resize", pane_id: pane, cols: 73, rows: 19 }),
  );
  await until(
    () =>
      frames.some(
        (f) =>
          f.type === "pane-geometry" &&
          f.pane_id === pane &&
          f.cols === 73 &&
          f.rows === 19,
      ),
    "native resize geometry",
  );
  const marker = "T195_OWNED_NATIVE_INPUT_OK";
  ws.send(
    JSON.stringify({
      type: "input",
      pane_id: pane,
      text: `printf '${marker}\\n'\r`,
    }),
  );
  await until(
    async () =>
      (
        await paneRead({ paneId: pane, source: "visible", lines: 20 }, socket)
      ).text.includes(marker),
    "owned shell input readback",
  );
  steps.push("resize + input to receipt-owned shell only + native readback");
  ws.send(JSON.stringify({ type: "detach", pane_id: pane }));
  ws.close();
  sockets.delete(ws);
  frames.length = 0;
  ws = await connect();
  ws.send(
    JSON.stringify({ type: "attach", pane_id: pane, cols: 80, rows: 24 }),
  );
  await until(
    () =>
      frames.some(
        (f) =>
          f.type === "input-ready" && f.pane_id === pane && f.ready !== false,
      ),
    "replacement socket attachment",
  );
  ws.close();
  sockets.delete(ws);
  steps.push("detach/disconnect + replacement websocket attachment; no replay");
  const refused = await fetch(origin + "/api/pane/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pane_id: pane, text: "UNAUTHORIZED" }),
  });
  if (refused.status !== 403)
    throw new Error("Missing-Origin mutation was admitted");
  const legacy = await fetch(origin + "/api/action", {
    method: "POST",
    headers: { origin },
  });
  if (legacy.status !== 410) throw new Error("Legacy controller not retired");
  steps.push("real HTTP missing-Origin refusal + retired legacy action 410");
  await api("/api/tab/close", { tab_id: tabId });
  steps.push("owned tab close");
  const tree = await api("/api/worktree/create", {
    workspace_id: created.workspace_id,
    branch: "t195-owned-fixture",
    path: `${root}-tree`,
    agent: null,
  });
  owned.add(tree.workspace_id);
  record();
  const listing = await api(
    `/api/worktree/list?workspace_id=${encodeURIComponent(created.workspace_id)}`,
  );
  receipt.worktreeReadback = { created: tree, listing };
  if (
    !listing.worktrees.some(
      (entry: { path: string }) => entry.path === tree.path,
    )
  )
    throw new Error("Owned worktree not observed");
  const reopened = await api("/api/worktree/open", {
    workspace_id: created.workspace_id,
    path: tree.path,
  });
  if (reopened.workspace_id !== tree.workspace_id || !reopened.already_open)
    throw new Error("Worktree reopen identity changed");
  await api("/api/worktree/remove", {
    workspace_id: tree.workspace_id,
    force: false,
  });
  owned.delete(tree.workspace_id);
  steps.push(
    "source HTTP worktree create/list/open/reuse/remove on disposable Git fixture only",
  );
  receipt.worktree =
    "observed created/reused/removed; fixture-only seed commit, no product repository writes";
  receipt.ok = true;
} catch (error) {
  receipt.failure = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  for (const ws of sockets) ws.close();
  server?.stop();
  const cleaned: string[] = [];
  const cleanupErrors: string[] = [];
  for (const id of [...owned].reverse()) {
    try {
      await workspaceClose(id, socket);
      cleaned.push(id);
    } catch (error) {
      cleanupErrors.push(
        `${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  receipt.cleanedOwnedWorkspaces = cleaned;
  receipt.cleanupErrors = cleanupErrors;
  if (cleanupErrors.length) receipt.ok = false;
  record();
  console.log(JSON.stringify(receipt, null, 2));
  if (cleanupErrors.length && !receipt.failure)
    throw new Error("Owned native workspace cleanup failed; see the receipt");
}
