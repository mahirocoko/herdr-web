# Styling

## Current Reality

- Authored global CSS with semantic custom properties in `src/app.css`.
- One continuous charcoal terminal workspace with near-black page chrome, elevated controls, safe-area insets, and a bounded `visualViewport` height/offset adapter over a `100dvh` fallback.
- xterm owns terminal paint; surrounding UI owns navigation, status, and actions.
- Panel and History use bounded semantic line/token classes over exact React text children; they do not interpret ANSI or inject terminal markup.
- The global header owns connection plus one compact workspace/tab selector; pane IDs remain in the drawer rather than the header. The canvas-owned surface toolbar stays separate and uses flat mode tabs, desktop-only scope metadata, and one fixed refresh/loading slot.
- The footer is one in-flow dock: the stable 16px prompt composer (controlled multiline textarea with min 44px height, bounded auto-growth to ~5 text rows, internal scrolling beyond that, and single accessible focus owner without double rings or glow) comes first and the six-key terminal rail is the final app row before the OS-owned keyboard. Stream scope and connection state stay in flow above xterm rather than covering terminal output.
- Exact Lucide icons (`lucide-react@1.47.0`) own visual controls and status icons across app chrome, using deliberate stroke widths and `aria-hidden` attributes alongside accessible text labels.
- Bottom sheet overlays (`attention-queue-sheet`, `interaction-picker-sheet`, `drawer-sheet--new-tab`) reuse the existing drawer sheet anatomy and tokens (`var(--color-bg-base)`, `var(--color-border-subtle)`), 44px touch targets, rounded top corners, sheet handle, and dark translucent backdrops. They never stack modal overlays on top of each other.
- When Terminal Control Mode is active, a high-contrast accent notice card replaces the prompt composer and thumb deck to maintain strict input exclusivity.
- No Tailwind, CSS-in-JS, or component library.

## Rules

- Preserve the single-pane canvas, flat surface mode toolbar, and thumb-zone hierarchy; do not reintroduce duplicate pane labels or drawer triggers across the two header layers.
- Use existing semantic color and spacing variables before adding literals.
- Keep interactive targets at least 44px where mobile use requires it (including surface mode tabs, refresh buttons, quick commands trigger, and the floating Latest button).
- Every interactive control needs visible focus, disabled, and pressed states.
- Surface views (`text-surface-view`, `history-view`, `question-view`, `terminal-canvas`) must support vertical scrolling without horizontal overflow in both portrait (390x844) and landscape (844x390) viewports. The 44px surface mode toggle must support horizontal scrolling without causing document or body overflow at 390px width.
- Never trade terminal readability for decorative panels or repeated cards.
- Keep terminal highlighting calm and structural: plain prose remains primary text, state colors require anchored terminal signals, and path/URL/ID tokenization must preserve every source character and newline.
- Treat header, surface header, reading viewport, key deck, composer, keyboard, and safe-area geometry as one viewport system.
- Keep the native keyboard OS-owned. Visual viewport changes may shrink or shift only the app reading geometry based on intended bounded layout calculations (physical mobile keyboard interactions remain human-device validated); pinch zoom must remain available and must not be classified as keyboard state.

The maintainer owns final visual acceptance. Technical checks do not prove product taste.
