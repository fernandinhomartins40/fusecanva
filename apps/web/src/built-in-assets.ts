import type { MediaAsset } from './model'

export type BuiltInIllustration = MediaAsset & { category: string; tags: string[] }

const drawings = [
  { id: 'spark', name: 'Brilho', category: 'Formas', tags: ['estrela', 'destaque'], svg: '<path d="M256 25c22 119 56 153 231 231-175 22-209 56-231 231C234 312 200 278 25 256 200 234 234 200 256 25Z" fill="#7661ed"/><circle cx="256" cy="256" r="63" fill="#ffcf70"/>' },
  { id: 'sunrise', name: 'Sol nascente', category: 'Natureza', tags: ['sol', 'manhã', 'paisagem'], svg: '<path d="M72 344a184 184 0 0 1 368 0" fill="#ff9b78"/><path d="M60 360h392v35H60z" fill="#594887"/><path d="M95 420h322v28H95z" fill="#80b8a3"/><circle cx="256" cy="248" r="58" fill="#ffcf70"/>' },
  { id: 'leaf', name: 'Folha tropical', category: 'Natureza', tags: ['planta', 'verde', 'botânico'], svg: '<path d="M420 75C177 57 67 171 92 367c18 126 165 123 230 44C389 337 411 212 420 75Z" fill="#75b99c"/><path d="M112 404C216 304 281 216 397 94M194 330l-18-119m81 36 80-78m-127 228-95-15m190-81 85 22" fill="none" stroke="#345c50" stroke-width="17" stroke-linecap="round"/>' },
  { id: 'mountains', name: 'Montanhas', category: 'Natureza', tags: ['paisagem', 'viagem'], svg: '<circle cx="365" cy="142" r="63" fill="#ffcf70"/><path d="m34 397 152-211 88 123 76-105 128 193Z" fill="#7661ed"/><path d="m186 186 43 61-45-14-36 49-29-38Zm164 18 34 47-36-12-31 42-25-35Z" fill="#fff7ea"/><path d="M34 397h444v53H34z" fill="#78b69b"/>' },
  { id: 'coffee', name: 'Café', category: 'Negócios', tags: ['xícara', 'cafeteria', 'comida'], svg: '<path d="M120 177h247v174c0 70-55 126-123 126h-1c-68 0-123-56-123-126Z" fill="#e59a72"/><path d="M368 213h34a63 63 0 0 1 0 126h-35" fill="none" stroke="#59413c" stroke-width="26"/><path d="M96 468h303" stroke="#59413c" stroke-width="25" stroke-linecap="round"/><path d="M184 120c-28-34 18-47 0-81m78 81c-28-34 18-47 0-81" fill="none" stroke="#7661ed" stroke-width="17" stroke-linecap="round"/>' },
  { id: 'megaphone', name: 'Megafone', category: 'Negócios', tags: ['anúncio', 'marketing', 'promoção'], svg: '<path d="m86 210 275-107v301L86 297Z" fill="#7661ed"/><path d="M360 165h57a70 70 0 0 1 0 140h-57Z" fill="#ff9b78"/><path d="m151 310 64 150h83l-66-128" fill="#ffcf70"/><path d="m397 126 59-49m-51 246 54 48" stroke="#345c50" stroke-width="22" stroke-linecap="round"/>' },
  { id: 'gift', name: 'Presente', category: 'Eventos', tags: ['festa', 'aniversário', 'caixa'], svg: '<path d="M87 222h338v245H87z" fill="#ff9b78"/><path d="M62 178h388v76H62z" fill="#7661ed"/><path d="M232 178h65v289h-65z" fill="#ffcf70"/><path d="M256 175c-115 8-147-85-94-103 54-18 86 55 94 103Zm8 0c115 8 147-85 94-103-54-18-86 55-94 103Z" fill="#80b8a3"/>' },
  { id: 'cloud', name: 'Nuvem', category: 'Formas', tags: ['clima', 'leve', 'céu'], svg: '<path d="M135 398a93 93 0 0 1-7-186 133 133 0 0 1 255 35 78 78 0 1 1 7 151Z" fill="#9cc9e8"/><path d="M155 340h202" stroke="#fff7ea" stroke-width="19" stroke-linecap="round"/><circle cx="189" cy="279" r="12" fill="#7661ed"/><circle cx="256" cy="279" r="12" fill="#7661ed"/><circle cx="323" cy="279" r="12" fill="#7661ed"/>' },
  { id: 'chat', name: 'Balão de conversa', category: 'Formas', tags: ['mensagem', 'social', 'diálogo'], svg: '<path d="M85 104h342a55 55 0 0 1 55 55v169a55 55 0 0 1-55 55H227L111 458v-75a55 55 0 0 1-81-55V159a55 55 0 0 1 55-55Z" fill="#80b8a3"/><circle cx="166" cy="244" r="19" fill="#fff7ea"/><circle cx="256" cy="244" r="19" fill="#fff7ea"/><circle cx="346" cy="244" r="19" fill="#fff7ea"/>' },
  { id: 'flower', name: 'Flor', category: 'Natureza', tags: ['botânico', 'primavera'], svg: '<g fill="#ff9b78"><ellipse cx="256" cy="132" rx="70" ry="103"/><ellipse cx="256" cy="388" rx="70" ry="103"/><ellipse cx="128" cy="260" rx="103" ry="70"/><ellipse cx="384" cy="260" rx="103" ry="70"/></g><circle cx="256" cy="260" r="65" fill="#ffcf70"/><path d="M256 324v140m0-53c-66-49-111-42-139-23 35 56 80 75 139 23m0-22c63-48 103-39 135-19-32 52-78 69-135 19" fill="#80b8a3"/>' },
  { id: 'abstract', name: 'Forma orgânica', category: 'Formas', tags: ['abstrato', 'fundo', 'colorido'], svg: '<path d="M94 163c46-82 139-72 201-48s120-8 169 56 5 118-18 181-91 119-178 107-188-7-219-85 0-129 45-211Z" fill="#7661ed"/><circle cx="187" cy="237" r="53" fill="#ffcf70"/><path d="M275 333c45-89 113-105 161-70m-305 87c35-44 72-60 113-45" fill="none" stroke="#fff7ea" stroke-width="22" stroke-linecap="round"/>' },
  { id: 'rocket', name: 'Foguete', category: 'Negócios', tags: ['lançamento', 'inovação', 'espaço'], svg: '<path d="M256 55c97 59 140 172 116 289l-116 97-116-97C116 227 159 114 256 55Z" fill="#ff9b78"/><circle cx="256" cy="218" r="47" fill="#d7eef2"/><path d="m140 304-77 54-14 100 111-54m215-100 77 54 14 100-111-54" fill="#7661ed"/><path d="m224 441 32 54 32-54" fill="#ffcf70"/>' },
]

function svgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

export const BUILT_IN_ILLUSTRATIONS: BuiltInIllustration[] = drawings.map(drawing => ({
  id: `builtin-illustration-${drawing.id}`,
  name: drawing.name,
  category: drawing.category,
  tags: drawing.tags,
  mimeType: 'image/svg+xml',
  width: 512,
  height: 512,
  src: svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${drawing.svg}</svg>`),
  createdAt: '2026-01-01T00:00:00.000Z',
}))

export const BUILT_IN_ILLUSTRATION_CATEGORIES = ['Todas', ...new Set(BUILT_IN_ILLUSTRATIONS.map(asset => asset.category))]
