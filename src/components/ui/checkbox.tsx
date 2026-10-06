import type { FC } from 'react'
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import { Check } from 'lucide-react'

export interface ICheckboxProps {
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

export const Checkbox: FC<ICheckboxProps> = ({
  className = '',
  onCheckedChange,
  ...props
}) => {
  const combinedClassName = `ui-checkbox ${className}`.trim()

  return (
    <BaseCheckbox.Root
      className={combinedClassName}
      onCheckedChange={(checked) => onCheckedChange?.(Boolean(checked))}
      {...props}
    >
      <BaseCheckbox.Indicator className="ui-checkbox__indicator">
        <Check size={12} strokeWidth={3} aria-hidden="true" />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  )
}

export default Checkbox
