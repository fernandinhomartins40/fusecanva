const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
const SVG_ATTRIBUTES = new Set([
  'xmlns', 'width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'fill-rule', 'clip-rule', 'fill-opacity', 'stroke-opacity', 'opacity', 'd', 'points', 'x', 'y', 'x1', 'y1',
  'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'transform',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'shape-rendering', 'vector-effect',
])

const MAX_SVG_MARKUP_BYTES = 10 * 1024 * 1024

function parseDimension(value: string | undefined): number | null {
  if (!value) return null
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/i)
  if (!match) return null
  const dimension = Number(match[1])
  return Number.isFinite(dimension) && dimension > 0 ? dimension : null
}

function validateViewBox(value: string | undefined): [number, number] | null {
  if (!value) return null
  const values = value.trim().split(/[\s,]+/).map(Number)
  if (values.length !== 4 || values.some(number => !Number.isFinite(number)) || values[2] <= 0 || values[3] <= 0) return null
  return [values[2], values[3]]
}

// Accept common SVG transform-list syntax while rejecting malformed or huge values.
// Supported functions: matrix, translate, scale, rotate, skewX and skewY.
function isSafeTransform(value: string): boolean {
  if (value.length > 2048) return false
  const functionPattern = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)\s*/gy
  const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
  const validCounts: Record<string, number[]> = { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] }
  let cursor = 0
  let count = 0
  while (cursor < value.length) {
    functionPattern.lastIndex = cursor
    const match = functionPattern.exec(value)
    if (!match) return false
    const args = match[2].trim().split(/[\s,]+/)
    if (args.some(argument => !numberPattern.test(argument) || !Number.isFinite(Number(argument))) || !validCounts[match[1]].includes(args.length)) return false
    cursor = functionPattern.lastIndex
    if (value[cursor] === ',') {
      cursor += 1
      if (cursor === value.length) return false
    }
    if (++count > 64) return false
  }
  return count > 0
}

/**
 * Keeps a deliberately small, script-free SVG subset that browsers can safely render as an image:
 * svg/g plus path, rect, circle, ellipse, line, polyline and polygon; common fill/stroke attributes;
 * and matrix/translate/scale/rotate/skew transforms. Gradients, embedded images, CSS, text and filters
 * fail closed so this module never pulls active or external SVG features into the design.
 */
