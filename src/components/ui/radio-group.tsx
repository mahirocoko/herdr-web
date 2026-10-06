import type { FC, ReactNode } from 'react'
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group'
import { Radio as BaseRadio } from '@base-ui/react/radio'

export interface IRadioGroupProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  name?: string
  className?: string
  children?: ReactNode
  'aria-label'?: string
  'aria-labelledby'?: string
}

export const RadioGroup: FC<IRadioGroupProps> = ({
  className = '',
  onValueChange,
  children,
  ...props
}) => {
  const combinedClassName = `ui-radio-group ${className}`.trim()

  return (
    <BaseRadioGroup
      className={combinedClassName}
      onValueChange={(val) => onValueChange?.(String(val))}
      {...props}
    >
      {children}
    </BaseRadioGroup>
  )
}

export interface IRadioGroupItemProps {
  value: string
  id?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  children?: ReactNode
}

export const RadioGroupItem: FC<IRadioGroupItemProps> = ({
  className = '',
  children,
  ...props
}) => {
  const combinedClassName = `ui-radio ${className}`.trim()

  return (
    <BaseRadio.Root className={combinedClassName} {...props}>
      <BaseRadio.Indicator className="ui-radio__indicator" />
      {children}
    </BaseRadio.Root>
  )
}

export default RadioGroup
