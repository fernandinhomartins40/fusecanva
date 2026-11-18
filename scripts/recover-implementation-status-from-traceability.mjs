import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const trace = fs.readFileSync(path.join(root, 'IMPLEMENTATION-TRACEABILITY.md'), 'utf8')
const tableStart = trace.indexOf('| Caso |')
if (tableStart < 0) throw new Error('Could not find the formal case table')

const status = {}
for (const line of trace.slice(tableStart).split(/\r?\n/)) {
  const match = line.match(/^\| `([^`]+)` \|/)
  if (!match) continue
  const cells = line.slice(1, -1).split(/(?<!\\)\|/).map(cell => cell.trim().replaceAll('\\|', '|'))
  const implementationStatus = cells[3]
  if (implementationStatus && implementationStatus !== 'Pendente de validacao de equivalencia') {
    status[match[1]] = { status: implementationStatus }
  }
}

if (Object.keys(status).length === 0) throw new Error('No recorded implementation statuses were recoverable')
fs.writeFileSync(path.join(root, 'IMPLEMENTATION-STATUS.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8')
console.log(`Recovered ${Object.keys(status).length} statuses from the generated traceability table.`)
