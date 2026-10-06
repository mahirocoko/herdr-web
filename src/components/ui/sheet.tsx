import { createContext, useContext } from 'react'
import type { ComponentPropsWithRef, FC, ReactNode } from 'react'
import { Drawer } from '@base-ui/react/drawer'

export type SheetSide = 'bottom' | 'left'

interface ISheetContext {
  side: SheetSide
}

const SheetContext = createContext<ISheetContext>({ side: 'bottom' })

export interface ISheetProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  modal?: boolean | 'trap-focus'
  side?: SheetSide
  children?: ReactNode
}

export const Sheet: FC<ISheetProps> = ({
  open,
  defaultOpen,
  onOpenChange,
  modal = true,
  side = 'bottom',
  children,
}) => {
  const swipeDirection = side === 'left' ? 'left' : 'down'
  return (
    <Drawer.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={(isOpen) => onOpenChange?.(isOpen)}
      modal={modal}
      swipeDirection={swipeDirection}
    >
      <SheetContext.Provider value={{ side }}>
        {children}
      </SheetContext.Provider>
    </Drawer.Root>
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
    <Drawer.Trigger className={className} {...props}>
      {children}
    </Drawer.Trigger>
  )
}

export interface ISheetContentProps extends ComponentPropsWithRef<'div'> {
  side?: SheetSide
  children?: ReactNode
  'aria-label'?: string
  initialFocus?: Drawer.Popup.Props['initialFocus']
  finalFocus?: Drawer.Popup.Props['finalFocus']
  container?: Drawer.Portal.Props['container']
}

export const SheetContent: FC<ISheetContentProps> = ({
  side: propSide,
  className = '',
  children,
  'aria-label': ariaLabel,
  initialFocus,
  finalFocus,
  container,
  ...props
}) => {
  const context = useContext(SheetContext)
  const side = propSide ?? context.side ?? 'bottom'
  const sideClass = side === 'left' ? 'ui-sheet--left' : 'ui-sheet--bottom'
  const combinedClassName = `${sideClass} ${className}`.trim()
  const backdropClass =
    side === 'left'
      ? 'ui-sheet__backdrop side-drawer-overlay'
      : 'ui-sheet__backdrop drawer-overlay'
  const viewportClass =
    side === 'left'
      ? 'ui-sheet__viewport ui-sheet__viewport--left'
      : 'ui-sheet__viewport ui-sheet__viewport--bottom'

  return (
    <Drawer.Portal container={container}>
      <Drawer.Backdrop className={backdropClass} />
      <Drawer.Viewport className={viewportClass}>
        <Drawer.Popup
          className={combinedClassName}
          aria-label={ariaLabel}
          initialFocus={initialFocus}
          finalFocus={finalFocus}
          {...props}
        >
          {side === 'bottom' && (
            <div className="drawer-sheet__handle" aria-hidden="true" />
          )}
          <Drawer.Content className="ui-sheet__content">
            {children}
          </Drawer.Content>
        </Drawer.Popup>
      </Drawer.Viewport>
    </Drawer.Portal>
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
    <Drawer.Title className={`ui-sheet__title ${className}`.trim()} {...props}>
      {children}
    </Drawer.Title>
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
    <Drawer.Description
      className={`ui-sheet__description ${className}`.trim()}
      {...props}
    >
      {children}
    </Drawer.Description>
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
    <Drawer.Close className={className} {...props}>
      {children}
    </Drawer.Close>
  )
}

export default Sheet
