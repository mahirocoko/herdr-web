# Component Conventions

- Use arrow-function React components and export the public component at the bottom.
- Keep props in an explicit `I...Props` interface.
- Components own rendering and local interaction state; hooks own polling, reconnect, and external lifecycle work.
- Prefer semantic HTML and native buttons/forms before custom interaction shells.
- A visual primitive should be extracted only after repeated use or distinct ownership appears.

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
P1's full native source passage and selected occurrence stay outside the visual
cap, including Thai and hidden matches. Show less returns an above-viewport card
to view. No minimap or global shortcut installation: Find/source navigation and
Latest already own those reading needs; density/virtualization remain deferred
until measured cost. Existing appearance options retain semantics but now use
canonical Select/Input/Checkbox controls; no second font picker is installed.

## Chat reading contracts

`ChatFind` owns a literal query, match case and selected source occurrence for the
current conversation only. The loaded native turns are searched, including folded
work/tool/thinking source; images, synthetic retention notices and omitted text
are not searched. Tool output is the supplied preview, not an implicit whole-output
fetch. A matched row reveals the real source passage with a semantic `mark`, since
source offsets cannot be applied to transformed Markdown. Copy and disclosure
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

Chat reading memory is document-lifetime and bounded to 100 exact
pane/terminal/native-session/source/history scopes. Stable native turn ID and
pixel offset restore reading intent across view/pane remounts; following readers
return to live end. An older missing anchor is recovered through at most 20 pages;
an unavailable anchor truthfully falls back to latest. Session replacement cannot
reuse another session's position. Existing prepend, resize and send-follow behavior
retains its owner. Long-history virtualization is deferred pending representative
rendered performance evidence and search/anchor/selection compatibility validation.
