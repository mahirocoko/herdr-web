import type { ComponentPropsWithRef, FC } from 'react'

/**
 * Textarea Primitive
 *
 * Architectural Note / Exception:
 * Base UI 1.8.0 does not provide a standalone Textarea component.
 * This owned primitive encapsulates native semantic <textarea> with the shared
 * field recipe, maintaining 16px mobile font-size to prevent iOS auto-zoom,
 * accessible focus rings, and full compatibility with IME composition events
 * and multiline auto-resize layouts.
 */

export interface ITextareaProps extends ComponentPropsWithRef<'textarea'> {
  error?: boolean
}

export const Textarea: FC<ITextareaProps> = ({
  error = false,
  className = '',
  ...props
}) => {
  const errorClass = error ? 'ui-textarea--error' : ''
  const combinedClassName = `ui-textarea ${errorClass} ${className}`.trim()

  return <textarea className={combinedClassName} {...props} />
}

export default Textarea
