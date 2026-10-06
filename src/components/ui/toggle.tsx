import * as React from 'react'
import { Toggle as BaseToggle } from '@base-ui/react/toggle'

export interface IToggleProps extends React.ComponentPropsWithoutRef<
  typeof BaseToggle
> {
  variant?: 'default' | 'outline' | 'tab'
  size?: 'default' | 'sm' | 'compact'
}

export const Toggle = React.forwardRef<HTMLButtonElement, IToggleProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const variantClass = `ui-toggle--${variant}`
    const sizeClass =
      size === 'default' ? 'ui-toggle--default-size' : `ui-toggle--${size}`
    return (
      <BaseToggle
        ref={ref}
        className={`ui-toggle ${variantClass} ${sizeClass} ${className || ''}`.trim()}
        {...props}
      />
    )
  },
)
Toggle.displayName = 'Toggle'

export default Toggle
