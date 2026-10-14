// MIT License - Copyright (c) 2026 devswha
// Adapted dc2f11de src/lib/repoDiff.ts: phones always use one code column.
export type RepoDiffStyle = 'unified' | 'split'
export const diffStyleFor = (
  style: RepoDiffStyle,
  narrow: boolean
): RepoDiffStyle => (narrow ? 'unified' : style)
