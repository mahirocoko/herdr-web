import type { FC, ReactNode } from 'react'
import { Select as BaseSelect } from '@base-ui/react/select'
import { Check, ChevronDown } from 'lucide-react'

export interface ISelectOption {
  value: string
  label: string
}

export interface ISelectProps {
  id?: string
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  options?: ISelectOption[]
  items?: ISelectOption[]
  placeholder?: string
  disabled?: boolean
  name?: string
  className?: string
  triggerClassName?: string
  'aria-label'?: string
  children?: ReactNode
}

export const Select: FC<ISelectProps> = ({
  id,
  value,
  defaultValue,
  onValueChange,
  options,
  items,
  placeholder = 'Select an option',
  disabled = false,
  name,
  triggerClassName = '',
  'aria-label': ariaLabel,
  children,
}) => {
  const resolvedOptions = options || items || []
  const labelMap = new Map(resolvedOptions.map((opt) => [opt.value, opt.label]))

  return (
    <BaseSelect.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={(val) => onValueChange?.(String(val))}
      disabled={disabled}
      name={name}
      items={options}
      itemToStringLabel={(item: unknown) => {
        if (typeof item === 'object' && item !== null && 'label' in item) {
          return String((item as { label: unknown }).label)
        }
        return String(item ?? '')
      }}
    >
      <BaseSelect.Trigger
        id={id}
        className={`ui-select__trigger ${triggerClassName}`.trim()}
        aria-label={ariaLabel}
      >
        <BaseSelect.Value placeholder={placeholder}>
          {(val: unknown) => {
            const strVal = String(val ?? '')
            return labelMap.get(strVal) || strVal || placeholder
          }}
        </BaseSelect.Value>
        <ChevronDown
          size={14}
          className="ui-select__chevron"
          aria-hidden="true"
        />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} className="ui-select__positioner">
          <BaseSelect.Popup className="ui-select__popup">
            {children ||
              resolvedOptions.map((opt) => (
                <BaseSelect.Item
                  key={opt.value}
                  value={opt.value}
                  className="ui-select__item"
                >
                  <BaseSelect.ItemText>{opt.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator>
                    <Check size={14} aria-hidden="true" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  )
}

export default Select
