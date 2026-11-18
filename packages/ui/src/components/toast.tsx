import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Toast as ToastPrimitive } from 'radix-ui'
import { X } from 'lucide-react'
import { cx, type Tone } from '../utils.js'

export interface ToastOptions {
  title: ReactNode
  description?: ReactNode
  tone?: Exclude<Tone, 'accent'>
  /** Tempo em ms ate fechar sozinho. Padrao 5000. */
  duration?: number
  /** Acao opcional; `altText` descreve a alternativa para leitores de tela. */
  action?: { label: ReactNode; altText: string; onSelect: () => void }
}

interface ToastEntry extends ToastOptions {
  id: number
  open: boolean
}

export interface ToastApi {
  show: (options: ToastOptions) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export interface ToastProviderProps {
  children: ReactNode
  /** Rotulo do botao de fechar de cada aviso. */
  closeLabel: string
  /** Rotulo da regiao de avisos (ex.: "Notificacoes {hotkey}"). */
  regionLabel: string
}

let nextToastId = 1

/** Provedor com fila de avisos. Use `useToast().show(...)` em qualquer descendente. */
export function ToastProvider({ children, closeLabel, regionLabel }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.map((t) => (t.id === id ? { ...t, open: false } : t)))
  }, [])

  const show = useCallback((options: ToastOptions) => {
    const id = nextToastId++
    setToasts((list) => [...list, { ...options, id, open: true }])
    return id
  }, [])

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext.Provider value={api}>
      <ToastPrimitive.Provider swipeDirection="right" label={regionLabel}>
        {children}
        {toasts.map((toast) => (
          <ToastPrimitive.Root
            key={toast.id}
            open={toast.open}
            duration={toast.duration ?? 5000}
            type={toast.tone === 'danger' ? 'foreground' : 'background'}
            onOpenChange={(open) => {
              if (!open) {
                dismiss(toast.id)
                setTimeout(() => setToasts((list) => list.filter((t) => t.id !== toast.id)), 300)
              }
            }}
            className={cx('fuse-toast', `fuse-toast--${toast.tone ?? 'neutral'}`)}
          >
            <div className="fuse-toast__content">
              <ToastPrimitive.Title className="fuse-toast__title">{toast.title}</ToastPrimitive.Title>
              {toast.description ? (
                <ToastPrimitive.Description className="fuse-toast__description">{toast.description}</ToastPrimitive.Description>
              ) : null}
            </div>
            {toast.action ? (
              <ToastPrimitive.Action
                altText={toast.action.altText}
                className="fuse-button fuse-button--secondary fuse-button--sm"
                onClick={toast.action.onSelect}
              >
                {toast.action.label}
              </ToastPrimitive.Action>
            ) : null}
            <ToastPrimitive.Close className="fuse-icon-button fuse-button--ghost fuse-icon-button--sm" aria-label={closeLabel}>
              <X size={14} aria-hidden="true" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fuse-toast__viewport" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast precisa estar dentro de <ToastProvider>.')
  return api
}
