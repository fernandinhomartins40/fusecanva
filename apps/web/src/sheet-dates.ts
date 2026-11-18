const DAY_MS = 86_400_000
const EXCEL_EPOCH = Date.UTC(1899, 11, 31)
const MAX_EXCEL_SERIAL = 2_958_466

export type ExcelDateParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number }

export function parseExcelDateText(value: string): number | null {
  const text = value.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|([+-]\d{2}:?\d{2}))?)?$/.exec(text)
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text)
  const match = iso ?? br
  if (!match) return null
  const year = Number(iso ? match[1] : match[3])
  const month = Number(iso ? match[2] : match[2])
  const day = Number(iso ? match[3] : match[1])
  const hour = Number(match[4] ?? 0)
  const minute = Number(match[5] ?? 0)
  const second = Number(match[6] ?? 0)
  const millisecond = Number((match[7] ?? '').padEnd(3, '0') || 0)
  if (iso && match[8]) {
    const shifted = new Date(text)
    if (!Number.isFinite(shifted.getTime())) return null
    return parseExcelDateText(`${String(shifted.getUTCFullYear()).padStart(4, '0')}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}T${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}:${String(shifted.getUTCSeconds()).padStart(2, '0')}.${String(shifted.getUTCMilliseconds()).padStart(3, '0')}`)
  }
  if (year === 1900 && month === 2 && day === 29) return 60 + (hour * 3600 + minute * 60 + second + millisecond / 1000) / 86400
  const date = new Date(Date.UTC(0, 0, 1, hour, minute, second, millisecond))
  date.setUTCFullYear(year, month - 1, day)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null
  const serial = Math.floor((Date.UTC(year, month - 1, day) - EXCEL_EPOCH) / DAY_MS) + (year > 1900 || year === 1900 && month >= 3 ? 1 : 0)
  return serial < 0 ? null : serial + (hour * 3600 + minute * 60 + second + millisecond / 1000) / 86400
}

export function excelDateParts(serial: number): ExcelDateParts | null {
  if (!Number.isFinite(serial) || serial < 0 || serial >= MAX_EXCEL_SERIAL) return null
  const wholeDays = Math.floor(serial)
  const dayFraction = serial - wholeDays
  const milliseconds = Math.round(dayFraction * DAY_MS)
  if (wholeDays === 60) {
    if (milliseconds >= DAY_MS) return excelDateParts(61)
    return { year: 1900, month: 2, day: 29, hour: Math.floor(milliseconds / 3_600_000), minute: Math.floor(milliseconds / 60_000) % 60, second: Math.floor(milliseconds / 1000) % 60, millisecond: milliseconds % 1000 }
  }
  const date = new Date(EXCEL_EPOCH + (wholeDays - (wholeDays > 60 ? 1 : 0)) * DAY_MS + (milliseconds >= DAY_MS ? DAY_MS : milliseconds))
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) return null
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(), millisecond: date.getUTCMilliseconds() }
}

export function excelSerialFromParts(yearValue: number, monthValue: number, dayValue: number): number | null {
  if (![yearValue, monthValue, dayValue].every(Number.isFinite)) return null
  let year = Math.trunc(yearValue)
  const month = Math.trunc(monthValue)
  const day = Math.trunc(dayValue)
  if (year < 0 || year > 9999) return null
  if (year < 1900) year += 1900
  if (year === 1900 && month === 2 && day === 29) return 60
  const date = new Date(Date.UTC(0, 0, 1))
  date.setUTCFullYear(year, month - 1, day)
  if (date.getUTCFullYear() < 1900 || date.getUTCFullYear() > 9999) return null
  const serial = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - EXCEL_EPOCH) / DAY_MS) + (date.getUTCFullYear() > 1900 || date.getUTCFullYear() === 1900 && date.getUTCMonth() >= 2 ? 1 : 0)
  return serial >= 0 && serial < MAX_EXCEL_SERIAL ? serial : null
}

export function excelSerialToDate(serial: number): Date | null {
  const parts = excelDateParts(serial)
  if (!parts || parts.year === 1900 && parts.month === 2 && parts.day === 29) return null
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond))
  return Number.isFinite(date.getTime()) ? date : null
}
