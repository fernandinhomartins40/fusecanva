#!/usr/bin/env node
// Executa os roteiros "test:browser:*" de @fuse/web distribuidos em shards.
// Env: SHARD_INDEX (1..N), SHARD_TOTAL (N), FILTER (regex opcional), WEB_DIR (padrao apps/web).
// Uso local: SHARD_INDEX=1 SHARD_TOTAL=4 node .github/scripts/run-browser-shard.mjs --list
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const webDir = resolve(process.env.WEB_DIR ?? 'apps/web');
const total = Math.max(1, Number(process.env.SHARD_TOTAL ?? 1));
const index = Number(process.env.SHARD_INDEX ?? 1);
if (!Number.isInteger(index) || index < 1 || index > total) {
  console.error(`SHARD_INDEX invalido: ${process.env.SHARD_INDEX} (total ${total})`);
  process.exit(2);
}
const filter = process.env.FILTER ? new RegExp(process.env.FILTER) : null;
const listOnly = process.argv.includes('--list');

const pkg = JSON.parse(readFileSync(resolve(webDir, 'package.json'), 'utf8'));
const all = Object.keys(pkg.scripts ?? {})
  .filter((name) => name.startsWith('test:browser:'))
  .filter((name) => !filter || filter.test(name))
  .sort();
const mine = all.filter((_, i) => i % total === index - 1);

console.log(`Shard ${index}/${total}: ${mine.length} de ${all.length} roteiros`);
for (const name of mine) console.log(`  - ${name}`);
if (listOnly) process.exit(0);

const failed = [];
for (const name of mine) {
  console.log(`\n::group::${name}`);
  const started = Date.now();
  const res = spawnSync('pnpm', ['run', name], { cwd: webDir, stdio: 'inherit', shell: process.platform === 'win32' });
  console.log('::endgroup::');
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (res.status === 0) console.log(`OK   ${name} (${secs}s)`);
  else {
    console.log(`FALHA ${name} (${secs}s, status ${res.status ?? res.signal})`);
    failed.push(name);
  }
}
if (failed.length) {
  console.error(`\n${failed.length} roteiro(s) falharam:\n${failed.map((n) => `  - ${n}`).join('\n')}`);
  process.exit(1);
}
console.log('\nTodos os roteiros do shard passaram.');
