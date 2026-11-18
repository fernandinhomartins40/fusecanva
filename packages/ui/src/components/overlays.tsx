import type { ComponentProps, ReactNode } from 'react'
import { Dialog as DialogPrimitive, DropdownMenu, Popover as PopoverPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui'
import { Check, ChevronRight, X } from 'lucide-react'
import { cx } from '../utils.js'

/* ---------------------------------------------------------------- Dialog */

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export interface DialogContentProps extends Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> {
  title: ReactNode
  description?: ReactNode
  /** Rotulo do botao de fechar (texto vem do i18n do app). */
  closeLabel: string
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

export function DialogContent({
  title,
  description,
  closeLabel,
  footer,
  size = 'md',
  className,
  children,
  ...rest
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fuse-dialog__overlay" />
      <DialogPrimitive.Content
        className={cx('fuse-dialog', `fuse-dialog--${size}`, className)}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...rest}
      >
        <header className="fuse-dialog__header">
          <DialogPrimitive.Title className="fuse-dialog__title">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close className="fuse-icon-button fuse-button--ghost fuse-icon-button--sm" aria-label={closeLabel}>
            <X size={16} aria-hidden="true" />
          </DialogPrimitive.Close>
        </header>
        {description ? (
          <DialogPrimitive.Description className="fuse-dialog__description">{description}</DialogPrimitive.Description>
        ) : null}
        <div className="fuse-dialog__body">{children}</div>
        {footer ? <footer className="fuse-dialog__footer">{footer}</footer> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

/* --------------------------------------------------------------- Popover */

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverClose = PopoverPrimitive.Close
export const PopoverAnchor = PopoverPrimitive.Anchor

export function PopoverContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  ...rest
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        className={cx('fuse-popover', 'fuse-floating', className)}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...rest}
      />
    </PopoverPrimitive.Portal>
  )
}

/* --------------------------------------------------------------- Tooltip */

export function TooltipProvider({
  delayDuration = 400,
  ...rest
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...rest} />
}

export interface TooltipProps {
  content: ReactNode
  /** Elemento focavel que dispara a dica. */
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Atalho de teclado exibido ao lado do texto. */
  shortcut?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export function Tooltip({ content, children, side = 'top', shortcut, ...rootProps }: TooltipProps) {
  return (
    <TooltipPrimitive.Root {...rootProps}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="fuse-tooltip" side={side} sideOffset={6} collisionPadding={8}>
          {content}
          {shortcut ? <kbd className="fuse-tooltip__shortcut">{shortcut}</kbd> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

/* ------------------------------------------------------------------ Menu */

export const Menu = DropdownMenu.Root
export const MenuTrigger = DropdownMenu.Trigger
export const MenuGroup = DropdownMenu.Group
export const MenuRadioGroup = DropdownMenu.RadioGroup
export const MenuSub = DropdownMenu.Sub

export function MenuContent({
  className,
  sideOffset = 4,
  collisionPadding = 8,
  ...rest
}: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        className={cx('fuse-menu', 'fuse-floating', className)}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        {...rest}
      />
    </DropdownMenu.Portal>
  )
}

export interface MenuItemProps extends ComponentProps<typeof DropdownMenu.Item> {
  icon?: ReactNode
  shortcut?: string
  tone?: 'default' | 'danger'
}

export function MenuItem({ icon, shortcut, tone = 'default', className, children, ...rest }: MenuItemProps) {
  return (
    <DropdownMenu.Item className={cx('fuse-menu__item', tone === 'danger' && 'fuse-menu__item--danger', className)} {...rest}>
      {icon ? (
        <span className="fuse-menu__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="fuse-menu__text">{children}</span>
      {shortcut ? <kbd className="fuse-menu__shortcut">{shortcut}</kbd> : null}
    </DropdownMenu.Item>
  )
}

export function MenuCheckboxItem({ className, children, ...rest }: ComponentProps<typeof DropdownMenu.CheckboxItem>) {
  return (
    <DropdownMenu.CheckboxItem className={cx('fuse-menu__item', 'fuse-menu__item--inset', className)} {...rest}>
      <DropdownMenu.ItemIndicator className="fuse-menu__indicator">
        <Check size={14} aria-hidden="true" />
      </DropdownMenu.ItemIndicator>
      <span className="fuse-menu__text">{children}</span>
    </DropdownMenu.CheckboxItem>
  )
}

export function MenuRadioItem({ className, children, ...rest }: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem className={cx('fuse-menu__item', 'fuse-menu__item--inset', className)} {...rest}>
      <DropdownMenu.ItemIndicator className="fuse-menu__indicator">
        <span className="fuse-menu__dot" />
      </DropdownMenu.ItemIndicator>
      <span className="fuse-menu__text">{children}</span>
    </DropdownMenu.RadioItem>
  )
}

export function MenuSubTrigger({ className, children, ...rest }: ComponentProps<typeof DropdownMenu.SubTrigger>) {
  return (
    <DropdownMenu.SubTrigger className={cx('fuse-menu__item', className)} {...rest}>
      <span className="fuse-menu__text">{children}</span>
      <ChevronRight size={14} aria-hidden="true" className="fuse-menu__chevron" />
    </DropdownMenu.SubTrigger>
  )
}

export function MenuSubContent({ className, ...rest }: ComponentProps<typeof DropdownMenu.SubContent>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.SubContent className={cx('fuse-menu', 'fuse-floating', className)} {...rest} />
    </DropdownMenu.Portal>
  )
}

export function MenuLabel({ className, ...rest }: ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label className={cx('fuse-menu__label', className)} {...rest} />
}

export function MenuSeparator({ className, ...rest }: ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className={cx('fuse-menu__separator', className)} {...rest} />
}
