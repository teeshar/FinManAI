/**
 * Golden-file regression tests.
 *
 * Snapshots the full plan for every persona. Any engine change that moves a
 * number shows up here as an explicit diff that a human must approve. This is
 * the closest thing software has to a regression suite for financial advice —
 * an "improvement" that silently changes 200 households' retirement SIPs is
 * exactly the failure mode we are guarding against.
 *
 * Run:            node --experimental-strip-types tests/golden.ts
 * Accept changes: node --experimental-strip-types tests/golden.ts --update
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePlan } from '../src/engine.ts';
import { ALL_PERSONAS } from '../fixtures/personas.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, '..', 'golden');
const TODAY = '2026-08-18';
const UPDATE = process.argv.includes('--update');

if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });

/** Flatten the plan into comparable key→value lines so diffs are readable. */
function flatten(obj: unknown, prefix = ''): string[] {
  const out: string[] = [];
  if (obj === null || obj === undefined) {
    out.push(`${prefix} = ${obj}`);
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => out.push(...flatten(v, `${prefix}[${i}]`)));
  } else if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out.push(...flatten(v, prefix ? `${prefix}.${k}` : k));
    }
  } else if (typeof obj === 'string') {
    // Prose is allowed to change without failing the suite; numbers are not.
    out.push(`${prefix} = <text:${obj.length}ch>`);
  } else {
    out.push(`${prefix} = ${obj}`);
  }
  return out;
}

let changed = 0;
let unchanged = 0;
const diffs: string[] = [];

for (const persona of ALL_PERSONAS) {
  const plan = generatePlan(persona.profile, { today: TODAY });
  const lines = flatten(plan).sort();
  const file = join(GOLDEN_DIR, `${persona.key}.golden`);

  if (!existsSync(file) || UPDATE) {
    writeFileSync(file, lines.join('\n') + '\n');
    console.log(`\x1b[33m↻\x1b[0m wrote ${persona.key}.golden (${lines.length} values)`);
    changed++;
    continue;
  }

  const previous = readFileSync(file, 'utf8').trim().split('\n');
  const prevMap = new Map(previous.map((l) => [l.split(' = ')[0], l.split(' = ')[1]]));
  const currMap = new Map(lines.map((l) => [l.split(' = ')[0], l.split(' = ')[1]]));

  const localDiffs: string[] = [];
  for (const [k, v] of currMap) {
    const before = prevMap.get(k);
    if (before === undefined) localDiffs.push(`  + ${k} = ${v}`);
    else if (before !== v) localDiffs.push(`  ~ ${k}: ${before} → ${v}`);
  }
  for (const k of prevMap.keys()) if (!currMap.has(k)) localDiffs.push(`  − ${k}`);

  if (localDiffs.length === 0) {
    console.log(`\x1b[32m✓\x1b[0m ${persona.key} unchanged (${lines.length} values)`);
    unchanged++;
  } else {
    console.log(`\x1b[31m✗\x1b[0m ${persona.key} — ${localDiffs.length} value(s) changed`);
    diffs.push(`\n${persona.key}:\n${localDiffs.slice(0, 25).join('\n')}`);
    changed++;
  }
}

console.log('─'.repeat(72));
if (diffs.length > 0) {
  console.log(diffs.join('\n'));
  console.log('─'.repeat(72));
  console.log(
    `\x1b[31m${changed} persona(s) changed.\x1b[0m Review every line above. If the change is intended, ` +
      `re-run with --update and commit the new golden files alongside the code change.`,
  );
  process.exit(1);
}
console.log(`\x1b[32m${unchanged} persona(s) unchanged, ${changed} written.\x1b[0m`);
