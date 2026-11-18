#!/usr/bin/env node
// Verifica licencas das dependencias de producao via `pnpm licenses list --json --prod`.
// Falha em licencas proibidas ou desconhecidas. Excecoes revisadas vao em ALLOW_PACKAGES.
// Uso: node .github/scripts/check-licenses.mjs [--all] (inclui devDependencies)
import { execFileSync } from 'node:child_process';

/** Licencas (SPDX) aceitas. O app e AGPL-3.0, entao copyleft compativel e permitido. */
const ALLOWED = new Set([
  '0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'CC-BY-3.0',
  'CC-BY-4.0', 'ISC', 'MIT', 'MIT-0', 'MPL-2.0', 'OFL-1.1', 'Python-2.0', 'Unlicense', 'WTFPL',
  'Zlib', 'LGPL-2.1', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0', 'LGPL-3.0-only',
  'LGPL-3.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later', 'AGPL-3.0', 'AGPL-3.0-only',
  'AGPL-3.0-or-later', 'Artistic-2.0', 'BSD', 'CC-BY-SA-4.0', 'MIT/X11',
]);
/** Pacotes revisados manualmente (nome -> motivo). */
const ALLOW_PACKAGES = new Map([
  ['buffers', 'Sem campo license no package.json; o README do autor declara MIT/X11 (dependencia transitiva antiga).'],
]);

const args = process.argv.slice(2);
const pnpmArgs = ['licenses', 'list', '--json', ...(args.includes('--all') ? [] : ['--prod'])];
const raw = execFileSync('pnpm', pnpmArgs, {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  shell: process.platform === 'win32',
});
/** @type {Record<string, { name: string, versions?: string[], version?: string }[]>} */
const byLicense = raw.trim() ? JSON.parse(raw) : {};

/** Avalia expressao SPDX simples: "(A OR B)", "A AND B". */
function accepted(expr) {
  const clean = expr.replace(/[()]/g, ' ').trim();
  if (/\sOR\s/i.test(clean)) return clean.split(/\s+OR\s+/i).some(accepted);
  if (/\sAND\s/i.test(clean)) return clean.split(/\s+AND\s+/i).every(accepted);
  return ALLOWED.has(clean.replace(/\*$/, ''));
}

const problems = [];
let count = 0;
for (const [license, pkgs] of Object.entries(byLicense)) {
  for (const pkg of pkgs) {
    count += 1;
    if (pkg.name.startsWith('@fuse/') || ALLOW_PACKAGES.has(pkg.name)) continue;
    if (!accepted(license)) {
      problems.push(`${pkg.name}@${(pkg.versions ?? [pkg.version]).join(',')}: ${license}`);
    }
  }
}

console.log(`Licencas verificadas: ${count} pacote(s) em ${Object.keys(byLicense).length} licenca(s).`);
if (problems.length) {
  console.error(`\n${problems.length} pacote(s) com licenca nao permitida ou desconhecida:`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nRevise e, se aceitavel, adicione em ALLOW_PACKAGES com o motivo.');
  process.exit(1);
}
console.log('Nenhuma licenca proibida encontrada.');
