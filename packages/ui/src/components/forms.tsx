import { createContext, useContext, useId, type ComponentProps, type ReactNode } from 'react'
import {
  Checkbox as CheckboxPrimitive,
  Label,
  RadioGroup as RadioGroupPrimitive,
  Select as SelectPrimitive,
  Slider as SliderPrimitive,
  Switch as SwitchPrimitive,
} from 'radix-ui'
import { Check, ChevronDown, Minus } from 'lucide-react'
import { cx, type Size } from '../utils.js'

/* ----------------------------------------------------------------- Field */

interface FieldContextValue {
  controlId: string
  descriptionId: string | undefined
  errorId: string | undefined
  invalid: boolean
  required: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

export interface FieldProps {
  label: ReactNode
  description?: ReactNode
  /** Mensagem de erro; quando presente marca o controle como invalido. */
  error?: ReactNode
  required?: boolean
  className?: string
  children: ReactNode
}

/** Associa rotulo, descricao e erro ao controle filho (Input, Textarea, Select). */
export function Field({ label, description, error, required = false, className, children }: FieldProps) {
  const baseId = useId()
  const controlId = `${baseId}-control`
  const descriptionId = description ? `${baseId}-description` : undefined
  const errorId = error ? `${baseId}-error` : undefined
  return (
    <FieldContext.Provider value={{ controlId, descriptionId, errorId, invalid: Boolean(error), required }}>
      <div className={cx('fuse-field', className)}>
        <Label.Root className="fuse-field__label" htmlFor={controlId}>
          {label}
          {required ? (
            <span className="fuse-field__required" aria-hidden="true">
              *
            </span>
          ) : null}
        </Label.Root>
        {children}
        {description ? (
          <p id={descriptionId} className="fuse-field__description">
            {description}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="fuse-field__error">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  )
}

function useFieldControl(props: { id?: string | undefined; invalid?: boolean | undefined; required?: boolean | undefined }) {
  const field = useContext(FieldContext)
  const describedBy = [field?.descriptionId, field?.errorId].filter(Boolean).join(' ')
  const invalid = props.invalid ?? field?.invalid ?? false
  return {
    id: props.id ?? field?.controlId,
    'aria-describedby': describedBy || undefined,
    'aria-invalid': invalid || undefined,
    required: props.required ?? field?.required,
    invalid,
  }
}

/* ----------------------------------------------------------------- Input */

export interface InputProps extends Omit<ComponentProps<'input'>, 'size'> {
  size?: Size
  invalid?: boolean
}

export function Input({ size = 'md', invalid, className, id, required, ...rest }: InputProps) {
  const { invalid: isInvalid, ...a11y } = useFieldControl({ id, invalid, required })
  return (
    <input
      className={cx('fuse-input', `fuse-input--${size}`, isInvalid && 'is-invalid', className)}
      {...a11y}
      {...rest}
    />
  )
}

/* -------------------------------------------------------------- Textarea */

export interface TextareaProps extends ComponentProps<'textarea'> {
  invalid?: boolean
  resize?: 'none' | 'vertical' | 'both'
}

export function Textarea({ invalid, resize = 'vertical', className, id, required, ...rest }: TextareaProps) {
  const { invalid: isInvalid, ...a11y } = useFieldControl({ id, invalid, required })
  return (
    <textarea
      className={cx('fuse-input', 'fuse-textarea', `fuse-textarea--resize-${resize}`, isInvalid && 'is-invalid', className)}
      {...a11y}
      {...rest}
    />
  )
}

/* ---------------------------------------------------------------- Select */

export interface SelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

export interface SelectProps extends Omit<ComponentProps<typeof SelectPrimitive.Root>, 'children'> {
  options: readonly SelectOption[]
  placeholder?: ReactNode
  size?: Size
  invalid?: boolean
  id?: string
  className?: string
  /** Nome acessivel quando nao ha `Field` envolvendo o controle. */
  'aria-label'?: string
}

export function Select({
  options,
  placeholder,
  size = 'md',
  invalid,
  id,
  className,
  'aria-label': ariaLabel,
  required,
  ...rootProps
}: SelectProps) {
  const { invalid: isInvalid, required: isRequired, ...a11y } = useFieldControl({ id, invalid, required })
  return (
    <SelectPrimitive.Root required={isRequired ?? false} {...rootProps}>
      <SelectPrimitive.Trigger
        className={cx('fuse-input', 'fuse-select__trigger', `fuse-input--${size}`, isInvalid && 'is-invalid', className)}
        aria-label={ariaLabel}
        {...a11y}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="fuse-select__icon">
          <ChevronDown size={16} aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="fuse-select__content fuse-floating" position="popper" sideOffset={4}>
          <SelectPrimitive.Viewport className="fuse-select__viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled ?? false}
                className="fuse-menu__item fuse-select__item"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="fuse-menu__indicator">
                  <Check size={14} aria-hidden="true" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

/* -------------------------------------------------------------- Checkbox */

export interface CheckboxProps extends Omit<ComponentProps<typeof CheckboxPrimitive.Root>, 'children'> {
  /** Rotulo visivel. Sem ele, informe `aria-label`. */
  label?: ReactNode
}

export function Checkbox({ label, className, id, ...rest }: CheckboxProps) {
  const autoId = useId()
  const controlId = id ?? autoId
  return (
    <span className={cx('fuse-choice', className)}>
      <CheckboxPrimitive.Root id={controlId} className="fuse-checkbox" {...rest}>
        <CheckboxPrimitive.Indicator className="fuse-checkbox__indicator">
          {rest.checked === 'indeterminate' ? (
            <Minus size={12} strokeWidth={3} aria-hidden="true" />
          ) : (
            <Check size={12} strokeWidth={3} aria-hidden="true" />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label ? (
        <Label.Root htmlFor={controlId} className="fuse-choice__label">
          {label}
        </Label.Root>
      ) : null}
    </span>
  )
}

/* ---------------------------------------------------------------- Switch */

export interface SwitchProps extends Omit<ComponentProps<typeof SwitchPrimitive.Root>, 'children'> {
  label?: ReactNode
}

export function Switch({ label, className, id, ...rest }: SwitchProps) {
  const autoId = useId()
  const controlId = id ?? autoId
  return (
    <span className={cx('fuse-choice', className)}>
      <SwitchPrimitive.Root id={controlId} className="fuse-switch" {...rest}>
        <SwitchPrimitive.Thumb className="fuse-switch__thumb" />
      </SwitchPrimitive.Root>
      {label ? (
        <Label.Root htmlFor={controlId} className="fuse-choice__label">
          {label}
        </Label.Root>
      ) : null}
    </span>
  )
}

/* ----------------------------------------------------------------- Radio */

export interface RadioGroupProps extends ComponentProps<typeof RadioGroupPrimitive.Root> {}

export function RadioGroup({ className, orientation = 'vertical', ...rest }: RadioGroupProps) {
  return (
    <RadioGroupPrimitive.Root
      orientation={orientation}
      className={cx('fuse-radio-group', `fuse-radio-group--${orientation}`, className)}
      {...rest}
    />
  )
}

export interface RadioProps extends Omit<ComponentProps<typeof RadioGroupPrimitive.Item>, 'children'> {
  label: ReactNode
}

export function Radio({ label, className, id, ...rest }: RadioProps) {
  const autoId = useId()
  const controlId = id ?? autoId
  return (
    <span className={cx('fuse-choice', className)}>
      <RadioGroupPrimitive.Item id={controlId} className="fuse-radio" {...rest}>
        <RadioGroupPrimitive.Indicator className="fuse-radio__indicator" />
      </RadioGroupPrimitive.Item>
      <Label.Root htmlFor={controlId} className="fuse-choice__label">
        {label}
      </Label.Root>
    </span>
  )
}

/* ---------------------------------------------------------------- Slider */

export interface SliderProps extends ComponentProps<typeof SliderPrimitive.Root> {
  /** Nome acessivel de cada polegar (um por valor). */
  thumbLabels: readonly string[]
}

export function Slider({ thumbLabels, className, ...rest }: SliderProps) {
  const count = Math.max(rest.value?.length ?? rest.defaultValue?.length ?? 1, 1)
  return (
    <SliderPrimitive.Root className={cx('fuse-slider', className)} {...rest}>
      <SliderPrimitive.Track className="fuse-slider__track">
        <SliderPrimitive.Range className="fuse-slider__range" />
      </SliderPrimitive.Track>
      {Array.from({ length: count }, (_, index) => (
        <SliderPrimitive.Thumb
          key={index}
          className="fuse-slider__thumb"
          aria-label={thumbLabels[index] ?? thumbLabels[0]}
        />
      ))}
    </SliderPrimitive.Root>
  )
}
