// Non-executing, bounded eligibility probe — not a general XML sanitizer or GPU budget.
const MAX_SVG_BYTES = 256 * 1024
export const isInlineSvg = (bytes: Uint8Array, size: number) => {
  if (size > MAX_SVG_BYTES || bytes.length !== size) return false
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (
    /<!DOCTYPE|<!ENTITY/i.test(text) ||
    (text.match(/</g)?.length ?? 0) > 2048
  )
    return false
  const root =
    /^\uFEFF?\s*(?:<\?xml[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b([^>]*)>/i.exec(
      text
    )
  if (!root) return false
  const attribute = (name: string) =>
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(
      root[1]!
    )?.[2]
  const dimension = (value: string | undefined, fallback: number) =>
    value === undefined
      ? fallback
      : /^\s*\d+(?:\.\d+)?(?:px)?\s*$/i.test(value)
        ? Number(value.trim().replace(/px$/i, ''))
        : NaN
  const width = dimension(attribute('width'), 300),
    height = dimension(attribute('height'), 150)
  const viewBox = attribute('viewBox')
  if (viewBox) {
    const values = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (
      values.length !== 4 ||
      values.some((v) => !Number.isFinite(v) || Math.abs(v) > 8192) ||
      values[2]! <= 0 ||
      values[3]! <= 0
    )
      return false
  }
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width <= 8192 &&
    height <= 8192 &&
    width * height <= 32 * 1024 * 1024
  )
}
