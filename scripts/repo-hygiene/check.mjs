#!/usr/bin/env node
// Repo hygiene gate (A0-01). Zero dependencies.
// - Lists every file Git would version (tracked + untracked-not-ignored).
// - Fails if any file exceeds the size limit (default 5 MB).
// - Fails if any versionable file matches a secret pattern.
// Usage: node scripts/repo-hygiene/check.mjs [--max-mb=5] [--json]
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const maxMb = Number(args.find((a) => a.startsWith('--max-mb='))?.split('=')[1] ?? 5);
const asJson = args.includes('--json');
const MAX_BYTES = maxMb * 1024 * 1024;
const SCAN_LIMIT_BYTES = MAX_BYTES; // files above the limit already fail; don't scan them

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function gitList(extra) {
  const out = execFileSync('git', ['-c', 'core.quotepath=off', 'ls-files', '-z', ...extra], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

const files = [...new Set([...gitList([]), ...gitList(['--others', '--exclude-standard'])])].sort();

/** @type {{ name: string, re: RegExp }[]} */
const SECRET_PATTERNS = [
  { name: 'aws-access-key-id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'aws-presigned-credential', re: /X-Amz-Credential=[A-Za-z0-9%/_-]{10,}/ },
  { name: 'openai-style-key', re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
  { name: 'github-fine-grained-pat', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { name: 'private-key-block', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
];

const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|mp4|webm|mov|mp3|wav|ogg|woff2?|ttf|otf|eot|pdf|zip|gz|7z|wasm|sqlite|db)$/i;

let totalBytes = 0;
const missing = [];
const oversized = [];
const secrets = [];

for (const rel of files) {
  const abs = resolve(root, rel);
  let size;
  try {
    size = statSync(abs).size;
  } catch {
    missing.push(rel); // tracked but deleted in working tree
    continue;
  }
  totalBytes += size;
  if (size > MAX_BYTES) {
    oversized.push({ file: rel, mb: +(size / 1048576).toFixed(2) });
    continue;
  }
  if (BINARY_EXT.test(rel) || size > SCAN_LIMIT_BYTES) continue;
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue; // binary content
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const { name, re } of SECRET_PATTERNS) {
      const m = re.exec(lines[i]);
      if (m) {
        const v = m[0];
        const redacted = v.length > 12 ? `${v.slice(0, 8)}…${v.slice(-2)}` : v;
        secrets.push({ file: rel, line: i + 1, pattern: name, match: redacted });
      }
    }
  }
}

const summary = {
  files: files.length - missing.length,
  totalMb: +(totalBytes / 1048576).toFixed(2),
  maxMb,
  oversized,
  secrets,
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`repo-hygiene: ${summary.files} versionable files, ${summary.totalMb} MB total (limit ${maxMb} MB/file)`);
  for (const o of oversized) console.log(`  OVERSIZED ${o.mb} MB  ${o.file}`);
  for (const s of secrets) console.log(`  SECRET [${s.pattern}] ${s.file}:${s.line}  ${s.match}`);
  if (!oversized.length && !secrets.length) console.log('repo-hygiene: OK');
}

process.exit(oversized.length || secrets.length ? 1 : 0);
