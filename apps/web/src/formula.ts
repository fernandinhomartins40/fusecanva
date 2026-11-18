import { excelDateParts, excelSerialFromParts, parseExcelDateText } from './sheet-dates'

export type FormulaScalar = number | string | boolean
export type FormulaValue = FormulaScalar | FormulaRange
export type FormulaPoint = { sheetIndex: number; row: number; column: number }
export type FormulaRange = { kind: 'range'; points: FormulaPoint[] }

type FormulaContext = {
  resolveReference: (token: string) => FormulaPoint | null
  resolveRange: (start: FormulaPoint, endToken: string) => FormulaRange | null
  evaluateReference: (point: FormulaPoint) => FormulaScalar
}

class FormulaFailure extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}

const OMITTED_XLOOKUP_ARGUMENT = '\u0000omitted-xlookup-argument'

function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\./g, '').toUpperCase()
}

function isError(value: FormulaValue): value is string {
  return typeof value === 'string' && value.startsWith('#')
}

export function evaluateFormula(source: string, context: FormulaContext): FormulaScalar {
  const tokens: string[] = []
  let remaining = source.trim()
  const tokenPattern = /^(?:'(?:(?:[^']|'')+)'|[A-Za-z_][A-Za-z0-9_.]*)!\$?[A-Z]{1,3}\$?[1-9]\d*|\$?[A-Z]{1,3}\$?[1-9]\d*|(?:\d+(?:\.\d*)?|\.\d+)|"(?:[^"]|"")*"|(?:<=|>=|<>|[()+\-*/^&%=<>:,;])|[A-Za-z_À-ÖØ-öø-ÿ][A-Za-z0-9_.À-ÖØ-öø-ÿ]*/i
  while (remaining) {
    const whitespace = /^\s+/.exec(remaining)
    if (whitespace) { remaining = remaining.slice(whitespace[0].length); continue }
    const token = tokenPattern.exec(remaining)?.[0]
    if (!token) throw new FormulaFailure('#VALUE!')
    tokens.push(token)
    remaining = remaining.slice(token.length)
  }

  let cursor = 0
  const peek = (): string | undefined => tokens[cursor]
  const take = (): string => tokens[cursor++] ?? ''
  const expect = (expected: string): void => { if (take() !== expected) throw new FormulaFailure('#VALUE!') }
  const scalar = (value: FormulaValue): FormulaScalar => {
    if (typeof value === 'object') throw new FormulaFailure('#VALUE!')
    return value
  }
  const numeric = (value: FormulaValue): number => {
    const item = scalar(value)
    if (typeof item === 'number') return item
    if (typeof item === 'boolean') return item ? 1 : 0
    if (item === '') return 0
    const dateSerial = parseExcelDateText(item)
    if (dateSerial !== null) return dateSerial
    throw new FormulaFailure(item.startsWith('#') ? item : '#VALUE!')
  }
  const text = (value: FormulaValue): string => {
    const item = scalar(value)
    if (typeof item === 'boolean') return item ? 'TRUE' : 'FALSE'
    return String(item)
  }
  const truth = (value: FormulaValue): boolean => {
    const item = scalar(value)
    if (typeof item === 'boolean') return item
    if (typeof item === 'number') return item !== 0
    if (item.startsWith('#')) throw new FormulaFailure(item)
    return item !== ''
  }
  const valuesOf = (value: FormulaValue): FormulaScalar[] => {
    if (typeof value !== 'object') return [value]
    return value.points.map(point => context.evaluateReference(point))
  }
  const argsToValues = (args: FormulaValue[]): FormulaScalar[] => args.flatMap(valuesOf)
  const compare = (left: FormulaValue, right: FormulaValue): number => {
    const a = scalar(left); const b = scalar(right)
    if (typeof a === 'string' && a.startsWith('#')) throw new FormulaFailure(a)
    if (typeof b === 'string' && b.startsWith('#')) throw new FormulaFailure(b)
    const dateA = typeof a === 'string' ? parseExcelDateText(a) : null
    const dateB = typeof b === 'string' ? parseExcelDateText(b) : null
    if (dateA !== null && (typeof b === 'number' || dateB !== null)) return dateA < (typeof b === 'number' ? b : dateB!) ? -1 : dateA > (typeof b === 'number' ? b : dateB!) ? 1 : 0
    if (dateB !== null && typeof a === 'number') return a < dateB ? -1 : a > dateB ? 1 : 0
    if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
    if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
    const x = String(a).toLocaleLowerCase(); const y = String(b).toLocaleLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  }
  const rangePoints = (value: FormulaValue): FormulaPoint[] => {
    if (typeof value !== 'object') throw new FormulaFailure('#VALUE!')
    return value.points
  }
  const matchesCriterion = (candidate: FormulaScalar, criterion: FormulaScalar): boolean => {
    if (typeof candidate === 'string' && candidate.startsWith('#')) return false
    let operator = '='
    let expected: FormulaScalar = criterion
    if (typeof criterion === 'string') {
      const match = /^(<=|>=|<>|=|<|>)(.*)$/.exec(criterion)
      if (match) { operator = match[1]; expected = match[2] }
    }
    let order: number
    const expectedDate = typeof expected === 'string' ? parseExcelDateText(expected) : null
    const expectedNumber = typeof expected === 'number' ? expected : expectedDate !== null ? expectedDate : typeof expected === 'string' && expected.trim() !== '' && Number.isFinite(Number(expected)) ? Number(expected) : null
    if (expectedNumber !== null) {
      const candidateDate = typeof candidate === 'string' ? parseExcelDateText(candidate) : null
      const candidateNumber = typeof candidate === 'number' ? candidate : candidateDate !== null ? candidateDate : typeof candidate === 'string' && candidate.trim() !== '' && Number.isFinite(Number(candidate)) ? Number(candidate) : null
      if (candidateNumber === null) return operator === '<>'
      order = candidateNumber < expectedNumber ? -1 : candidateNumber > expectedNumber ? 1 : 0
    }
    else if (typeof candidate === 'string' && typeof expected === 'string' && /[*?~]/.test(expected)) {
      let pattern = '^'
      for (let index = 0; index < expected.length; index += 1) {
        const character = expected[index]
        if (character === '~' && index + 1 < expected.length) { index += 1; pattern += expected[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
        else if (character === '*') pattern += '.*'
        else if (character === '?') pattern += '.'
        else pattern += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      }
      const matched = new RegExp(`${pattern}$`, 'i').test(candidate)
      return operator === '<>' ? !matched : operator === '=' ? matched : false
    } else {
      const a = typeof candidate === 'boolean' ? String(candidate).toUpperCase() : String(candidate)
      const b = typeof expected === 'boolean' ? String(expected).toUpperCase() : String(expected)
      order = a.toLocaleLowerCase() < b.toLocaleLowerCase() ? -1 : a.toLocaleLowerCase() > b.toLocaleLowerCase() ? 1 : 0
    }
    return operator === '=' ? order === 0 : operator === '<>' ? order !== 0 : operator === '<' ? order < 0 : operator === '>' ? order > 0 : operator === '<=' ? order <= 0 : order >= 0
  }

  const parseComparison = (): FormulaValue => {
    let value = parseConcat()
    const operator = peek()
    if (operator && ['=', '<>', '<', '>', '<=', '>='].includes(operator)) {
      take()
      const order = compare(value, parseConcat())
      value = operator === '=' ? order === 0 : operator === '<>' ? order !== 0 : operator === '<' ? order < 0 : operator === '>' ? order > 0 : operator === '<=' ? order <= 0 : order >= 0
    }
    return value
  }
  const parseConcat = (): FormulaValue => {
    let value = parseSum()
    while (peek() === '&') { take(); value = text(value) + text(parseSum()) }
    return value
  }
  const parseSum = (): FormulaValue => {
    let value = parseProduct()
    while (peek() === '+' || peek() === '-') {
      const operator = take(); const left = numeric(value); const right = numeric(parseProduct())
      value = operator === '+' ? left + right : left - right
    }
    return value
  }
  const parseProduct = (): FormulaValue => {
    let value = parseUnary()
    while (peek() === '*' || peek() === '/') {
      const operator = take(); const left = numeric(value); const right = numeric(parseUnary())
      if (operator === '/' && right === 0) throw new FormulaFailure('#DIV/0!')
      value = operator === '*' ? left * right : left / right
    }
    return value
  }
  const parseUnary = (): FormulaValue => {
    if (peek() === '+' || peek() === '-') { const sign = take(); const value = numeric(parseUnary()); return sign === '-' ? -value : value }
    return parsePower()
  }
  const parsePower = (): FormulaValue => {
    let base = parsePrimary()
    while (peek() === '%') { take(); base = numeric(base) / 100 }
    if (peek() === '^') { take(); return numeric(base) ** numeric(parseUnary()) }
    return base
  }
  const parsePrimary = (): FormulaValue => {
    const token = take()
    if (!token) throw new FormulaFailure('#VALUE!')
    if (token === '(') { const value = parseComparison(); expect(')'); return value }
    if (token.startsWith('"')) return token.slice(1, -1).replace(/""/g, '"')
    if (/^(TRUE|VERDADEIRO)$/i.test(token)) return true
    if (/^(FALSE|FALSO)$/i.test(token)) return false
    if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) return Number(token)
    if (peek() === '(') return parseFunction(token)
    const point = context.resolveReference(token)
    if (point) {
      if (peek() === ':') {
        take()
        const range = context.resolveRange(point, take())
        if (!range) throw new FormulaFailure('#REF!')
        return range
      }
      return context.evaluateReference(point)
    }
    if (token.includes('!')) throw new FormulaFailure('#REF!')
    throw new FormulaFailure('#NAME?')
  }

  const parseFunction = (rawName: string): FormulaValue => {
    const name = normalizeName(rawName)
    const supportsOmittedXlookupArguments = name === 'XLOOKUP' || name === 'PROCX'
    expect('(')
    const args: FormulaValue[] = []
    if (peek() !== ')') {
      while (true) {
        if (supportsOmittedXlookupArguments && (peek() === ',' || peek() === ';')) {
          args.push(OMITTED_XLOOKUP_ARGUMENT)
          take()
          continue
        }
        try { args.push(parseComparison()) } catch (error) {
          if (!(error instanceof FormulaFailure)) throw error
          args.push(error.code)
        }
        if (peek() !== ',' && peek() !== ';') break
        take()
        if (supportsOmittedXlookupArguments && peek() === ')') {
          args.push(OMITTED_XLOOKUP_ARGUMENT)
          break
        }
      }
    }
    expect(')')
    const requireCount = (minimum: number, maximum = minimum): void => {
      if (args.length < minimum || args.length > maximum) throw new FormulaFailure('#VALUE!')
    }
    const one = (): FormulaValue => { requireCount(1); return args[0] }
    const numericArgs = (): number[] => {
      const values = argsToValues(args)
      const error = values.find((value): value is string => typeof value === 'string' && value.startsWith('#'))
      if (error) throw new FormulaFailure(error)
      return values.filter((value): value is number => typeof value === 'number')
    }
    const statisticalNumbers = (value: FormulaValue): number[] => {
      const values = valuesOf(value)
      const error = values.find((item): item is string => typeof item === 'string' && item.startsWith('#'))
      if (error) throw new FormulaFailure(error)
      return values.filter((item): item is number => typeof item === 'number')
    }
    const percentile = (numbers: number[], rank: number, exclusive: boolean): number => {
      if (!Number.isFinite(rank) || rank < 0 || rank > 1 || numbers.length === 0) throw new FormulaFailure('#NUM!')
      const sorted = [...numbers].sort((a, b) => a - b)
      const position = exclusive ? (sorted.length + 1) * rank - 1 : (sorted.length - 1) * rank
      if (position < 0 || position > sorted.length - 1) throw new FormulaFailure('#NUM!')
      const lower = Math.floor(position)
      const fraction = position - lower
      return sorted[lower] + (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction
    }
    const variance = (numbers: number[], sample: boolean): number => {
      if (numbers.length < (sample ? 2 : 1)) throw new FormulaFailure('#DIV/0!')
      const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length
      return numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (numbers.length - (sample ? 1 : 0))
    }
    const sumProduct = (): number => {
      requireCount(1, args.length)
      const arrays = args.map(argument => {
        if (typeof argument !== 'object') return { rows: 1, columns: 1, values: [argument], scalar: true }
        const points = argument.points
        const rows = [...new Set(points.map(point => point.row))].length
        const columns = [...new Set(points.map(point => point.column))].length
        if (rows * columns !== points.length) throw new FormulaFailure('#VALUE!')
        return { rows, columns, values: points.map(point => context.evaluateReference(point)), scalar: false }
      })
      const height = Math.max(...arrays.map(array => array.rows))
      const width = Math.max(...arrays.map(array => array.columns))
      if (arrays.some(array => !array.scalar && (array.rows !== height || array.columns !== width))) throw new FormulaFailure('#VALUE!')
      let total = 0
      for (let index = 0; index < height * width; index += 1) {
        let product = 1
        for (const array of arrays) {
          const value = array.values[array.scalar ? 0 : index]
          if (typeof value === 'string' && value.startsWith('#')) throw new FormulaFailure(value)
          // SUMPRODUCT ignores text and blank cells in arrays; booleans coerce to 1/0.
          product *= typeof value === 'number' ? value : typeof value === 'boolean' ? Number(value) : 0
        }
        total += product
      }
      return total
    }
    const conditionalAggregate = (kind: 'sum' | 'count' | 'average' | 'max' | 'min', aggregateRange: FormulaValue, criteriaRanges: FormulaValue[], criteria: FormulaScalar[]): number | string => {
      if (!criteriaRanges.length || criteriaRanges.length !== criteria.length) throw new FormulaFailure('#VALUE!')
      const points = rangePoints(aggregateRange)
      const conditionPoints = criteriaRanges.map(rangePoints)
      if (conditionPoints.some(range => range.length !== points.length)) throw new FormulaFailure('#VALUE!')
      const selected: FormulaScalar[] = []
      for (let index = 0; index < points.length; index += 1) {
        const matches = conditionPoints.every((range, conditionIndex) => matchesCriterion(context.evaluateReference(range[index]), criteria[conditionIndex]))
        if (matches) selected.push(context.evaluateReference(points[index]))
      }
      const failure = selected.find((value): value is string => typeof value === 'string' && value.startsWith('#'))
      if (failure) throw new FormulaFailure(failure)
      if (kind === 'count') return selected.length
      const numbers = selected.filter((value): value is number => typeof value === 'number')
      if (kind === 'max') return numbers.length ? Math.max(...numbers) : 0
      if (kind === 'min') return numbers.length ? Math.min(...numbers) : 0
      const total = numbers.reduce((sum, value) => sum + value, 0)
      if (kind === 'average') return numbers.length ? total / numbers.length : '#DIV/0!'
      return total
    }
    const lookupTable = (range: FormulaValue): { points: FormulaPoint[]; rows: number[]; columns: number[] } => {
      const points = rangePoints(range)
      return { points, rows: [...new Set(points.map(point => point.row))], columns: [...new Set(points.map(point => point.column))] }
    }
    const tableCell = (table: ReturnType<typeof lookupTable>, row: number, column: number): FormulaScalar => {
      const point = table.points[row * table.columns.length + column]
      if (!point) throw new FormulaFailure('#REF!')
      return context.evaluateReference(point)
    }
    const findLookup = (candidates: FormulaScalar[], lookup: FormulaScalar, exact: boolean, approximateDirection: -1 | 1 = -1, wildcard = false): number => {
      let candidateIndex = -1
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]
        if (wildcard ? matchesCriterion(candidate, lookup) : compare(candidate, lookup) === 0) return index
        if (!exact) {
          const order = compare(candidate, lookup)
          if (approximateDirection < 0 && order < 0) candidateIndex = index
          else if (approximateDirection > 0 && order > 0 && candidateIndex < 0) candidateIndex = index
        }
      }
      return candidateIndex
    }
    const dateSerial = (value: FormulaValue): number => {
      const serial = numeric(value)
      if (!excelDateParts(serial)) throw new FormulaFailure('#NUM!')
      return serial
    }
    const dateText = (value: FormulaValue): number => {
      const item = scalar(value)
      const serial = typeof item === 'string' ? parseExcelDateText(item) : null
      if (serial === null) throw new FormulaFailure('#VALUE!')
      return serial
    }
    const timeText = (value: FormulaValue): number => {
      const item = text(value).trim()
      const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(item)
      if (!match) throw new FormulaFailure('#VALUE!')
      let hour = Number(match[1]); const minute = Number(match[2]); const second = Number(match[3] ?? 0)
      const meridiem = match[4]?.toUpperCase()
      if (minute > 59 || second > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) throw new FormulaFailure('#VALUE!')
      if (meridiem) hour = hour % 12 + (meridiem === 'PM' ? 12 : 0)
      return (hour * 3600 + minute * 60 + second) / 86400
    }
    const dateWeekday = (serial: number): number => {
      const weekdaySerial = Math.floor(serial) - (serial > 60 ? 1 : 0)
      return weekdaySerial % 7
    }
    if (['IF', 'SI'].includes(name)) { requireCount(2, 3); return truth(args[0]) ? args[1] : args[2] ?? false }
    if (['IFS', 'SES'].includes(name)) {
      if (args.length < 2 || args.length % 2 !== 0) throw new FormulaFailure('#VALUE!')
      for (let index = 0; index < args.length; index += 2) {
        if (truth(args[index])) return args[index + 1]
      }
      return '#N/A'
    }
    if (['IFERROR', 'SEERRO'].includes(name)) {
      requireCount(2)
      try { const result = args[0]; if (isError(result)) return args[1]; return result } catch { return args[1] }
    }
    if (['AND', 'E'].includes(name)) return args.every(truth)
    if (['OR', 'OU'].includes(name)) return args.some(truth)
    if (['NOT', 'NAO'].includes(name)) return !truth(one())
    if (['SUM', 'SOMA'].includes(name)) return numericArgs().reduce((sum, value) => sum + value, 0)
    if (name === 'SUBTOTAL') {
      requireCount(2, args.length)
      const functionNumber = numeric(args[0])
      const operation = Math.trunc(functionNumber > 100 ? functionNumber - 100 : functionNumber)
      if (functionNumber !== Math.trunc(functionNumber) || operation < 1 || operation > 11) throw new FormulaFailure('#VALUE!')
      const values = args.slice(1).flatMap(valuesOf)
      const error = values.find((value): value is string => typeof value === 'string' && value.startsWith('#'))
      if (error) throw new FormulaFailure(error)
      const numbers = values.filter((value): value is number => typeof value === 'number')
      if (operation === 1) return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : '#DIV/0!'
      if (operation === 2) return numbers.length
      if (operation === 3) return values.filter(value => value !== '').length
      if (operation === 4) return numbers.length ? Math.max(...numbers) : 0
      if (operation === 5) return numbers.length ? Math.min(...numbers) : 0
      if (operation === 6) return numbers.reduce((product, value) => product * value, 1)
      if (operation === 9) return numbers.reduce((sum, value) => sum + value, 0)
      if (operation === 7 || operation === 8 || operation === 10 || operation === 11) {
        const isVariance = operation === 10 || operation === 11
        const isSample = operation === 7 || operation === 10
        const result = variance(numbers, isSample)
        return isVariance ? result : Math.sqrt(result)
      }
    }
    if (['AVERAGE', 'MEDIA'].includes(name)) { const numbers = numericArgs(); return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : '#DIV/0!' }
    if (['MEDIAN', 'MEDIANA'].includes(name)) {
      const numbers = numericArgs().sort((left, right) => left - right)
      if (!numbers.length) return '#NUM!'
      const middle = Math.floor(numbers.length / 2)
      return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2
    }
    if (['MODE', 'MODA', 'MODESNGL', 'MODASIMPLES'].includes(name)) {
      const numbers = numericArgs()
      const frequencies = new Map<number, number>()
      for (const value of numbers) frequencies.set(value, (frequencies.get(value) ?? 0) + 1)
      let mode: number | null = null
      let frequency = 1
      for (const [value, count] of frequencies) {
        if (count > frequency) { mode = value; frequency = count }
      }
      return mode ?? '#N/A'
    }
    if (['STDEV', 'STDEVS', 'DESVPAD', 'DESVPADS', 'DESVPADA', 'DESVPADAMOSTRA', 'VAR', 'VARS', 'VARA', 'VARIANCE', 'VARIANCIA', 'VARIANCIAAMOSTRA', 'VARIANCIAS', 'STDEVP', 'DESVPADP', 'DESVPADPOP', 'VARP', 'VARIANCIAP', 'VARIANCIA.POP', 'VARIANCIAPOP'].includes(name)) {
      requireCount(1, args.length)
      const sample = ['STDEV', 'STDEVS', 'DESVPAD', 'DESVPADS', 'DESVPADA', 'DESVPADAMOSTRA', 'VAR', 'VARS', 'VARA', 'VARIANCE', 'VARIANCIA', 'VARIANCIAAMOSTRA', 'VARIANCIAS'].includes(name)
      const numbers = args.flatMap(statisticalNumbers)
      const result = variance(numbers, sample)
      return ['STDEV', 'STDEVS', 'DESVPAD', 'DESVPADS', 'DESVPADA', 'DESVPADAMOSTRA', 'STDEVP', 'DESVPADP', 'DESVPADPOP'].includes(name) ? Math.sqrt(result) : result
    }
    if (['QUARTILE', 'QUARTILEINC', 'QUARTILEEXC', 'QUARTIL', 'QUARTILINC', 'QUARTILEXC', 'PERCENTILE', 'PERCENTILEINC', 'PERCENTILEEXC', 'PERCENTIL', 'PERCENTILINC', 'PERCENTILEXC'].includes(name)) {
      requireCount(2)
      const isQuartile = name.startsWith('QUART')
      const exclusive = name.endsWith('EXC') || name.endsWith('EXC') || name === 'QUARTILEXC' || name === 'PERCENTILEXC'
      const rawRank = numeric(args[1])
      const rank = isQuartile ? rawRank / 4 : rawRank
      return percentile(statisticalNumbers(args[0]), rank, exclusive)
    }
    if (['MIN', 'MINIMO'].includes(name)) { const numbers = numericArgs(); return numbers.length ? Math.min(...numbers) : 0 }
    if (['MAX', 'MAXIMO'].includes(name)) { const numbers = numericArgs(); return numbers.length ? Math.max(...numbers) : 0 }
    if (['COUNT', 'CONTNUM'].includes(name)) return numericArgs().length
    if (name === 'SUMPRODUCT' || name === 'SOMARPRODUTO') return sumProduct()
    if (['COUNTA', 'CONTVAL'].includes(name)) return argsToValues(args).filter(value => value !== '').length
    if (['COUNTBLANK', 'CONTARVAZIO'].includes(name)) { return valuesOf(one()).filter(value => value === '').length }
    if (['COUNTIF', 'CONTSE'].includes(name)) {
      requireCount(2)
      const points = rangePoints(args[0])
      const criterion = scalar(args[1])
      return points.filter(point => matchesCriterion(context.evaluateReference(point), criterion)).length
    }
    if (['SUMIF', 'SOMASE', 'AVERAGEIF', 'MEDIASE'].includes(name)) {
      requireCount(2, 3)
      const criteriaRange = args[0]
      const criterion = scalar(args[1])
      const aggregateRange = args[2] ?? criteriaRange
      return conditionalAggregate(name === 'SUMIF' || name === 'SOMASE' ? 'sum' : 'average', aggregateRange, [criteriaRange], [criterion])
    }
    if (['COUNTIFS', 'CONTSES'].includes(name)) {
      if (args.length < 2 || args.length % 2 !== 0) throw new FormulaFailure('#VALUE!')
      const ranges: FormulaValue[] = []; const criteria: FormulaScalar[] = []
      for (let index = 0; index < args.length; index += 2) { ranges.push(args[index]); criteria.push(scalar(args[index + 1])) }
      const anchor = ranges[0]
      return conditionalAggregate('count', anchor, ranges, criteria)
    }
    if (['SUMIFS', 'SOMASES', 'AVERAGEIFS', 'MEDIASES'].includes(name)) {
      if (args.length < 3 || args.length % 2 !== 1) throw new FormulaFailure('#VALUE!')
      const ranges: FormulaValue[] = []; const criteria: FormulaScalar[] = []
      for (let index = 1; index < args.length; index += 2) { ranges.push(args[index]); criteria.push(scalar(args[index + 1])) }
      return conditionalAggregate(name === 'SUMIFS' || name === 'SOMASES' ? 'sum' : 'average', args[0], ranges, criteria)
    }
    if (['MAXIFS', 'MAXIMOSES', 'MINIFS', 'MINIMOSES'].includes(name)) {
      if (args.length < 3 || args.length % 2 !== 1) throw new FormulaFailure('#VALUE!')
      const ranges: FormulaValue[] = []; const criteria: FormulaScalar[] = []
      for (let index = 1; index < args.length; index += 2) { ranges.push(args[index]); criteria.push(scalar(args[index + 1])) }
      return conditionalAggregate(name === 'MAXIFS' || name === 'MAXIMOSES' ? 'max' : 'min', args[0], ranges, criteria)
    }
    if (['DATE', 'DATA'].includes(name)) {
      requireCount(3)
      const serial = excelSerialFromParts(numeric(args[0]), numeric(args[1]), numeric(args[2]))
      if (serial === null) throw new FormulaFailure('#NUM!')
      return serial
    }
    if (['DATEVALUE', 'DATAVALOR'].includes(name)) return dateText(one())
    if (name === 'TIME' || name === 'TEMPO') {
      requireCount(3)
      const hour = numeric(args[0]); const minute = numeric(args[1]); const second = numeric(args[2])
      if (hour < 0 || minute < 0 || second < 0) throw new FormulaFailure('#NUM!')
      return ((Math.trunc(hour) * 3600 + Math.trunc(minute) * 60 + Math.trunc(second)) % 86400) / 86400
    }
    if (['TIMEVALUE', 'VALORTEMPO'].includes(name)) return timeText(one())
    if (['TODAY', 'HOJE'].includes(name)) {
      requireCount(0)
      const now = new Date()
      const serial = excelSerialFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate())
      if (serial === null) throw new FormulaFailure('#NUM!')
      return serial
    }
    if (name === 'NOW' || name === 'AGORA') {
      requireCount(0)
      const now = new Date(); const day = excelSerialFromParts(now.getFullYear(), now.getMonth() + 1, now.getDate())
      if (day === null) throw new FormulaFailure('#NUM!')
      return day + (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400
    }
    if (['YEAR', 'ANO', 'MONTH', 'MES', 'DAY', 'DIA', 'HOUR', 'HORA', 'MINUTE', 'MINUTO', 'SECOND', 'SEGUNDO'].includes(name)) {
      const parts = excelDateParts(dateSerial(one()))
      if (!parts) throw new FormulaFailure('#NUM!')
      if (name === 'YEAR' || name === 'ANO') return parts.year
      if (name === 'MONTH' || name === 'MES') return parts.month
      if (name === 'DAY' || name === 'DIA') return parts.day
      if (name === 'HOUR' || name === 'HORA') return parts.hour
      if (name === 'MINUTE' || name === 'MINUTO') return parts.minute
      return parts.second
    }
    if (name === 'DAYS' || name === 'DIAS') { requireCount(2); return Math.trunc(dateSerial(args[0])) - Math.trunc(dateSerial(args[1])) }
    if (name === 'WEEKDAY' || name === 'DIASEM') {
      requireCount(1, 2)
      const serial = Math.floor(dateSerial(args[0])); const weekdaySerial = serial - (serial > 60 ? 1 : 0); const returnType = args[1] === undefined ? 1 : numeric(args[1])
      if (![1, 2, 3, 11, 12, 13, 14, 15, 16, 17].includes(returnType)) throw new FormulaFailure('#NUM!')
      if (returnType === 1) return weekdaySerial % 7 + 1
      if (returnType === 2 || returnType === 11) return (weekdaySerial + 6) % 7 + 1
      if (returnType === 3) return (weekdaySerial + 6) % 7
      return (weekdaySerial + 17 - returnType) % 7 + 1
    }
    if (['EDATE', 'DATAM'].includes(name) || ['EOMONTH', 'FIMMES'].includes(name)) {
      requireCount(2)
      const serial = dateSerial(args[0]); const offset = Math.trunc(numeric(args[1])); const parts = excelDateParts(serial)
      if (!parts || !Number.isFinite(offset)) throw new FormulaFailure('#NUM!')
      const target = new Date(Date.UTC(0, 0, 1)); target.setUTCFullYear(parts.year, parts.month - 1 + offset, 1)
      if (name === 'EDATE' || name === 'DATAM') {
        const monthEnd = new Date(Date.UTC(0, 0, 1)); monthEnd.setUTCFullYear(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
        const day = Math.min(parts.day, monthEnd.getUTCDate())
        const result = excelSerialFromParts(target.getUTCFullYear(), target.getUTCMonth() + 1, day)
        if (result === null) throw new FormulaFailure('#NUM!')
        return result
      }
      const result = excelSerialFromParts(target.getUTCFullYear(), target.getUTCMonth() + 2, 0)
      if (result === null) throw new FormulaFailure('#NUM!')
      return result
    }
    if (name === 'NETWORKDAYS' || name === 'DIATRABALHOTOTAL') {
      requireCount(2, 3)
      const start = Math.trunc(dateSerial(args[0])); const end = Math.trunc(dateSerial(args[1])); const direction = start <= end ? 1 : -1
      if (Math.abs(end - start) > 1_000_000) throw new FormulaFailure('#NUM!')
      const holidays = new Set((args[2] === undefined ? [] : valuesOf(args[2])).map(value => Math.floor(numeric(value))))
      let count = 0
      for (let serial = start; direction > 0 ? serial <= end : serial >= end; serial += direction) {
        const weekday = dateWeekday(serial)
        if (weekday !== 0 && weekday !== 6 && !holidays.has(serial)) count += direction
      }
      return count
    }
    if (name === 'WORKDAY' || name === 'DIATRABALHO') {
      requireCount(2, 3)
      let serial = Math.trunc(dateSerial(args[0])); let remaining = Math.abs(Math.trunc(numeric(args[1]))); const direction = numeric(args[1]) < 0 ? -1 : 1
      const holidays = new Set((args[2] === undefined ? [] : valuesOf(args[2])).map(value => Math.floor(numeric(value))))
      while (remaining > 0) {
        serial += direction
        if (dateWeekday(serial) !== 0 && dateWeekday(serial) !== 6 && !holidays.has(serial)) remaining -= 1
        if (serial < 0 || serial >= 2_958_466) throw new FormulaFailure('#NUM!')
      }
      return serial
    }
    if (name === 'INDEX' || name === 'INDICE') {
      requireCount(2, 3)
      const table = lookupTable(args[0])
      const rowIndex = numeric(args[1]); const columnIndex = args[2] === undefined ? 1 : numeric(args[2])
      if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex) || rowIndex < 1 || columnIndex < 1) throw new FormulaFailure('#VALUE!')
      if (rowIndex > table.rows.length || columnIndex > table.columns.length) throw new FormulaFailure('#REF!')
      return tableCell(table, rowIndex - 1, columnIndex - 1)
    }
    if (name === 'MATCH' || name === 'CORRESP') {
      requireCount(2, 3)
      const table = lookupTable(args[1])
      const vertical = table.columns.length === 1
      const horizontal = table.rows.length === 1
      if (!vertical && !horizontal) throw new FormulaFailure('#N/A')
      const length = vertical ? table.rows.length : table.columns.length
      const candidates = Array.from({ length }, (_, index) => tableCell(table, vertical ? index : 0, vertical ? 0 : index))
      const lookup = scalar(args[0]); const matchType = args[2] === undefined ? 1 : numeric(args[2])
      if (![-1, 0, 1].includes(matchType)) throw new FormulaFailure('#VALUE!')
      if (matchType === 0) {
        const index = candidates.findIndex(candidate => matchesCriterion(candidate, lookup))
        return index < 0 ? '#N/A' : index + 1
      }
      let index = -1
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        const order = compare(candidates[candidateIndex], lookup)
        if (order === 0) return candidateIndex + 1
        if (matchType === 1 && order < 0) index = candidateIndex
        else if (matchType === -1 && order > 0) index = candidateIndex
      }
      return index < 0 ? '#N/A' : index + 1
    }
    if (['VLOOKUP', 'PROCV', 'HLOOKUP', 'PROCH'].includes(name)) {
      requireCount(3, 4)
      const table = lookupTable(args[1])
      const vertical = name === 'VLOOKUP' || name === 'PROCV'
      const lookupIndex = numeric(args[2])
      if (!Number.isInteger(lookupIndex) || lookupIndex < 1) throw new FormulaFailure('#VALUE!')
      const returnDimension = vertical ? table.columns.length : table.rows.length
      if (lookupIndex > returnDimension) throw new FormulaFailure('#REF!')
      const candidateCount = vertical ? table.rows.length : table.columns.length
      const candidates = Array.from({ length: candidateCount }, (_, index) => tableCell(table, vertical ? index : 0, vertical ? 0 : index))
      const exact = args[3] === false || args[3] === 0 || typeof args[3] === 'string' && /^(FALSE|FALSO)$/i.test(args[3])
      const found = findLookup(candidates, scalar(args[0]), exact)
      if (found < 0) return '#N/A'
      return vertical ? tableCell(table, found, lookupIndex - 1) : tableCell(table, lookupIndex - 1, found)
    }
    if (['XLOOKUP', 'PROCX'].includes(name)) {
      requireCount(3, 6)
      const lookup = scalar(args[0])
      const lookupRange = lookupTable(args[1])
      const returnRange = lookupTable(args[2])
      const lookupVertical = lookupRange.columns.length === 1
      const lookupHorizontal = lookupRange.rows.length === 1
      if (!lookupVertical && !lookupHorizontal) throw new FormulaFailure('#VALUE!')
      const lookupLength = lookupVertical ? lookupRange.rows.length : lookupRange.columns.length
      const returnVertical = returnRange.columns.length === 1
      const returnHorizontal = returnRange.rows.length === 1
      if ((!returnVertical && !returnHorizontal) || (returnVertical ? returnRange.rows.length : returnRange.columns.length) !== lookupLength) throw new FormulaFailure('#VALUE!')
      const candidates = Array.from({ length: lookupLength }, (_, index) => tableCell(lookupRange, lookupVertical ? index : 0, lookupVertical ? 0 : index))
      const matchMode = args[4] === undefined || args[4] === OMITTED_XLOOKUP_ARGUMENT ? 0 : numeric(args[4])
      const searchMode = args[5] === undefined || args[5] === OMITTED_XLOOKUP_ARGUMENT ? 1 : numeric(args[5])
      if (![-1, 0, 1, 2].includes(matchMode) || ![1, -1].includes(searchMode)) throw new FormulaFailure('#VALUE!')
      const searchCandidates = searchMode === 1 ? candidates : [...candidates].reverse()
      const foundSearchIndex = matchMode === 2
        ? searchCandidates.findIndex(candidate => matchesCriterion(candidate, lookup))
        : findLookup(searchCandidates, lookup, matchMode === 0, matchMode === 1 ? 1 : -1)
      const found = foundSearchIndex < 0 ? -1 : searchMode === 1 ? foundSearchIndex : candidates.length - 1 - foundSearchIndex
      if (found < 0) return args[3] === undefined || args[3] === OMITTED_XLOOKUP_ARGUMENT ? '#N/A' : args[3]
      return tableCell(returnRange, returnVertical ? found : 0, returnVertical ? 0 : found)
    }
    if (['ABS'].includes(name)) return Math.abs(numeric(one()))
    if (['ROUND', 'ARRED'].includes(name)) { requireCount(2); const factor = 10 ** Math.max(-12, Math.min(12, Math.trunc(numeric(args[1])))); return Math.round((numeric(args[0]) + Number.EPSILON) * factor) / factor }
    if (['ROUNDUP', 'ARREDONDARPARACIMA', 'ROUNDDOWN', 'ARREDONDARPARABAIXO'].includes(name)) {
      requireCount(2)
      const value = numeric(args[0])
      const digits = Math.max(-12, Math.min(12, Math.trunc(numeric(args[1]))))
      const factor = 10 ** digits
      const scaled = value * factor
      const rounded = name === 'ROUNDUP' || name === 'ARREDONDARPARACIMA'
        ? Math.sign(scaled) * Math.ceil(Math.abs(scaled))
        : Math.sign(scaled) * Math.floor(Math.abs(scaled))
      return rounded / factor
    }
    if (['POWER', 'POTENCIA'].includes(name)) { requireCount(2); return numeric(args[0]) ** numeric(args[1]) }
    if (['MOD', 'RESTO'].includes(name)) { requireCount(2); const divisor = numeric(args[1]); if (!divisor) throw new FormulaFailure('#DIV/0!'); return numeric(args[0]) % divisor }
    if (name === 'INT') return Math.floor(numeric(one()))
    if (name === 'TRUNC' || name === 'TRUNCAR') { requireCount(1, 2); const value = numeric(args[0]); const digits = Math.max(-12, Math.min(12, args[1] === undefined ? 0 : Math.trunc(numeric(args[1])))); const factor = 10 ** digits; return Math.trunc(value * factor) / factor }
    if (['SQRT', 'RAIZ'].includes(name)) { const value = numeric(one()); return value < 0 ? '#NUM!' : Math.sqrt(value) }
    if (['CONCAT', 'CONCATENATE', 'CONCATENAR'].includes(name)) return argsToValues(args).map(value => typeof value === 'boolean' ? String(value).toUpperCase() : String(value)).join('')
    if (name === 'LEN' || name === 'NÚM.CARACT') return text(one()).length
    if (name === 'LOWER' || name === 'MINÚSCULA') return text(one()).toLocaleLowerCase()
    if (name === 'UPPER' || name === 'MAIÚSCULA') return text(one()).toLocaleUpperCase()
    if (name === 'TRIM' || name === 'ARRUMAR') return text(one()).trim().replace(/\s+/g, ' ')
    if (name === 'LEFT' || name === 'ESQUERDA' || name === 'RIGHT' || name === 'DIREITA') {
      requireCount(1, 2); const value = text(args[0]); const count = Math.max(0, Math.trunc(args[1] === undefined ? 1 : numeric(args[1])))
      return name === 'LEFT' || name === 'ESQUERDA' ? value.slice(0, count) : count === 0 ? '' : value.slice(-count)
    }
    if (name === 'MID' || name === 'EXT.TEXTO') { requireCount(3); const start = Math.max(1, Math.trunc(numeric(args[1]))); const count = Math.max(0, Math.trunc(numeric(args[2]))); return text(args[0]).slice(start - 1, start - 1 + count) }
    if (['TEXTJOIN', 'TEXTOJUNTAR'].includes(name)) {
      if (args.length < 3) throw new FormulaFailure('#VALUE!')
      const delimiter = text(args[0]); const ignoreEmpty = truth(args[1]); const values = argsToValues(args.slice(2))
      const failure = values.find((value): value is string => typeof value === 'string' && value.startsWith('#'))
      if (failure) throw new FormulaFailure(failure)
      const strings = values.map(value => typeof value === 'boolean' ? String(value).toUpperCase() : String(value))
      return strings.filter(value => !ignoreEmpty || value !== '').join(delimiter)
    }
    if (name === 'EXACT' || name === 'EXATO') { requireCount(2); return text(args[0]) === text(args[1]) }
    if (name === 'PROPER' || name === 'PRI.MAIUSCULA') return text(one()).toLocaleLowerCase().replace(/(^|[^\p{L}\p{N}])([\p{L}])/gu, (_match, boundary: string, letter: string) => boundary + letter.toLocaleUpperCase())
    if (name === 'CLEAN' || name === 'LIMPAR') return [...text(one())].filter(character => { const code = character.charCodeAt(0); return code >= 32 && code !== 127 }).join('')
    if (name === 'VALUE' || name === 'VALOR') {
      const value = text(one()).trim(); const parsed = Number(value)
      if (value === '' || !Number.isFinite(parsed)) throw new FormulaFailure('#VALUE!')
      return parsed
    }
    if (name === 'SUBSTITUTE' || name === 'SUBSTITUIR') {
      requireCount(3, 4)
      const value = text(args[0]); const oldText = text(args[1]); const newText = text(args[2])
      if (args[3] === undefined) return oldText === '' ? value : value.split(oldText).join(newText)
      const instance = numeric(args[3])
      if (!Number.isInteger(instance) || instance < 1 || oldText === '') throw new FormulaFailure('#VALUE!')
      let occurrence = 0
      return value.replaceAll(oldText, match => { occurrence += 1; return occurrence === instance ? newText : match })
    }
    if (name === 'REPLACE') {
      requireCount(4)
      const value = text(args[0]); const start = Math.trunc(numeric(args[1])); const count = Math.trunc(numeric(args[2]))
      if (start < 1 || count < 0) throw new FormulaFailure('#VALUE!')
      return value.slice(0, start - 1) + text(args[3]) + value.slice(start - 1 + count)
    }
    if (name === 'FIND' || name === 'LOCALIZAR' || name === 'SEARCH' || name === 'PROCURAR') {
      requireCount(2, 3)
      const needle = text(args[0]); const haystack = text(args[1]); const start = args[2] === undefined ? 1 : Math.trunc(numeric(args[2]))
      if (start < 1 || start > haystack.length + 1) throw new FormulaFailure('#VALUE!')
      const source = name === 'FIND' || name === 'LOCALIZAR' ? haystack : haystack.toLocaleLowerCase()
      const target = name === 'FIND' || name === 'LOCALIZAR' ? needle : needle.toLocaleLowerCase()
      const found = source.indexOf(target, start - 1)
      return found < 0 ? '#VALUE!' : found + 1
    }
    throw new FormulaFailure('#NAME?')
  }

  try {
    const result = parseComparison()
    if (cursor !== tokens.length) throw new FormulaFailure('#VALUE!')
    if (typeof result === 'object') throw new FormulaFailure('#VALUE!')
    if (typeof result === 'number' && !Number.isFinite(result)) throw new FormulaFailure('#NUM!')
    return result
  } catch (error) {
    if (error instanceof FormulaFailure) return error.code
    return '#VALUE!'
  }
}