export function sanitizeImportedSvg(source: string): { dataUrl: string; width: number; height: number } {
  if (new TextEncoder().encode(source).byteLength > MAX_SVG_MARKUP_BYTES) throw new Error('O SVG excede o limite de 10 MB.')
  let markup = source.trim().replace(/^<\?xml\s+[^?]*\?>\s*/i, '').replace(/<!--[\s\S]*?-->/g, '')
  if (!markup || /<!|<\s*\/?\s*(?:script|style|foreignObject|image|use|defs|filter|mask|pattern|animate|set|iframe|object|embed)\b/i.test(markup)) {
    throw new Error('Este SVG contém recursos ativos ou elementos ainda não suportados.')
  }

  const tagPattern = /<\/?[A-Za-z][^<>]*>/g
  const tags = markup.match(tagPattern)
  if (!tags || tags.join('') !== markup.replace(/[^<>]*/g, '')) {
    // The structural checks below produce a clear error for malformed markup or embedded XML.
    if (!tags) throw new Error('O arquivo não contém um SVG válido.')
  }
  const stack: string[] = []
  let rootAttributes: Record<string, string> | null = null
  let cursor = 0
  let sanitized = ''
  for (const match of markup.matchAll(tagPattern)) {
    const index = match.index ?? 0
    const text = markup.slice(cursor, index)
    if (text.includes('<') || text.includes('>') || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(text)) throw new Error('O SVG contém texto ou entidades XML inválidas.')
    sanitized += text
    const token = match[0]
    const closing = /^<\//.test(token)
    const selfClosing = /\/>$/.test(token)
    const nameMatch = token.match(/^<\/?([A-Za-z][\w.-]*)/)
    const tag = nameMatch?.[1]
    if (!tag || !SVG_TAGS.has(tag)) throw new Error('Este SVG usa elementos que ainda não são suportados.')
    if (closing) {
      if (token.replace(/^<\/[\w.-]+\s*/, '').replace(/>$/, '').trim() || stack.pop() !== tag) throw new Error('A estrutura do SVG está inválida.')
      sanitized += `</${tag}>`
    } else {
      const attrSource = token.slice((nameMatch?.[0].length ?? 0), token.length - (selfClosing ? 2 : 1))
      const attrs: Record<string, string> = {}
      const attrPattern = /\s+([A-Za-z][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gy
      let attrCursor = 0
      while (attrCursor < attrSource.length) {
        attrPattern.lastIndex = attrCursor
        const attrMatch = attrPattern.exec(attrSource)
        if (!attrMatch) {
          if (attrSource.slice(attrCursor).trim()) throw new Error('O SVG contém atributos inválidos ou não suportados.')
          break
        }
        const [, key, doubleQuoted, singleQuoted] = attrMatch
        const value = doubleQuoted ?? singleQuoted ?? ''
        if (!SVG_ATTRIBUTES.has(key) || key in attrs || /[<>]|url\s*\(|javascript:|data:|expression\s*\(/i.test(value)) throw new Error('O SVG contém atributos ativos ou não suportados.')
        if (key === 'transform' && !isSafeTransform(value)) throw new Error('O SVG contém uma transformação inválida ou não suportada.')
        if ((key === 'stroke-dasharray' && value !== 'none' && !value.split(/[\s,]+/).every(part => /^\d+(?:\.\d+)?$/.test(part) && Number.isFinite(Number(part))))
          || (key === 'stroke-dashoffset' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
          || (key === 'stroke-miterlimit' && !/^\d+(?:\.\d+)?$/.test(value))
          || (key === 'shape-rendering' && !/^(?:auto|optimizeSpeed|crispEdges|geometricPrecision)$/.test(value))
          || (key === 'vector-effect' && value !== 'none' && value !== 'non-scaling-stroke')) throw new Error('O SVG contém um valor de estilo inválido.')
        if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(value)) throw new Error('O SVG contém entidades XML inválidas.')
        attrs[key] = value
        attrCursor = attrPattern.lastIndex
      }
      if (tag === 'svg') {
        if (rootAttributes || stack.length) throw new Error('O SVG deve ter apenas um elemento raiz.')
        if (attrs.xmlns && attrs.xmlns !== 'http://www.w3.org/2000/svg') throw new Error('O namespace do SVG não é válido.')
        rootAttributes = attrs
      } else if (!stack.length) throw new Error('O SVG deve ter um elemento raiz.')
      sanitized += `<${tag}${Object.entries(attrs).map(([key, value]) => ` ${key}="${value.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/gi, '&amp;').replace(/"/g, '&quot;')}"`).join('')}${selfClosing ? '/>' : '>'}`
      if (!selfClosing) stack.push(tag)
    }
    cursor = index + token.length
  }
  const tail = markup.slice(cursor)
  if (tail.includes('<') || tail.includes('>') || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/i.test(tail)) throw new Error('O SVG contém texto ou entidades XML inválidas.')
  sanitized += tail
  if (!rootAttributes || stack.length || !/^\s*$/.test(tail)) throw new Error('A estrutura do SVG está incompleta.')

  const viewBox = validateViewBox(rootAttributes.viewBox)
  if (rootAttributes.viewBox && !viewBox) throw new Error('O atributo viewBox do SVG está inválido.')
  const width = parseDimension(rootAttributes.width) ?? viewBox?.[0]
  const height = parseDimension(rootAttributes.height) ?? viewBox?.[1]
  if (!width || !height) throw new Error('Defina width e height em pixels ou um viewBox válido no SVG.')
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`
  return { dataUrl, width: Math.round(width), height: Math.round(height) }
}
