// MIT License - Copyright (c) 2026 devswha
// Adapted from devswha/herdr-web-ui
import { Check, Copy } from 'lucide-react'
import {
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { OpenChatToolFileContext } from './chat-tool-content.tsx'
import { codeIsFilePath, splitFilePaths } from '@/utils/chat-file-paths.ts'
import { Math } from './math.tsx'
import {
  foldCode,
  type IListBlock,
  type InlineNode,
  type MarkdownBlock,
  parseMarkdown,
  safeMarkdownHref
} from '../utils/markdown-parser.ts'

interface IInlineProps {
  nodes: InlineNode[]
  interactive?: boolean
}

const Inline = ({ nodes, interactive = true }: IInlineProps): ReactNode => {
  const openFile = useContext(OpenChatToolFileContext)
  return (
    <>
      {nodes.map((node, index) => {
        const key = `${node.type}-${index}`
        switch (node.type) {
          case 'text':
            return (
              <span key={key}>
                {interactive && openFile
                  ? splitFilePaths(node.value).map((part, i) =>
                      typeof part === 'string' ? (
                        part
                      ) : (
                        <button
                          key={i}
                          type="button"
                          className="markdown-file"
                          title={`Open ${part.path}`}
                          onClick={() => openFile(part.path)}
                        >
                          {part.path}
                        </button>
                      )
                    )
                  : node.value}
              </span>
            )
          case 'code': {
            if (interactive && openFile && codeIsFilePath(node.value))
              return (
                <button
                  key={key}
                  type="button"
                  className="markdown-file"
                  title={`Open ${node.value}`}
                  onClick={() => openFile(node.value)}
                >
                  <code>{node.value}</code>
                </button>
              )
            if (interactive && /^https?:\/\/\S+$/i.test(node.value)) {
              return (
                <a
                  key={key}
                  className="markdown-code-link"
                  href={node.value}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <code>{node.value}</code>
                </a>
              )
            }
            return <code key={key}>{node.value}</code>
          }
          case 'math':
            return <Math key={key} tex={node.value} />
          case 'strong':
            return (
              <strong key={key}>
                <Inline nodes={node.children} interactive={interactive} />
              </strong>
            )
          case 'em':
            return (
              <em key={key}>
                <Inline nodes={node.children} interactive={interactive} />
              </em>
            )
          case 'del':
            return (
              <del key={key}>
                <Inline nodes={node.children} interactive={interactive} />
              </del>
            )
          case 'link': {
            const safeHref = safeMarkdownHref(node.href)
            if (safeHref !== null) {
              return (
                <a
                  key={key}
                  href={safeHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Inline nodes={node.children} interactive={false} />
                </a>
              )
            }
            return (
              <span key={key}>
                <Inline nodes={node.children} interactive={false} />
              </span>
            )
          }
          case 'file': {
            const label = <Inline nodes={node.children} interactive={false} />
            if (interactive && openFile)
              return (
                <button
                  key={key}
                  type="button"
                  className="markdown-file"
                  onClick={() => openFile(node.path)}
                >
                  {label}
                </button>
              )
            return (
              <span key={key} className="markdown-file">
                {label} (<code>{node.path}</code>)
              </span>
            )
          }
        }
      })}
    </>
  )
}

const List = ({ block }: { block: IListBlock }): ReactNode => {
  const Tag = block.ordered ? 'ol' : 'ul'
  return (
    <Tag
      className="markdown-list"
      start={block.ordered ? block.start : undefined}
    >
      {block.items.map((item, index) => (
        <li key={index}>
          <Inline nodes={item.content} />
          {item.blocks !== undefined && <Blocks blocks={item.blocks} />}
        </li>
      ))}
    </Tag>
  )
}

const CodeBlock = ({
  language,
  value
}: {
  language: string
  value: string
}): ReactNode => {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const block = useRef<HTMLDivElement>(null)
  const fold = useMemo(() => foldCode(value), [value])

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const folding = useRef(false)
  const toggle = (): void => {
    folding.current = expanded
    setExpanded(!expanded)
  }

  useLayoutEffect(() => {
    if (!folding.current) return
    folding.current = false
    const node = block.current
    const view = node?.closest('.chat-view')
    if (
      node &&
      view &&
      node.getBoundingClientRect().top < view.getBoundingClientRect().top
    ) {
      node.scrollIntoView({ block: 'start' })
    }
  }, [expanded])

  return (
    <div className="markdown-code" ref={block}>
      <div className="markdown-code-header">
        <span>{language || 'text'}</span>
        <button
          type="button"
          className="icon-button markdown-code-copy"
          onClick={() => void copy()}
          aria-label={copied ? 'Code copied' : 'Copy code'}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </button>
      </div>
      <pre>
        <code>{fold !== null && !expanded ? fold.head : value}</code>
      </pre>
      {fold !== null && (
        <button
          type="button"
          className="markdown-code-more"
          aria-expanded={expanded}
          onClick={toggle}
        >
          {expanded ? 'Show less' : `Show all ${fold.lines} lines`}
        </button>
      )}
    </div>
  )
}

const Blocks = ({ blocks }: { blocks: MarkdownBlock[] }): ReactNode => {
  return (
    <>
      {blocks.map((block, index): ReactNode => {
        const key = `${block.type}-${index}`
        switch (block.type) {
          case 'heading': {
            const Tag = `h${block.level}` as
              'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
            return (
              <Tag key={key}>
                <Inline nodes={block.content} />
              </Tag>
            )
          }
          case 'paragraph':
            return (
              <p key={key}>
                {block.lines.map((line, lineIndex) => (
                  <span key={lineIndex}>
                    <Inline nodes={line} />
                    {lineIndex < block.lines.length - 1 && <br />}
                  </span>
                ))}
              </p>
            )
          case 'list':
            return <List key={key} block={block} />
          case 'blockquote':
            return (
              <blockquote key={key}>
                <Blocks blocks={block.blocks} />
              </blockquote>
            )
          case 'code':
            return (
              <CodeBlock
                key={key}
                language={block.language}
                value={block.value}
              />
            )
          case 'math':
            return <Math key={key} tex={block.value} displayMode />
          case 'hr':
            return <hr key={key} />
          case 'table':
            return (
              <div className="markdown-table-wrap" key={key}>
                <table>
                  <thead>
                    <tr>
                      {block.header.map((cell, cellIndex) => (
                        <th key={cellIndex}>
                          <Inline nodes={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex}>
                            <Inline nodes={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
        }
      })}
    </>
  )
}

export interface IMarkdownProps {
  children: string
  className?: string
}

export const Markdown = ({
  children,
  className
}: IMarkdownProps): ReactNode => {
  const blocks = useMemo(() => parseMarkdown(children), [children])
  return (
    <div
      className={className === undefined ? 'markdown' : `markdown ${className}`}
    >
      <Blocks blocks={blocks} />
    </div>
  )
}
