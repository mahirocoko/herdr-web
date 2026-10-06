import type { ComponentPropsWithRef, FC, ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'

export type SheetSide = 'bottom' | 'left'

export interface ISheetProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  modal?: boolean | 'trap-focus'
  children?: ReactNode
}

export const Sheet: FC<ISheetProps> = ({
  open,
  defaultOpen,
  onOpenChange,
  modal = true,
  children,
}) => {
  return (
    <Dialog.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(isOpen) => onOpenChange?.(isOpen)}
      modal={modal}
    >
      {children}
    </Dialog.Root>
  )
}

export interface ISheetTriggerProps extends ComponentPropsWithRef<'button'> {
  children?: ReactNode
}

export const SheetTrigger: FC<ISheetTriggerProps> = ({
  children,
  className = '',
  ...props
}) => {
  return (
    <Dialog.Trigger className={className} {...props}>
      {children}
    </Dialog.Trigger>
  )
}

export interface ISheetContentProps extends ComponentPropsWithRef<'div'> {
  side?: SheetSide
  children?: ReactNode
  'aria-label'?: string
  initialFocus?: Dialog.Popup.Props['initialFocus']
  finalFocus?: Dialog.Popup.Props['finalFocus']
  container?: Dialog.Portal.Props['container']
}

export const SheetContent: FC<ISheetContentProps> = ({
  side = 'bottom',
  className = '',
  children,
  'aria-label': ariaLabel,
  initialFocus,
  finalFocus,
  container,
  ...props
}) => {
  const sideClass = side === 'left' ? 'ui-sheet--left' : 'ui-sheet--bottom'
  const combinedClassName = `${sideClass} ${className}`.trim()
  const backdropClass =
    side === 'left'
      ? 'ui-sheet__backdrop side-drawer-overlay'
      : 'ui-sheet__backdrop drawer-overlay'

  return (
    <Dialog.Portal container={container}>
      <Dialog.Backdrop className={backdropClass} />
      <Dialog.Popup
        className={combinedClassName}
        aria-label={ariaLabel}
        initialFocus={initialFocus}
        finalFocus={finalFocus}
        {...props}
      >
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  )
}

export interface ISheetHeaderProps extends ComponentPropsWithRef<'div'> {
  children?: ReactNode
}

export const SheetHeader: FC<ISheetHeaderProps> = ({
  className = '',
  children,
  ...props
}) => {
  return (
    <div className={`ui-sheet__header ${className}`.trim()} {...props}>
      {children}
    </div>
  )
}

export interface ISheetTitleProps extends ComponentPropsWithRef<'h2'> {
  children?: ReactNode
}

export const SheetTitle: FC<ISheetTitleProps> = ({
  className = '',
  children,
  ...props
}) => {
  return (
    <Dialog.Title className={`ui-sheet__title ${className}`.trim()} {...props}>
      {children}
    </Dialog.Title>
  )
}

export interface ISheetDescriptionProps extends ComponentPropsWithRef<'p'> {
  children?: ReactNode
}

export const SheetDescription: FC<ISheetDescriptionProps> = ({
  className = '',
  children,
  ...props
}) => {
  return (
    <Dialog.Description
      className={`ui-sheet__description ${className}`.trim()}
      {...props}
    >
      {children}
    </Dialog.Description>
  )
}

export interface ISheetCloseProps extends ComponentPropsWithRef<'button'> {
  children?: ReactNode
}

export const SheetClose: FC<ISheetCloseProps> = ({
  className = '',
  children,
  ...props
}) => {
  return (
    <Dialog.Close className={className} {...props}>
      {children}
    </Dialog.Close>
  )
}

export default Sheet
