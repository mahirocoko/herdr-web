# Current UI design reference

The shipped client is authoritative: `src/styles.css` owns shared tokens/primitives; component CSS owns local anatomy. Preserve the accepted source shell and fork branding. The [pinned upstream design reference](https://github.com/devswha/herdr-web-ui/blob/d918448647e41079c52047ffc96cdaac50ccba32/DESIGN.md) retains historical component rationale, not current deployment authority.

## Themes

Amber is the CSS base; new settings default to the Codex theme pair. Saved themes remain user-owned. Author colors only in CSS. `scripts/generate-themes.ts` writes the terminal theme module, marked table below, HTML theme-color and manifest colors. Never hand-edit these copies.

<!-- BEGIN GENERATED THEMES -->
| Role | Token | Dark | Light |
|------|-------|------|-------|
| Surface/base | `--bg` | `#12100e` | `#eeeae2` |
| Surface/panel | `--bg-panel` | `#181613` | `#faf8f3` |
| Surface/elevated | `--bg-elevated` | `#211e1a` | `#f2eee6` |
| Surface/hover | `--bg-hover` | `#2a2621` | `#e8e2d6` |
| Surface/input | `--bg-input` | `#1c1916` | `#fffdf9` |
| Border | `--border` | `#2d2924` | `#dcd4c6` |
| Border/strong | `--border-strong` | `#3e3830` | `#c5baa8` |
| Chat bubble edge | `--bubble-border` | `transparent` | `var(--border)` |
| Text/primary | `--text` | `#d8d0c3` | `#2a251f` |
| Text/dim | `--text-dim` | `#9b9183` | `#685e52` |
| Text/strong | `--text-strong` | `#f2ebdf` | `#16120d` |
| Accent | `--accent` | `#f0a830` | `#8c5000` |
| Accent/tint | `--accent-tint` | `rgba(240, 168, 48, 0.13)` | `rgba(140, 80, 0, 0.1)` |
| Primary | `--primary` | `#f0a830` | `#c57d12` |
| Primary/hover | `--primary-hover` | `#f6bb55` | `#d48c1f` |
| Primary/text | `--primary-text` | `#1b1407` | `#1b1407` |
| Primary/tint | `--primary-tint` | `rgba(240, 168, 48, 0.16)` | `rgba(197, 125, 18, 0.14)` |
| Status/idle | `--status-idle` | `#9b9183` | `#685e52` |
| Status/working | `--status-working` | `#6cb8d6` | `#155a72` |
| Status/blocked | `--status-blocked` | `#ff7b70` | `#a82323` |
| Status/done | `--status-done` | `#93c36b` | `#2f6317` |
| Working/tint | `--status-working-tint` | `rgba(108, 184, 214, 0.14)` | `rgba(21, 90, 114, 0.12)` |
| Blocked/tint | `--status-blocked-tint` | `rgba(255, 123, 112, 0.14)` | `rgba(168, 35, 35, 0.12)` |
| Done/tint | `--status-done-tint` | `rgba(147, 195, 107, 0.14)` | `rgba(47, 99, 23, 0.12)` |
| Indicator/working | `--indicator-working` | `#f9e2af` | `#df8e1d` |
| Indicator/blocked | `--indicator-blocked` | `#f38ba8` | `#d20f39` |
| Indicator/done | `--indicator-done` | `#94e2d5` | `#179299` |
| Indicator/idle | `--indicator-idle` | `#a6e3a1` | `#40a02b` |
| Indicator/unknown | `--indicator-unknown` | `#6c7086` | `#9ca0b0` |
| Danger/tint | `--danger-tint` | `rgba(255, 123, 112, 0.12)` | `rgba(168, 35, 35, 0.1)` |
| Danger/text | `--danger-text` | `#ffd9d4` | `#8f1d1d` |
| Notice | `--notice` | `#e8c55c` | `#7a5a00` |
| Overlay/scrim | `--scrim` | `rgba(8, 6, 4, 0.55)` | `rgba(40, 32, 22, 0.35)` |
| Drawer shadow | `--shadow-drawer` | `0 0 40px rgba(0, 0, 0, 0.6)` | `0 0 40px rgba(40, 32, 22, 0.22)` |
| Popover shadow | `--shadow-pop` | `0 16px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px var(--border)` | `0 16px 48px rgba(40, 32, 22, 0.16), 0 0 0 1px var(--border)` |
| Card shadow | `--shadow-card` | `0 4px 16px rgba(0, 0, 0, 0.35)` | `0 4px 16px rgba(40, 32, 22, 0.07)` |
| Document surface | `--pdf-page` | `#ffffff` | `#ffffff` |
| Terminal/background | `--term-bg` | `#181613` | `#faf8f3` |
| Terminal/foreground | `--term-fg` | `#d8d0c3` | `#2a251f` |
| Terminal/cursor | `--term-cursor` | `#f0a830` | `#8c5000` |
| Terminal/selection | `--term-selection` | `#4a3d26` | `#f0d9ae` |
| Syntax/keyword | `--syntax-keyword` | `#e8875f` | `#a33a17` |
| Syntax/string | `--syntax-string` | `#a8c17c` | `#4b6b18` |
| Syntax/number | `--syntax-number` | `#d6a0c9` | `#8a3f7a` |
| Syntax/type | `--syntax-type` | `#6cb8d6` | `#155a72` |
| Syntax/variable | `--syntax-variable` | `#e0c08f` | `#7a5418` |
| Syntax/meta | `--syntax-meta` | `#b49dd6` | `#5d4791` |
| Alert/background | `--droplet-bg` | `#000` | `#000` |
| Alert/text | `--droplet-text` | `#f5f5f7` | `#f5f5f7` |
| Alert/dim text | `--droplet-text-dim` | `rgba(245, 245, 247, 0.62)` | `rgba(245, 245, 247, 0.62)` |
| Alert/blocked | `--droplet-blocked` | `#ff8a80` | `#ff8a80` |
| Alert/done | `--droplet-done` | `#9fd47a` | `#9fd47a` |
| Alert/mark background | `--droplet-mark-bg` | `rgba(255, 255, 255, 0.1)` | `rgba(255, 255, 255, 0.1)` |
| Alert/ring | `--droplet-ring` | `rgba(255, 255, 255, 0.1)` | `rgba(255, 255, 255, 0.1)` |
| Alert/shadow | `--droplet-shadow` | `rgba(0, 0, 0, 0.35)` | `rgba(0, 0, 0, 0.35)` |

### Light terminal ANSI colours

Each colour is at least 4.5:1 on its row's `--term-bg`. Dark rows use xterm's defaults.
Normal and bright slots may share a colour to preserve the palette while keeping both readable.

| ANSI | xterm key | amber | charcoal | codex | catppuccin | catppuccin-latte | tokyo-night-day | gruvbox-light | one-light | solarized-light | kanagawa-lotus | rose-pine-dawn |
|------|-----------|-------|-------|-------|-------|-------|-------|-------|-------|-------|-------|-------|
| 0 | `black` | `#2a251f` | `#242424` | `#1a1c1f` | `#4c4f69` | `#4c4f69` | `#3760bf` | `#3c3836` | `#383a42` | `#556a72` | `#545464` | `#464261` |
| 1 | `red` | `#a82323` | `#b3261e` | `#b3261e` | `#ac0c2f` | `#ac0c2f` | `#90001b` | `#9d0006` | `#a51110` | `#b60006` | `#95002b` | `#873a52` |
| 2 | `green` | `#2f6317` | `#22743a` | `#22743a` | `#28651b` | `#28651b` | `#405b1f` | `#676200` | `#287c2a` | `#5d6e00` | `#4a6228` | `#286983` |
| 3 | `yellow` | `#8c5000` | `#8a5300` | `#8a5300` | `#8a5710` | `#8a5710` | `#6c4d1f` | `#8e5100` | `#995f00` | `#8a5f00` | `#625b2a` | `#9e5600` |
| 4 | `blue` | `#155a72` | `#0b6e8a` | `#0b6e8a` | `#1750bf` | `#1750bf` | `#004db6` | `#076678` | `#2f64dd` | `#006baf` | `#4d699b` | `#286983` |
| 5 | `magenta` | `#8a3f7a` | `#6f42c1` | `#6f42c1` | `#712fc6` | `#712fc6` | `#7847bd` | `#8f3f71` | `#a626a4` | `#c12073` | `#624c83` | `#755f8d` |
| 6 | `cyan` | `#0f6b6f` | `#0f6f74` | `#0f6f74` | `#0e6b70` | `#0e6b70` | `#005f4a` | `#316b48` | `#0072a9` | `#00746d` | `#216276` | `#33717c` |
| 7 | `white` | `#685e52` | `#5f5b56` | `#5f5b56` | `#5c5f77` | `#5c5f77` | `#41508a` | `#504945` | `#686b77` | `#5a6a6c` | `#43436c` | `#605b78` |
| 8 | `brightBlack` | `#5a5045` | `#4e4b47` | `#4e4b47` | `#64677d` | `#64677d` | `#41508a` | `#504945` | `#686b77` | `#586e75` | `#43436c` | `#605b78` |
| 9 | `brightRed` | `#c42b2b` | `#c92d24` | `#c92d24` | `#c41545` | `#c41545` | `#90001b` | `#9d0006` | `#a51110` | `#b60006` | `#95002b` | `#873a52` |
| 10 | `brightGreen` | `#3b741c` | `#277d3f` | `#277d3f` | `#2f7620` | `#2f7620` | `#405b1f` | `#676200` | `#287c2a` | `#5d6e00` | `#4a6228` | `#286983` |
| 11 | `brightYellow` | `#9d5a00` | `#9f6100` | `#9f6100` | `#905c13` | `#905c13` | `#6c4d1f` | `#8e5100` | `#995f00` | `#8a5f00` | `#625b2a` | `#9e5600` |
| 12 | `brightBlue` | `#1d6f8c` | `#1a7391` | `#1a7391` | `#0b59f4` | `#0b59f4` | `#004db6` | `#076678` | `#2f64dd` | `#006baf` | `#4d699b` | `#286983` |
| 13 | `brightMagenta` | `#a24b90` | `#7f52d1` | `#7f52d1` | `#8839ef` | `#8839ef` | `#7847bd` | `#8f3f71` | `#a626a4` | `#c12073` | `#624c83` | `#755f8d` |
| 14 | `brightCyan` | `#117676` | `#13767e` | `#13767e` | `#13737a` | `#13737a` | `#005f4a` | `#316b48` | `#0072a9` | `#00746d` | `#216276` | `#33717c` |
| 15 | `brightWhite` | `#16120d` | `#111111` | `#0d0d0d` | `#4c4f69` | `#4c4f69` | `#3760bf` | `#3c3836` | `#383a42` | `#556a72` | `#545464` | `#464261` |
<!-- END GENERATED THEMES -->

Glass uses palette-relative mixes: panel 72% for `--bar-bg`, elevated 80% for `--card-glass`, with `saturate(180%) blur(20px)`. PDF pages remain white.

## Type and geometry

UI uses Pretendard; monospace UI uses Symbols Nerd Font Mono then JetBrains Mono Web/system fallbacks. Terminal font selection is separate. Comfortable type at scale 1 is 11/12/13/14/15/16/18/22px; Chat prose is 15px and inputs retain a 16px floor against iOS focus zoom. Line heights are 1.2/1.5/1.6/1.65; weights 400/500/600/700. Compact density and user scale override roles.

Spacing is 4/8/12/16/20/24/32px; radii 6/8/12/16/24px plus pill. Comfortable geometry: sidebar 320px, header 52px (wide 46px), controls 34px, rows 56px, key bar 48px. Hit targets are 44px coarse-pointer and 24px pointer minimum; focus is a 2px accent ring with 2px offset.

Content width starts at 820px. `PaneTerminal` measures the shared Chat lane; transcript, composer and held rows must align to it, not independent percentages. Source breakpoints collapse sidebar/splits at 768px, settings/sheets at 640px and header at 480px.

## Anatomy and interaction

Keep sidebar workspace/agent navigation separate from tabs and pane canvas. Rows use identity, title and trailing state; neutral fills establish selection, provider marks identify brands, and state color communicates state. Chat user cards stay neutral; work/tool details fold into their turn. Preserve composer, held rows and prompt cards as distinct responsibilities.

Reuse global `.btn`, `.icon-button`, `.segmented`, `.modal`, `.menu`, `.badge`, `.pill` and `.kbd` primitives. Preserve focus entry/return, Escape behavior, disabled states and confirmations. Files/diffs and terminal retain their component owners. Terminal Pause fit detaches without stopping the process; Resume Live does not replay input.

Use one concise actionable message per situation, with optional technical detail. Pair state color with text/live-region semantics. Keep reduced motion, safe areas, keyboard viewport handling and touch targets. Timing roles are 120ms fast, 180ms base, 1600ms pulse/spin and 2000ms breathe; source easing is `cubic-bezier(0.2, 0, 0, 1)` / `cubic-bezier(0.32, 0.72, 0, 1)`, with stepped pulse.

## Fork presentation and checks

Retain the fork terminal mark and authentic Letta mark. About is fork-owned; Letta integration describes private history, not global hooks. Usage is hidden at page/palette boundaries. App-owned install/management affordances are removed; PWA/SW remains. Thinking footer paint is not native completion authority.

Check affected light/dark, keyboard, focus, wrapping and zoom behavior—not screenshots alone. [Development](docs/development.md) owns safe validation/regeneration; [coverage](docs/upstream-parity.md) separates source implementation, rendered proof and human/device acceptance.
