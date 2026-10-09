// MIT License - Copyright (c) 2026 devswha
// Adapted from pinned5979118 lib/filePaths.ts; context has one local owner.
const BARE_PATH =
  /(?<![\p{L}\p{N}\p{M}_/.@~-])(?<!\+(?!~))((?:~\/|\.{1,2}\/|\/)?(?:[\p{L}\p{N}\p{M}_@.+-]+\/)+[\p{L}\p{N}_@+-][\p{L}\p{N}\p{M}_@.+-]*\.[A-Za-z0-9]{1,8})(?![\p{L}\p{N}\p{M}_/])/gu
const CODE_PATH =
  /^(?:~\/|\.{1,2}\/|\/)?(?:[\p{L}\p{N}\p{M}_@.+-]+\/)*[\p{L}\p{N}_@+-][\p{L}\p{N}\p{M}_@.+-]*\.[A-Za-z0-9]{1,8}$/u
const CODE_NAME =
  /^(?:process\.(?:env|argv|cwd|exit|platform|stdout|stderr|stdin)(?:\.\w+)?|Math\.(?:random|floor|ceil|round|max|min|abs|pow|sqrt|trunc|sign)|JSON\.(?:parse|stringify)|console\.(?:log|error|warn|info|debug)|Object\.(?:keys|values|entries|assign|freeze)|Array\.(?:from|isArray)|Promise\.(?:all|race|any|allSettled|resolve|reject)|Number\.(?:isFinite|isInteger|parseInt|parseFloat)|tool\.(?:monitor|read|bash|grep|write|edit)|os\.(?:path|environ|getcwd|getenv)|sys\.(?:argv|path|exit|stdout|stderr)|window\.(?:location|history|open)|document\.(?:body|title|cookie))$/
export const codeIsFilePath = (code: string) =>
  CODE_PATH.test(code) &&
  !(!code.includes('/') && CODE_NAME.test(code)) &&
  /\p{L}/u.test(code.replace(/\.[A-Za-z0-9]{1,8}$/, '')) &&
  !/^\d+(?:\.\d+)+$/.test(code)
export const splitFilePaths = (text: string): (string | { path: string })[] => {
  const parts: (string | { path: string })[] = []
  let offset = 0
  for (const match of text.matchAll(BARE_PATH)) {
    const index = match.index ?? 0
    if (!/\p{L}/u.test(match[1]!.replace(/\.[A-Za-z0-9]{1,8}$/, ''))) continue
    if (index > offset) parts.push(text.slice(offset, index))
    parts.push({ path: match[1]! })
    offset = index + match[0].length
  }
  if (offset < text.length) parts.push(text.slice(offset))
  return parts
}
