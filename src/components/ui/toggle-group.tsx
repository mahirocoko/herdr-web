import * as React from 'react'
import { ToggleGroup as BaseToggleGroup } from '@base-ui/react/toggle-group'

export interface IToggleGroupProps<
  Value extends string = string,
> extends React.ComponentPropsWithoutRef<typeof BaseToggleGroup<Value>> {}

export const ToggleGroup = React.forwardRef<
  HTMLDivElement,
  IToggleGroupProps<any>
>(({ className, ...props }, ref) => {
  return (
    <BaseToggleGroup
      ref={ref}
      className={`ui-toggle-group ${className || ''}`.trim()}
      {...props}
    />
  )
})
ToggleGroup.displayName = 'ToggleGroup'

export default ToggleGroup
