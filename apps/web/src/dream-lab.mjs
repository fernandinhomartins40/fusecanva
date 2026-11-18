export function validateDreamLabImage(image) {
  if (!image || typeof image.dataUrl !== 'string' || !/^data:image\/(svg\+xml|png|jpeg|webp);base64,/i.test(image.dataUrl)) throw new Error('Formato da imagem gerada inválido.')
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 12000 || image.height > 12000 || image.width * image.height > 16_000_000) throw new Error('A resolução da imagem excede os limites do Dream Lab.')
  if (!['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) throw new Error('O formato da imagem não é compatível com o Dream Lab.')
  if (image.mode !== 'sandbox' && image.mode !== 'openai-compatible') throw new Error('O modo de geração é inválido.')
  return image
}

export function upscaleDimensions(width, height, factor = 2) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('Dimensões de origem inválidas.')
  if (factor !== 2) throw new Error('O Dream Lab permite ampliação local de até 2×.')
  const scale = Math.min(factor, Math.sqrt(16_000_000 / (width * height)), 12000 / width, 12000 / height)
  if (scale <= 1) throw new Error('A imagem já atingiu o limite de resolução para ampliação.')
  return { width: Math.max(width, Math.floor(width * scale)), height: Math.max(height, Math.floor(height * scale)), scale }
}

export async function upscaleDreamLabImage(image) {
  validateDreamLabImage(image)
  const size = upscaleDimensions(image.width, image.height)
  // Image.decode handles renderable SVG data URLs in Chromium builds where createImageBitmap rejects them.
  const source = new Image()
  source.src = image.dataUrl
  try { await source.decode() }
  catch { throw new Error('O navegador não conseguiu decodificar a imagem de origem.') }
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('O navegador não disponibilizou o canvas para ampliação.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, size.width, size.height)
  const mimeType = image.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png'
  return { dataUrl: canvas.toDataURL(mimeType), mimeType, width: size.width, height: size.height, mode: image.mode }
}

export function downloadDreamLabImage(image, filename) {
  validateDreamLabImage(image)
  const extension = image.mimeType === 'image/svg+xml' ? 'svg' : image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType === 'image/webp' ? 'webp' : 'png'
  const safeFilename = filename || `dream-lab.${extension}`
  const link = document.createElement('a')
  link.href = image.dataUrl
  link.download = safeFilename.replace(/[\\/:*?"<>|]/g, '-').slice(0, 120) || `dream-lab.${extension}`
  link.click()
}
