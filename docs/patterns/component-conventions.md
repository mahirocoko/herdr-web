# Component Conventions

- Use arrow-function React components and export the public component at the bottom.
- Keep props in an explicit `I...Props` interface.
- Components own rendering and local interaction state; hooks own polling, reconnect, and external lifecycle work.
- Prefer semantic HTML and native buttons/forms before custom interaction shells.
- A visual primitive should be extracted only after repeated use or distinct ownership appears.

## Readiness presentation

Snapshot notices use existing `use-snapshot` status/error only: initial failure is
snapshot unavailability, not proof of daemon disconnection or incompatible schema.
`reconnecting` retains last-read selection and labels it potentially out of date;
only a successful current read can establish a missing Space. Refresh remains the
existing read operation, with no new subscription or automatic mutation retry.
Chat's existing binding-specific `ready`/`unknown` guards remain authoritative;
unread/unknown prompt notices offer explicit re-read and Terminal inspection without
conferring Send authority. Question remains read-only and retains text with failed-
refresh provenance. HTTP 403 action errors explain configured-owner authorization;
Push enrollment is separate, and neither snapshot success nor notification state
proves mutation permission. No browser schema/owner telemetry is inferred.
The action orchestrator formats structured errors before display flattening.
Rejected submission evidence stores only bounded HTTP status and the allowlisted
`invalid-origin` code, never raw server messages/results; old evidence without a
status does not imply 403, and unknown outcomes retain inspection priority.
Navigation Search returns focus through Base UI `finalFocus` to its real header
trigger. Settings Back transfers to the mounted Spaces trigger when visible, or
the visible header Search trigger on desktop, never to Composer.

## Composer draft contracts

Ordinary composer drafts are inert local browser storage, scoped by exact
pane/terminal/native-session identity. They are separate from held intents and
submission receipts: restoration never sends anything. The draft-only store
adapts upstream memory/subscription logic, not its send lease or prefix clearing.
At most 100 scopes are retained (oldest memory scope evicted), each at most 4096
UTF-8 bytes, with a 512 KiB serialized storage cap. Invalid or inaccessible
storage displays a memory-only notice; a successful edit can repair persistence.
Tabs do not synchronize live edits. ACK clears only unchanged text, revision,
identity and selection generation; unknown outcomes retain existing owners.
Terminal Quote appends a normalized fenced block into the selected agent draft,
switches Chat and focuses the composer, without input/control/send requests.
Native history line numbers are unavailable and are not fabricated. Published
workspace metadata is labeled Space checkout because it cannot prove a pane's
possibly different cwd ownership. Context is read-only and uses no Git polling.

Image context is separate memory-only draft intent: `use-composer-image` binds
`ComposerImageOwner` to exact draft scope plus App selection generation, never
localStorage or held authority. Only native-Letta Chat exposes the existing
composer's single PNG/JPEG chooser. Header bounds precede browser decode; an
owner-authenticated Blob preview is revoked on retirement. Status is checking or
uploading, not invented percentage progress. Remove/cancel targets only the
captured upload, including late successful completion; response loss or stale
target can leave a private file until its 24-hour expiry. Mutation admission
freezes image authority; old ACK preserves newer attachment and draft edits.
Possible-write unknown blocks reuse and offers Terminal inspection. Uploaded
files survive ACK/intent removal for asynchronous agent reads. Byte counter and
Send use visible text plus projected server-owned image-context bytes, including
image-only Send; Queue is explicitly unavailable with any image state. Image
Send does not use ordinary text-only transcript corroboration because the
private canonical instruction differs from visible text. Browser/native QA
and human acceptance remain separate gates.

## Review to draft

App's `appendReviewDraft` is the single quote insertion dispatch into the existing
composer store; Terminal Quote reuses it. Viewer callbacks freeze exact target
selection generation on opening, including Repository Changes' outer dialog.
A changed terminal/session or A → B → A selection rejects insertion. App reads the
latest stored draft at the explicit click, appends without overwrite, and rejects
the entire insertion above the shared 4096 UTF-8 byte limit.

File text preview's Add to draft captures only a selection wholly within its own
rendered text surface. Markdown is labeled a selected displayed excerpt, not raw
source or historical turn evidence. No selection adds path plus explicit current
disk preview-read scope. Patch review adds only path plus working-tree, staged,
or resolved commit-comparison scope: virtualized shadow-root excerpts are not
supported. Binary/image quoting and upload are not implemented. No Send, native
action, composer focus, view switch or reader unmount occurs. File dialog returns
to its connected owning trigger with preventScroll; nested Dialog ownership stays
with Base UI. Independent browser focus/scroll/mobile acceptance remains required.

## Turn edits and long user messages

Turn file links adapt upstream successful explicit edit/write tool metadata only.
Pending/failed/unknown-success calls and omitted/truncated arguments do not name
files. Narration and shell scripts (even quoted patches) are not edit evidence.
ChatFiles reuses its existing modal for RepoPatchViewer: one cancellable listing
per explicit click, no polling-row Git reads. Only that authorized listing supplies
repository root and repository_identity; rename targets follow its current paths.
Relative paths use the selected pane's current published cwd, not an invented
historical cwd. Outside/unresolvable paths and files absent from the bounded current
list show an honest unavailable message. Current unstaged/untracked patches are
never presented as the exact historical turn action; staged/committed files may
no longer be present. Existing file authorization remains separate and unchanged.

