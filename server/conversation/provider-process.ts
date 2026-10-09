// MIT License - Copyright (c) 2026 devswha
// Pure classifier adapted from codex.ts / claude-store.ts at 5979118.
const CODE_OPTIONS = new Set(['eval','print','require','import','loader','experimental-loader','input-type'])
const VALUELESS_OPTIONS = new Set(['','no-warnings','no-deprecation','trace-warnings','trace-deprecation','pending-deprecation','throw-deprecation','enable-source-maps','preserve-symlinks','preserve-symlinks-main','expose-gc','abort-on-uncaught-exception','experimental-strip-types','experimental-transform-types','experimental-require-module','no-experimental-fetch','harmony','bun','smol','hot','watch','noprofile','norc','posix','login'])
export const isProviderProcess = (entry: { name?: string; argv0?: string; argv?: string[] }, provider: 'codex' | 'claude') => {
  if (provider === 'claude') return [entry.name,entry.argv0,entry.argv?.[0]].some(value => typeof value === 'string' && /(?:^|[\\/])claude(?:\.exe)?$/.test(/\\|\.exe$/i.test(value) ? value.toLowerCase() : value))
  const argv = entry.argv ?? [entry.argv0 ?? entry.name ?? '']
  const executable = argv[0] ?? ''
  const codex = /(?:^|[\\/])codex(?:\.js|\.exe|\.opencodex-real)?$/
  if (codex.test(executable)) return true
  if (!/(?:^|[\\/])(?:node|bun|sh|bash|dash|zsh)(?:\.exe)?$/.test(executable)) return false
  let script = 1
  for (; argv[script]?.startsWith('--'); script++) {
    const option = argv[script] ?? ''
    const name = option.slice(2,option.includes('=') ? option.indexOf('=') : undefined)
    if (CODE_OPTIONS.has(name)) return false
    if (!option.includes('=') && !VALUELESS_OPTIONS.has(name)) return false
  }
  return codex.test(argv[script] ?? '')
}
