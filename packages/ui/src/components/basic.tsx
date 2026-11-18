import { useId, type ComponentProps, type ReactNode } from 'react'
import { Avatar as AvatarPrimitive, Separator, Slot, VisuallyHidden as VisuallyHiddenPrimitive } from 'radix-ui'
import { cx, type Size, type Tone } from '../utils.js'

/* ---------------------------------------------------------------- Button */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: Size
  /** Mostra um indicador de progresso e bloqueia a interacao. Exige `loadingLabel` para leitores de tela. */
  loading?: boolean
  loadingLabel?: string
  iconStart?: ReactNode
  iconEnd?: ReactNode
  /** Renderiza o filho (ex.: `<a>`) com o estilo de botao. */
  asChild?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  loadingLabel,
  iconStart,
  iconEnd,
  asChild = false,
  className,
  children,
  disabled,
  type,
  ...rest
}: ButtonProps) {
  const classes = cx('fuse-button', `fuse-button--${variant}`, `fuse-button--${size}`, loading && 'is-loading', className)
  if (asChild) {
    return (
      <Slot.Root className={classes} {...rest}>
        {children}
      </Slot.Root>
    )
  }
  return (
    <button
      type={type ?? 'button'}
      className={classes}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <SpinnerGlyph /> : iconStart}
      <span className="fuse-button__label">{children}</span>
      {loading && loadingLabel ? <VisuallyHidden>{loadingLabel}</VisuallyHidden> : null}
      {iconEnd}
    </button>
  )
}

/* ------------------------------------------------------------ IconButton */

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'aria-label'> {
  /** Nome acessivel obrigatorio: botoes so com icone nao tem texto visivel. */
  label: string
  variant?: ButtonVariant
  size?: Size
  /** Estado de alternancia (botao de ligar/desligar). */
  pressed?: boolean
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  pressed,
  className,
  children,
  type,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      aria-label={label}
      aria-pressed={pressed}
      className={cx('fuse-icon-button', `fuse-button--${variant}`, `fuse-icon-button--${size}`, className)}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ----------------------------------------------------------------- Badge */

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: Tone
  variant?: 'subtle' | 'solid'
}

export function Badge({ tone = 'neutral', variant = 'subtle', className, ...rest }: BadgeProps) {
  return <span className={cx('fuse-badge', `fuse-badge--${tone}`, `fuse-badge--${variant}`, className)} {...rest} />
}

/* ------------------------------------------------------------------ Card */

export interface CardProps extends ComponentProps<'div'> {
  elevation?: 'flat' | 'raised'
  /** Torna o cartao interativo (hover/foco). Use com `asChild` em links ou botoes. */
  interactive?: boolean
  asChild?: boolean
}

export function Card({ elevation = 'flat', interactive = false, asChild = false, className, ...rest }: CardProps) {
  const Comp = asChild ? Slot.Root : 'div'
  return (
    <Comp
      className={cx('fuse-card', `fuse-card--${elevation}`, interactive && 'fuse-card--interactive', className)}
      {...rest}
    />
  )
}

/* --------------------------------------------------------------- Divider */

export interface DividerProps extends ComponentProps<typeof Separator.Root> {}

export function Divider({ className, orientation = 'horizontal', decorative = true, ...rest }: DividerProps) {
  return (
    <Separator.Root
      orientation={orientation}
      decorative={decorative}
      className={cx('fuse-divider', `fuse-divider--${orientation}`, className)}
      {...rest}
    />
  )
}

/* -------------------------------------------------------- VisuallyHidden */

export function VisuallyHidden(props: ComponentProps<typeof VisuallyHiddenPrimitive.Root>) {
  return <VisuallyHiddenPrimitive.Root {...props} />
}

/* --------------------------------------------------------------- Spinner */

function SpinnerGlyph({ className }: { className?: string }) {
  return (
    <svg className={cx('fuse-spinner__glyph', className)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" strokeWidth="3" className="fuse-spinner__track" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" strokeWidth="3" strokeLinecap="round" className="fuse-spinner__arc" />
    </svg>
  )
}

export interface SpinnerProps extends Omit<ComponentProps<'span'>, 'children'> {
  /** Texto anunciado por leitores de tela, ex.: "Carregando". */
  label: string
  size?: Size
}

export function Spinner({ label, size = 'md', className, ...rest }: SpinnerProps) {
  return (
    <span role="status" className={cx('fuse-spinner', `fuse-spinner--${size}`, className)} {...rest}>
      <SpinnerGlyph />
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  )
}

/* -------------------------------------------------------------- Skeleton */

export interface SkeletonProps extends Omit<ComponentProps<'span'>, 'children'> {
  width?: string | number
  height?: string | number
  shape?: 'rect' | 'text' | 'circle'
}

export function Skeleton({ width, height, shape = 'rect', className, style, ...rest }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx('fuse-skeleton', `fuse-skeleton--${shape}`, className)}
      style={{ width, height, ...style }}
      {...rest}
    />
  )
}

/* ------------------------------------------------------------ EmptyState */

export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  /** Nivel do titulo para manter a hierarquia da pagina. */
  headingLevel?: 2 | 3 | 4
}

export function EmptyState({ icon, title, description, action, headingLevel = 3, className, ...rest }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <div className={cx('fuse-empty-state', className)} {...rest}>
      {icon ? (
        <div className="fuse-empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <Heading className="fuse-empty-state__title">{title}</Heading>
      {description ? <p className="fuse-empty-state__description">{description}</p> : null}
      {action ? <div className="fuse-empty-state__action">{action}</div> : null}
    </div>
  )
}

/* ----------------------------------------------------------------- Panel */

export interface PanelProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: ReactNode
  /** Acoes no cabecalho (ex.: IconButton de fechar). */
  actions?: ReactNode
  headingLevel?: 2 | 3 | 4
}

export function Panel({ title, actions, headingLevel = 2, className, children, id, ...rest }: PanelProps) {
  const Heading = `h${headingLevel}` as const
  const autoId = useId()
  const headingId = `${id ?? autoId}-title`
  return (
    <section id={id} aria-labelledby={headingId} className={cx('fuse-panel', className)} {...rest}>
      <header className="fuse-panel__header">
        <Heading id={headingId} className="fuse-panel__title">
          {title}
        </Heading>
        {actions ? <div className="fuse-panel__actions">{actions}</div> : null}
      </header>
      <div className="fuse-panel__body">{children}</div>
    </section>
  )
}

/* ---------------------------------------------------------------- Avatar */

export interface AvatarProps extends Omit<ComponentProps<typeof AvatarPrimitive.Root>, 'children'> {
  /** Nome da pessoa; gera as iniciais de fallback e o texto alternativo. */
  name: string
  src?: string
  size?: Size
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0]?.[0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

export function Avatar({ name, src, size = 'md', className, ...rest }: AvatarProps) {
  return (
    <AvatarPrimitive.Root className={cx('fuse-avatar', `fuse-avatar--${size}`, className)} {...rest}>
      {src ? <AvatarPrimitive.Image className="fuse-avatar__image" src={src} alt={name} /> : null}
      <AvatarPrimitive.Fallback className="fuse-avatar__fallback" delayMs={src ? 400 : 0}>
        <span aria-hidden="true">{initialsOf(name)}</span>
        <VisuallyHidden>{name}</VisuallyHidden>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}