Long user messages fold only beyond 12 source-visible lines or 900 visible
characters (Markdown link labels count, not URLs), and only measured clipping
shows a disclosure. Full Markdown and Copy payload remain intact. Stable keyed
Turn identity retains disclosure through polling; session/pane remount resets it.
The full native source passage and selected occurrence stay outside the visual
cap in Find's single source preview, including Thai and hidden matches. Show less returns an above-viewport card
to view. No minimap or global shortcut installation: Find/source navigation and
Latest already own those reading needs; density/virtualization remain deferred
until measured cost. Existing appearance options retain semantics but now use
canonical Select/Input/Checkbox controls in the existing Settings route's Chat
section; no second font picker is installed. Root mounts the single preference
hook and shares its value/update/error through outlet context. Route navigation
never rereads storage or drops memory-only edits; Reset and document remount retain
the existing policy. Font Enter commit remains IME-protected.

## Chat reading contracts

`ChatFind` owns a literal query, match case and selected source occurrence for the
current conversation only. The loaded native turns are searched, including folded
work/tool/thinking source; images, synthetic retention notices and omitted text
are not searched. Tool output is the supplied preview, not an implicit whole-output
fetch. Find's source-owned preview slot reveals the real source passage with a
semantic `mark`, since source offsets cannot be applied to transformed Markdown.
The matched row retains its selected marker and scroll ownership, without a second
preview. Explicit fold changes re-reveal that selected row while the passage stays
in Find; ordinary resize/reader scrolling does not force navigation. Standalone
Turn rendering retains its existing source-passage fallback. Copy and disclosure
state remain with the original components.

Only visible selected Chat handles platform Mod+F; dialogs and existing shortcut
owners win. Enter/Shift+Enter navigate only in the Find input, with IME protection;
Escape closes Find and returns focus to its trigger. Composer drafts are separate.
Match storage is capped at the first 10,000 occurrences with an explicit count
limit label, preventing pathological short queries from allocating millions of
ranges. Explicit Search earlier reads up to 20 pages per attempt and stops at a new-row
match, history end, retention limit, failure or cancellation. It shares the
single-flight conversation reader and prepend anchor with manual pagination;
closing/changing query/session aborts only the search-owned ticket.

Chat reading memory's sole owner is `chat-scroll-memory`, now persisted on this
browser origin under `herdr_chat_positions_v1` by explicit T172 approval. It keeps
at most 100 exact pane/terminal/native-session/source/history scopes, expires each
30 days after its last changed position, and caps serialized storage at 128 KiB.
The only stored fields are `scope` (the five opaque identities), `turn`, `offset`,
`atEnd`, and `expires`. No transcript, query, cwd, prompt, secret, draft, metadata
label, or recent-target navigation index is stored. Reads/writes/deletion failures
retain memory-only state and show truthful notices; malformed/oversized records
cannot restore. Settings' existing Chat section owns Delete saved reading positions,
separate from Reset Chat appearance. Successful deletion removes this key and clears
the document cache; failed deletion explicitly warns that saved data may survive.
Open tabs do not synchronize and another open document can later save its own
position; multi-tab deletion guarantees are not established.

Restore requires a currently matching pane/terminal action target and the native
reader's resolved source/history binding, not a stored target selection. Root's
selection, drafts and Send authorization owners are unchanged. History bindings
include the existing server epoch and bounded rewrite checks; detected replacements
are ignored, and server restart/observation eviction can invalidate positions rather
than guessing continuity. This does not add a stronger whole-source content proof.
The existing NavigationSearch's empty-query Recently read section derives at most
five unique live pane matches from this same ledger via its typed identity helper.
Labels come only from the current snapshot; no second index or persisted label is
created. Exact terminal and nonempty current native session must match, including
the existing snapshot-agent session fallback. Missing/replaced/unknown-session
entries are omitted; click/Enter rechecks native identity and Space/Tab membership
before calling existing explicit selection. Nothing auto-selects or confers Send
permission. Unselected native source/history is not present in the snapshot, so
navigation does not claim it is validated; actual restoration waits for the reader's
newly resolved exact history. Delete saved reading positions clears recent entries
too. Opening Find/selecting a match explicitly cancels pending restoration; manual
wheel/touch/pointer/key movement keeps the existing cancellation owner.
Canceling saved restoration does not cancel pagination: a pending prepend preserves
the reader's current visible native row and exact offset, refreshed after Find's
layout or manual scrolling, not the abandoned saved row or total-height delta.

Unknown anchors are never fabricated. No storage record dispatches an action. Stable native turn ID and
pixel offset restore reading intent across view/pane remounts; following readers
return to live end. An older missing anchor is recovered through at most 20 pages;
an unavailable anchor truthfully falls back to latest. Session replacement cannot
reuse another session's position. Existing prepend, resize and send-follow behavior
retains its owner. Long-history virtualization is deferred pending representative
rendered performance evidence and search/anchor/selection compatibility validation.
