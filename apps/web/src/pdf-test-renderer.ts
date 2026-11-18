import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'

export async function renderPdfToPngPages(data: Uint8Array): Promise<string[]> {
  GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.mjs'
  const document = await getDocument({ data }).promise
  const images: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const canvas = globalThis.document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('PDF.js could not create a 2D canvas context.')
      await page.render({ canvas, canvasContext: context, viewport }).promise
      images.push(canvas.toDataURL('image/png'))
      page.cleanup()
    }
  } finally {
    await document.cleanup()
  }
  return images
}
