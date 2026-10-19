// Native Herdr agent.start names: ASCII lowercase, 1–32 characters.
export const NATIVE_AGENT_NAME_MAX_LENGTH = 32
export const NATIVE_AGENT_NAME_PATTERN = '[a-z][a-z0-9_\\-]{0,31}'
// Strict end-of-input: JavaScript's `$` also accepts a final newline.
export const NATIVE_AGENT_NAME_REGEX = new RegExp(
  `^${NATIVE_AGENT_NAME_PATTERN}(?![\\s\\S])`
)
