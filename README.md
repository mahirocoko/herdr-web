# Herdr Web

Browser UI for your installed Herdr terminal manager: workspaces, Chat, terminals, files and diffs. Runs locally on loopback by default, with the source-native frontend/backend adopted from `devswha/herdr-web-ui`.

## Run

From an already configured checkout:

```sh
bun start
```

Open **http://127.0.0.1:8787**. The command builds the client, then starts the native server in the foreground. It rebuilds on every start, including after a pull; no separate build or test run is required to open the app. **Ctrl-C** stops this instance. Use a visible project terminal so its logs and process stay accessible.

If it is already running, use the existing URL instead of starting another instance. An occupied port is rejected **before rebuilding**; the launcher does not stop its owner. For another local port:

```sh
PORT=8788 bun start
```

This changes the local listener only; it does not reconfigure Tailscale Serve. `bun run server` and `bun run dev` are aliases of the same build-and-serve launcher, **not** Vite HMR or an update supervisor. Help: `bun start --help`.

## Windows status (T206, partial)

Package entrypoints use a shared Bun-native bootstrap, without Bash/WSL. A fork-owned native ACL helper candidate now validates private reads and prepares runtime state using built-in Windows PowerShell/.NET Framework. It refuses unsupported paths/filesystems, untrusted owners/ACLs, reparse points and unsafe ancestor replacement authority rather than using chmod or repairing existing ACLs. New NTFS directories receive private descriptors at creation; disposable inheritance/rename witnesses precede secret writes. This is a cooperative local boundary, not isolation from the same user, SYSTEM or administrators.

Native Windows CI exposed and confirmed DOS short-name normalization, then a TrustedInstaller-owned system volume root. The exact TrustedInstaller SID is recognized only on nonprivate local drive-root ancestors; private owners, private allow ACEs and newly created ACL grants still accept only the current user, SYSTEM and Administrators. No blanket service-owner trust or ACL repair is granted. This correction still requires a green native run; null-DACL, unsupported-ACE, unexpected-owner and inspection-failure fixture coverage remains incomplete. Windows startup, desktop, Letta's separate history reader and physical Push remain unverified. This is not a Windows-support release; do not bypass failures with chmod or WSL.

## First-time setup

Requirements:

- **Bun 1.4.2**: an existing project-local copy, or exactly 1.4.2 on PATH. The wrapper selects that runtime; it never downloads Bun or upgrades the global installation.
- **Real Node.js** on PATH. The native PTY sidecar must run in Node, not Bun impersonating Node.
- **Herdr installed and running**, with its CLI on PATH and the main socket at `~/.config/herdr/herdr.sock`. The launcher requires native protocol **22**; the verified host was Herdr **0.9.5**. It does not install or update Herdr.

```sh
git clone https://github.com/mahirocoko/herdr-web.git
cd herdr-web
bun scripts/bun-project.mjs install --frozen-lockfile
bun start
```

The dependency install applies the checked-in patches and provides the lock-pinned Node PTY package. A fresh clone does **not** include the ignored project-local Bun binary, so provide Bun 1.4.2 on PATH first. If the local binary exists but Bun is not on PATH, run `bash scripts/bun-project.sh run start` instead.

### Startup problems

| Message                              | What to do                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Bun version mismatch                 | Use the exact supported runtime, not a global upgrade made by this app.                                               |
| Port unavailable                     | Open the existing instance, stop that process yourself, or choose another `PORT`.                                     |
| Missing Herdr or native ping failure | Open Herdr and check that its CLI/main socket are available.                                                          |
| Native protocol differs              | Use a compatible host; no automatic update is attempted.                                                              |
| Node/PTY check fails                 | Check real Node on PATH and the frozen dependency installation.                                                       |
| Client build fails                   | Read the build error; first-time setup needs the frozen dependency install. No server is started with a failed build. |

## State and access

The server uses project-owned private state and the existing authenticated HOME. The previously configured private Tailscale Serve address remains owner-restricted; no new exposure/configuration is created. Legacy credentials, subscriptions, browser drafts and held evidence are preserved, not imported into source automatic queues. The same existing VAPID identity is copied privately so an already-permitted browser is not silently unsubscribed/rekeyed; subscription/policy stores are not bulk-translated and physical Push receipt is still unproven. Existing browser pages must reload after cutover; retired legacy action/controllers cannot write through the new API. Do not clear browser storage.

## Development checks

These are engineering checks, **not required before normal startup**:

```sh
bun run typecheck
bun run test
bun run source:verify
```

`bun run build` is available for a standalone build; do not overwrite a running instance's assets. `bun run test:native` is an intentional, disposable shell-only native fixture, not a general startup check. See the safety notes below before broader testing.

