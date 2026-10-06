import type { ComponentPropsWithRef, FC } from 'react'
import { Input as BaseInput } from '@base-ui/react/input'

export type InputSize = 'default' | 'sm'

export interface IInputProps extends ComponentPropsWithRef<'input'> {
  inputSize?: InputSize
  error?: boolean
}

export const Input: FC<IInputProps> = ({
  inputSize = 'default',
  error = false,
  className = '',
  ...props
}) => {
  const sizeClass = inputSize === 'sm' ? 'ui-input--sm' : ''
  const errorClass = error ? 'ui-input--error' : ''
  const combinedClassName =
    `ui-input ${sizeClass} ${errorClass} ${className}`.trim()

  return <BaseInput className={combinedClassName} {...props} />
}

export default Input
