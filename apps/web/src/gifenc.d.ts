declare module 'gifenc' {
  export type GifColor = number[]
  export type GifPalette = GifColor[]
  export type GifFormat = 'rgb565' | 'rgb444' | 'rgba4444'

  export interface GifEncoder {
    writeFrame(indexes: Uint8Array, width: number, height: number, options?: {
      palette?: GifPalette
      transparent?: boolean
      transparentIndex?: number
      delay?: number
      repeat?: number
      dispose?: number
    }): void
    finish(): void
    bytes(): Uint8Array
  }

  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): GifEncoder
  export function quantize(data: Uint8Array | Uint8ClampedArray, maxColors: number, options?: {
    format?: GifFormat
    oneBitAlpha?: boolean | number
    clearAlpha?: boolean
    clearAlphaThreshold?: number
    clearAlphaColor?: number
  }): GifPalette
  export function applyPalette(data: Uint8Array | Uint8ClampedArray, palette: GifPalette, format?: GifFormat): Uint8Array
}
