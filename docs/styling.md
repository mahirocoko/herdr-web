# Styling

## Current Reality

- Authored global CSS with semantic custom properties in `src/app.css`.
- One continuous charcoal terminal workspace with near-black page chrome, elevated controls, safe-area insets, and a bounded `visualViewport` height/offset adapter over a `100dvh` fallback. The viewport meta keeps supported browsers in `resizes-visual` mode so this adapter remains the single keyboard-geometry owner.
- xterm owns terminal paint; surrounding UI owns navigation, status, and actions.
- Panel and History use bounded semantic line/token classes over exact React text children; they do not interpret ANSI or inject terminal markup.
- The global header separates ownership: the left menu trigger opens the Herdr-style Spaces side sheet, the current Space label is passive context, and one compact Tab trigger opens the active-Space Tabs & Panes bottom sheet. Pane IDs remain out of the header. The canvas-owned surface toolbar stays separate and uses flat mode tabs, desktop-only scope metadata, and one fixed refresh/loading slot.
- The footer is one in-flow dock: the stable 16px prompt composer (controlled multiline textarea with min 44px height, bounded auto-growth to ~5 text rows, internal scrolling beyond that, and single accessible focus owner without double rings or glow) comes first and the six-key terminal rail is the final app row before the OS-owned keyboard. Stream scope and connection state stay in flow above xterm rather than covering terminal output.
- Exact Lucide icons (`lucide-react@1.47.0`) own visual controls and status icons across app chrome, using deliberate stroke widths and `aria-hidden` attributes alongside accessible text labels.
- The Spaces surface is a left side sheet patterned after Herdr's native Space list: status dot, mono Space label, truthful count metadata, and one selected-row highlight. Tabs and panes remain in a separate bottom sheet. Other bottom sheet overlays (`attention-queue-sheet`, `interaction-picker-sheet`, `drawer-sheet--new-tab`) reuse the existing sheet anatomy and tokens (`var(--color-bg-base)`, `var(--color-border-subtle)`), 44px touch targets, rounded top corners, sheet handle, and dark translucent backdrops. Modal sheets never stack.
- When Terminal Control Mode is active, a high-contrast accent notice card replaces the prompt composer and thumb deck to maintain strict input exclusivity.
- No Tailwind, CSS-in-JS, or component library.

## Rules

- Preserve the single-pane canvas, flat surface mode toolbar, and thumb-zone hierarchy; do not recombine Space selection with the Tab/Pane hierarchy or introduce duplicate pane labels across header layers.
- Use existing semantic color and spacing variables before adding literals.
- Keep interactive targets at least 44px where mobile use requires it (including surface mode tabs, refresh buttons, quick commands trigger, and the floating Latest button).
- Every interactive control needs visible focus, disabled, and pressed states.
- Surface views (`text-surface-view`, `history-view`, `question-view`, `terminal-canvas`) must support vertical scrolling without horizontal overflow in both portrait (390x844) and landscape (844x390) viewports. The 44px surface mode toggle must support horizontal scrolling without causing document or body overflow at 390px width.
- Never trade terminal readability for decorative panels or repeated cards.
- Keep terminal highlighting calm and structural: plain prose remains primary text, state colors require anchored terminal signals, and path/URL/ID tokenization must preserve every source character and newline.
- Treat header, surface header, reading viewport, key deck, composer, keyboard, and safe-area geometry as one viewport system. Do not combine layout-viewport keyboard resizing with the app's `visualViewport` adapter.
- Keep the native keyboard OS-owned. Visual viewport changes may shrink or shift only the app reading geometry based on intended bounded layout calculations. Classify the software keyboard only when an editable element has focus and the visual viewport has a meaningful height reduction; do not classify browser chrome, hardware-keyboard focus, or pinch zoom as keyboard state.
- Resolve the layout bound from the largest valid `window.innerHeight`, document client height, or `visualViewport` bottom edge. iOS may shrink `innerHeight` while also panning the visual viewport; never let that combination clamp a real keyboard `offsetTop` back to zero.
- Preserve the full `safe-area-inset-bottom` for the home indicator while the keyboard is closed. Suppress only the footer's bottom inset while the software keyboard is positively classified; drawers, settings, header, and horizontal safe areas keep their existing ownership.
- Physical mobile keyboard interactions remain human-device validated; automated geometry and source guards do not prove iPhone Safari or standalone PWA behavior.

The maintainer owns final visual acceptance. Technical checks do not prove product taste.
