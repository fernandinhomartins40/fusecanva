import type { ComponentProps } from 'react'
import { Tabs as TabsPrimitive, Toolbar as ToolbarPrimitive } from 'radix-ui'
import { cx } from '../utils.js'

/* ------------------------------------------------------------------ Tabs */

export function Tabs({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root className={cx('fuse-tabs', className)} {...rest} />
}

export function TabsList({ className, ...rest }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cx('fuse-tabs__list', className)} {...rest} />
}

export function TabsTrigger({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger className={cx('fuse-tabs__trigger', className)} {...rest} />
}

export function TabsContent({ className, ...rest }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cx('fuse-tabs__content', className)} {...rest} />
}

/* --------------------------------------------------------------- Toolbar */

export interface ToolbarProps extends Omit<ComponentProps<typeof ToolbarPrimitive.Root>, 'aria-label'> {
  /** Nome acessivel obrigatorio da barra. */
  label: string
}

export function Toolbar({ label, className, orientation = 'horizontal', ...rest }: ToolbarProps) {
  return (
    <ToolbarPrimitive.Root
      aria-label={label}
      orientation={orientation}
      className={cx('fuse-toolbar', `fuse-toolbar--${orientation}`, className)}
      {...rest}
    />
  )
}

export interface ToolbarButtonProps extends Omit<ComponentProps<typeof ToolbarPrimitive.Button>, 'aria-label'> {
  /** Nome acessivel; obrigatorio quando o botao so tem icone. */
  label?: string
}

export function ToolbarButton({ label, className, ...rest }: ToolbarButtonProps) {
  return (
    <ToolbarPrimitive.Button
      aria-label={label}
      className={cx('fuse-icon-button', 'fuse-button--ghost', 'fuse-icon-button--md', 'fuse-toolbar__button', className)}
      {...rest}
    />
  )
}

export function ToolbarToggleGroup({ className, ...rest }: ComponentProps<typeof ToolbarPrimitive.ToggleGroup>) {
  return <ToolbarPrimitive.ToggleGroup className={cx('fuse-toolbar__group', className)} {...rest} />
}

export interface ToolbarToggleItemProps extends Omit<ComponentProps<typeof ToolbarPrimitive.ToggleItem>, 'aria-label'> {
  label: string
}

export function ToolbarToggleItem({ label, className, ...rest }: ToolbarToggleItemProps) {
  return (
    <ToolbarPrimitive.ToggleItem
      aria-label={label}
      className={cx('fuse-icon-button', 'fuse-button--ghost', 'fuse-icon-button--md', 'fuse-toolbar__toggle', className)}
      {...rest}
    />
  )
}

export function ToolbarSeparator({ className, ...rest }: ComponentProps<typeof ToolbarPrimitive.Separator>) {
  return <ToolbarPrimitive.Separator className={cx('fuse-toolbar__separator', className)} {...rest} />
}
