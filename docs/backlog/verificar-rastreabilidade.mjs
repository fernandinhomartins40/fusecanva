// Verifica a rastreabilidade entre o backlog e os 131 casos de origem.
// Uso: node docs/backlog/verificar-rastreabilidade.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const cases = Object.keys(JSON.parse(readFileSync(join(root, 'IMPLEMENTATION-STATUS.json'), 'utf8')));
const rows = readFileSync(join(here, 'rastreabilidade.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
const storyIds = new Set();
for (const f of readdirSync(here).filter((f) => /^d\d\d-.*\.md$/.test(f))) {
  for (const m of readFileSync(join(here, f), 'utf8').matchAll(/^## (US-\d{3}) /gm)) storyIds.add(m[1]);
}
const covered = new Set(rows.map((r) => r[1]).filter(Boolean));
const missing = cases.filter((c) => !covered.has(c));
const unknown = [...covered].filter((c) => !cases.includes(c));
const orphanUs = [...new Set(rows.map((r) => r[0]))].filter((u) => !storyIds.has(u));
const badRows = rows.filter((r) => r.length !== 4 || !/^US-\d{3}$/.test(r[0]) || !/^D\d\d$/.test(r[2]) || !/^[0-6]$/.test(r[3]));

console.log(`casos_no_status=${cases.length}`);
console.log(`casos_cobertos=${cases.length - missing.length}`);
console.log(`historias_nos_md=${storyIds.size}`);
console.log(`linhas_csv=${rows.length}`);
if (missing.length) console.log('FALTANDO:', missing.join(' '));
if (unknown.length) console.log('DESCONHECIDOS:', unknown.join(' '));
if (orphanUs.length) console.log('US_SEM_HISTORIA:', orphanUs.join(' '));
if (badRows.length) console.log('LINHAS_INVALIDAS:', badRows.length);
const ok = !missing.length && !unknown.length && !orphanUs.length && !badRows.length;
console.log(ok ? 'OK' : 'FALHOU');
process.exit(ok ? 0 : 1);
