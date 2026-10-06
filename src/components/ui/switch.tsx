import type { FC } from 'react'
import { Switch as BaseSwitch } from '@base-ui/react/switch'

export interface ISwitchProps {
  id?: string
  name?: string
  value?: string
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  required?: boolean
  onCheckedChange?: (checked: boolean) => void
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

export const Switch: FC<ISwitchProps> = ({
  className = '',
  onCheckedChange,
  ...props
}) => {
  const combinedClassName = `ui-switch ${className}`.trim()

  return (
    <BaseSwitch.Root
      className={combinedClassName}
      onCheckedChange={(checked) => onCheckedChange?.(Boolean(checked))}
      {...props}
    >
      <BaseSwitch.Thumb className="ui-switch__thumb" />
    </BaseSwitch.Root>
  )
}

export default Switch
