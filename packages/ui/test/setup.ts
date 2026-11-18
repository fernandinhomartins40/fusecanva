import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})

// APIs de layout ausentes no jsdom e usadas pelos primitives Radix.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
const g = globalThis as Record<string, unknown>
g.ResizeObserver ??= ResizeObserverStub
if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as Record<string, unknown>
  proto.hasPointerCapture ??= () => false
  proto.setPointerCapture ??= () => {}
  proto.releasePointerCapture ??= () => {}
  proto.scrollIntoView ??= () => {}
}
g.IS_REACT_ACT_ENVIRONMENT = true
