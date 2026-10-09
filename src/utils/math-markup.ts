import katex from 'katex'
// Only KaTeX-produced escaped markup; never accept raw HTML or trusted commands.
export const renderMathMarkup = (tex: string, displayMode: boolean) => {
  if (tex.length > 20000) throw new Error('Math exceeds the rendering envelope')
  return katex.renderToString(tex, {
    displayMode,
    throwOnError: false,
    trust: false,
    strict: 'ignore',
    maxExpand: 1000,
    maxSize: 20
  })
}
