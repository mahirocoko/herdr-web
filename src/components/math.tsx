import { useEffect, useState } from 'react'
interface IMathProps {
  tex: string
  displayMode?: boolean
}
const Math = ({ tex, displayMode = false }: IMathProps) => {
  const [result, setResult] = useState<{
    tex: string
    display: boolean
    html: string
  } | null>(null)
  useEffect(() => {
    let active = true
    void Promise.all([
      import('@/utils/math-markup.ts'),
      import('katex/dist/katex.min.css')
    ])
      .then(([module]) => {
        const html = module.renderMathMarkup(tex, displayMode)
        if (active) setResult({ tex, display: displayMode, html })
      })
      .catch(() => {
        if (active) setResult(null)
      })
    return () => {
      active = false
    }
  }, [tex, displayMode])
  const Tag = displayMode ? 'div' : 'span'
  const ready =
    result?.tex === tex && result.display === displayMode ? result.html : null
  return ready !== null ? (
    <Tag
      className={displayMode ? 'markdown-math-display' : 'markdown-math'}
      dangerouslySetInnerHTML={{ __html: ready }}
    />
  ) : (
    <Tag className={displayMode ? 'markdown-math-display' : 'markdown-math'}>
      {displayMode ? `\\[${tex}\\]` : `\\(${tex}\\)`}
    </Tag>
  )
}
export { Math }
