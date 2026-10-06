import type { ComponentPropsWithRef, FC } from 'react'
import { Button as BaseButton } from '@base-ui/react/button'

export type ButtonVariant =
  'default' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'warning' | 'link'

export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon' | 'compact'

export interface IButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export const Button: FC<IButtonProps> = ({
  variant = 'default',
  size = 'default',
  className = '',
  type = 'button',
  ...props
}) => {
  const variantClass = `ui-button--${variant}`
  const sizeClass =
    size === 'default' ? 'ui-button--default-size' : `ui-button--${size}`
  const combinedClassName =
    `ui-button ${variantClass} ${sizeClass} ${className}`.trim()

  return <BaseButton type={type} className={combinedClassName} {...props} />
}

export default Button
