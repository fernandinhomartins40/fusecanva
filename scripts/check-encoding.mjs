#!/usr/bin/env node
// Encoding guard for the repository.
//
// Usage:
//   node scripts/check-encoding.mjs                 # scan repo, exit 1 on mojibake
//   node scripts/check-encoding.mjs --fix <files>   # repair mojibake in the given files
//
// Mojibake = UTF-8 bytes decoded as Windows-1252/Latin-1 (possibly several times),
// e.g. the two-character pair U+00C3 U+00A7 instead of "ç".
// The repair only rewrites a sequence when re-encoding it as Windows-1252 yields a
// strictly valid multi-byte UTF-8 sequence; everything else is left untouched.
// Characters already lost (U+FFFD or "?") cannot be recovered and are only reported.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const EXTENSIONS = new Set([".md", ".json", ".ts", ".tsx", ".mjs"]);
const IGNORED_DIRS = new Set([
  "node_modules",
  "analysis",
  "visual-references",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  "artifacts",
  "test-results",
  "playwright-report",
]);
const MAX_BYTES = 5 * 1024 * 1024;
// Files that intentionally contain mojibake signatures (encoding detectors and their tests).
const ALLOWLIST = new Set([
  "scripts/check-encoding.mjs",
  "apps/web/scripts/normalize-source-text.mjs",
  "apps/web/tests/source-encoding.test.mjs",
  "apps/web/tests/iconography-static.test.mjs",
]);

// Windows-1252 code points for bytes 0x80..0x9F (undefined bytes map to C1 controls, as in Latin-1).
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];
const CHAR_TO_BYTE = new Map();
for (let b = 0x80; b <= 0xff; b += 1) {
  CHAR_TO_BYTE.set(b < 0xa0 ? CP1252_HIGH[b - 0x80] : b, b);
}
// Also accept raw C1 controls (Latin-1 decoding) for every 0x80..0x9F byte.
for (let b = 0x80; b < 0xa0; b += 1) {
  if (!CHAR_TO_BYTE.has(b)) CHAR_TO_BYTE.set(b, b);
}

/** Decode one strict UTF-8 multi-byte sequence starting at bytes[i]; returns [codePoint, length] or null. */
function decodeAt(bytes, i) {
  const b0 = bytes[i];
  let len;
  let min;
  let cp;
  if (b0 >= 0xc2 && b0 <= 0xdf) [len, min, cp] = [2, 0x80, b0 & 0x1f];
  else if (b0 >= 0xe0 && b0 <= 0xef) [len, min, cp] = [3, 0x800, b0 & 0x0f];
  else if (b0 >= 0xf0 && b0 <= 0xf4) [len, min, cp] = [4, 0x10000, b0 & 0x07];
  else return null;
  if (i + len > bytes.length) return null;
  for (let k = 1; k < len; k += 1) {
    const b = bytes[i + k];
    if (b === null || b < 0x80 || b > 0xbf) return null;
    cp = (cp << 6) | (b & 0x3f);
  }
  if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
  return [cp, len];
}

/** One repair pass over a run of non-ASCII characters. */
function repairRun(run) {
  const chars = Array.from(run);
  const bytes = chars.map((c) => {
    const b = CHAR_TO_BYTE.get(c.codePointAt(0));
    return b === undefined ? null : b;
  });
  let out = "";
  let i = 0;
  while (i < chars.length) {
    const hit = bytes[i] === null ? null : decodeAt(bytes, i);
    if (hit) {
      out += String.fromCodePoint(hit[0]);
      i += hit[1];
    } else {
      out += chars[i];
      i += 1;
    }
  }
  return out;
}

const NON_ASCII_RUN = /[^\x00-\x7f]+/g;

/** Repairs (possibly multi-layer) mojibake. Returns the fixed text. */
export function repairMojibake(text) {
  let current = text;
  for (let pass = 0; pass < 16; pass += 1) {
    const next = current.replace(NON_ASCII_RUN, repairRun);
    if (next === current) break;
    current = next;
  }
  return current;
}

// Typical mojibake signatures: a UTF-8 lead byte rendered as Latin-1/CP1252 followed by a
// continuation-byte character. Portuguese/English prose never contains these pairs.
const CONT = "\u0080-¿€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const MOJIBAKE = new RegExp(`[Â-ß][${CONT}]|[à-ï][${CONT}]{2}|[ð-ô][${CONT}]{3}`, "u");
const MOJIBAKE_G = new RegExp(MOJIBAKE.source, "gu");

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
    } else if (entry.isFile() && EXTENSIONS.has(extname(entry.name))) {
      yield join(dir, entry.name);
    }
  }
}

function scan() {
  let bad = 0;
  let lost = 0;
  let files = 0;
  for (const file of walk(ROOT)) {
    if (statSync(file).size > MAX_BYTES) continue;
    files += 1;
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (ALLOWLIST.has(rel)) continue;
    const buf = readFileSync(file);
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      console.error(`${rel}: UTF-8 BOM`);
      bad += 1;
    }
    const lines = buf.toString("utf8").split("\n");
    lines.forEach((line, idx) => {
      const m = line.match(MOJIBAKE);
      if (m) {
        bad += 1;
        const col = (m.index ?? 0) + 1;
        console.error(`${rel}:${idx + 1}:${col}: mojibake ${JSON.stringify(line.slice(Math.max(0, col - 11), col + 19))}`);
      }
      if (line.includes("�")) lost += 1;
    });
  }
  console.log(`check-encoding: ${files} files scanned, ${bad} problem(s), ${lost} line(s) with U+FFFD (lost characters, warning only)`);
  return bad === 0;
}

function fix(paths) {
  for (const p of paths) {
    const file = resolve(p);
    const before = readFileSync(file, "utf8").replace(/^﻿/, "");
    const after = repairMojibake(before);
    const left = (after.match(MOJIBAKE_G) ?? []).length;
    if (extname(file) === ".json" && before.trim() !== "") JSON.parse(after);
    if (after !== before) writeFileSync(file, after, "utf8");
    console.log(`${relative(ROOT, file)}: ${before.length} -> ${after.length} chars, remaining signatures: ${left}`);
  }
}

const args = process.argv.slice(2);
if (args[0] === "--fix") {
  fix(args.slice(1));
} else if (!scan()) {
  process.exitCode = 1;
}