## Scope and evidence

The 22:53 Settings refinement hides Subscription usage (including old palette requests and page links) without removing its backend. About identifies this fork and its pinned upstream source, not upstream update/install controls. Agent integrations describes local private Letta Code history separately from unsupported native session hooks; it performs no installation. App-owned Install app controls are removed; the PWA manifest, service worker and normal browser installation remain intact. The provider mark is Letta's unmodified official organization image, locally vendored with provenance. Terminal Pause fit detaches the fitted view and preserves its drained last screen without stopping the process; Resume Live obtains a fresh screen under current source authority. Pane replacement resets pause; switching to Chat leaves this terminal-only pause. That UI checkpoint used the existing server without restarting its backend; the separately authorized October 20 Stop compatibility work subsequently reloaded the owned backend. Independent scoped desktop/mobile and actual Light/Dark checks passed, including populated-grid pause/detach/resume; human acceptance and global native lifecycle/feature coverage remain open. See the parity inventory for unexercised boundaries and intentional QA guard failures.

The adopted source retains its complete UI, local-PC management, Chat/native history, Node PTY terminal, composer, prompt, filesystem/diff and workspace/tab/worktree implementations. A source implementation or shell fixture does **not** prove every provider/device feature. Optional account/login, forced usage refresh, paid voice, account proxy, public exposure, remote-PC mutation, plugin execution and managed-update capabilities return explicit approval-required/unavailable status rather than changing global accounts or configuration. Valid read-only subscription usage is retained; no OAuth refresh is performed. Provider-specific live Chat/input and physical Push remain separately scoped proof. Upstream has no Letta Chat reader; this fork now adapts read-only Letta history into the existing source Chat path with explicit bounded indexing/paging. Synthetic checks do not establish live rendering or Letta Send/Stop safety.

The canonical coverage/status inventory and rollback references are in `docs/upstream-parity.md`. The reintegrated Letta reader has real read-only HTTP proof for newest/older pages, 304 and 409 without logging transcript bodies, plus independent live desktop/mobile rendering and visible older-history proof. Images remain unavailable-preview notices and full-output fetching is not implemented. An explicitly authorized fresh Letta conversation proved real Send/reply and Stop/interruption, but native lifecycle status remains `working` after interruption; the web queue must not invent idle.

The October 20 fork-owned, 30-second compatibility witness permits one NEW explicit manual Send only after this client's successful Stop, a fresh native Interrupted status above an empty composer, no native processing/interrupt affordance and live identity/attachment/secret/approval/children checks. The owned statusline's timed `✦ thinking` activity badge below the composer is not native processing or completion authority. Old queued rows are held, uncertain/in-flight writes are never retried and explicit Hold delivery stays held.

The October 20 12:15-authorized follow-up proved the corrected manual recovery path in a fresh conversation: exactly two submits and one Web Stop, both submits acknowledged, no pending rows or wrong-target frames, and the exact recovery reply verified in native TUI, assistant-role history and rendered Chat. Native status was still Working immediately before the new Send; the timed footer badge remained visible. This proves the one-shot, 30-second compatibility path, not a global native presence fix or automatic old-queue recovery.

The recovered history shows the first prompt twice. Native storage contains two distinct message/entry/OTID identities in one direct chain, with no authoritative replacement alias; Web submitted that prompt only once. The reader preserves the native records rather than deleting intentional repeats through a text-dedup heuristic. This native serialization/display limitation remains open. Physical-device/PWA receipt, other-provider coverage and Mahiro's product acceptance remain separate; the T194 checkpoint is not closed by this proof.

Never run bare `bun test` (the upstream test preload can start native sessions). `test` is unit-only and `test:native` uses a disposable shell-only fixture that refuses main/default targets. Broader source integration/browser/SSH/install scripts need their own explicit scope; do not run them as a generic smoke test.

## Source, history and licenses

`SOURCE_MANIFEST.json` records the pin, exclusions and explicit fork patches. `scripts/verify-upstream.ts` independently derives the pinned Git tree, checks source byte/mode ownership and rejects leftover legacy app owners; the manifest is not its own authority. Source UI/CSS conventions remain upstream-owned.

This fork retains its Apache-2.0 `LICENSE`; adopted source retains MIT copyright/permission in `UPSTREAM_LICENSE` and applicable `THIRD_PARTY_NOTICES.md` (including both dependency patches). Upstream readmes in `docs/upstream-reference/` and upstream installer/maintainer documents are reference material, not this fork's deployment instructions. Pre-cutover guides are explicitly historical under `docs/history/legacy/`; the old React Router application is no longer runnable in the canonical tree.
