export const toolSummary = (args: unknown): string => {
  if (!args || typeof args !== 'object') return ''
  const values = args as Record<string, unknown>
  for (const key of [
    'toolSummary',
    'description',
    'cmd',
    'CommandLine',
    'path',
    'TargetFile',
    'file_path'
  ]) {
    const value = values[key]
    if (typeof value === 'string' && value.trim())
      return value.replace(/\s+/g, ' ').slice(0, 240)
  }
  return ''
}
