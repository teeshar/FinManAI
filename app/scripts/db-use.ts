/**
 * Switch which database the app talks to.
 *
 *   npm run db:use test    → finmanai_test, throwaway, what the suites write to
 *   npm run db:use live    → finmanai_live, your real records
 *   npm run db:use testdb  → the original finmanai database, kept for reference
 *
 * **This merges; it does not overwrite.** Only the handful of keys in
 * `.env.db.<name>` are replaced — the database URL and the encryption keys that
 * must travel with it. Everything else in `.env` is left exactly as it is.
 *
 * That distinction is the whole point of this file's second draft. The first
 * copied a complete `.env.<name>` over `.env`, which silently destroyed
 * anything added since — Google credentials, SMTP settings, an advisory-mode
 * change. Losing a setting to a command that claims only to switch databases is
 * a very unpleasant way to spend an evening, and nothing about it looks like the
 * cause.
 *
 * Encryption keys move with the database because ciphertext written under one
 * key cannot be read with another. Keeping them together is what stops a test
 * database ever being read as the real one.
 *
 * Restart `npm run dev` afterwards — the server reads `.env` once, at boot.
 *
 * Switching also checks for pending migrations, because a migration authored
 * while pointed at one database leaves the others behind, and the symptom
 * arrives much later as a 500 reading `The table public.X does not exist`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(appRoot, '.env');
const target = process.argv[2];

const PROFILES = ['live', 'test', 'testdb'];
const profilePath = (name: string) => join(appRoot, `.env.db.${name}`);

function parse(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

const dbNameOf = (text: string) =>
  /DATABASE_URL\s*=\s*"?[^"]*\/([^"?/]+)/.exec(text)?.[1] ?? 'unknown';

/* ---------------------------------------------------------------- */

if (!target) {
  console.log('Usage: npm run db:use <name>\n');
  for (const name of PROFILES) {
    if (!existsSync(profilePath(name))) continue;
    console.log(`  ${name.padEnd(8)} → ${dbNameOf(readFileSync(profilePath(name), 'utf8'))}`);
  }
  console.log(`\nCurrently active: ${dbNameOf(readFileSync(envPath, 'utf8'))}`);
  console.log('\nSwitching replaces only the database settings. Everything else in .env is kept.');
  process.exit(0);
}

const source = profilePath(target);
if (!existsSync(source)) {
  console.error(
    `No .env.db.${target}. Pick one of: ${PROFILES.join(', ')} — or create the file.`,
  );
  process.exit(1);
}

const incoming = parse(readFileSync(source, 'utf8'));
const current = readFileSync(envPath, 'utf8');

// Keep a copy of what was there. Cheap, and the one thing you want if a switch
// ever does go wrong.
copyFileSync(envPath, join(appRoot, '.env.backup'));

const seen = new Set<string>();
const merged = current
  .split('\n')
  .map((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (!m || !incoming.has(m[1])) return line;
    seen.add(m[1]);
    return `${m[1]}=${incoming.get(m[1])}`;
  })
  .join('\n');

// Anything the profile defines that .env did not have yet.
const additions = [...incoming.entries()]
  .filter(([k]) => !seen.has(k))
  .map(([k, v]) => `${k}=${v}`);

writeFileSync(
  envPath,
  merged + (additions.length ? `\n# Added by db:use ${target}\n${additions.join('\n')}\n` : ''),
);

const database = dbNameOf(readFileSync(envPath, 'utf8'));
console.log(
  `Now pointing at ${database}.\n` +
    `Replaced ${seen.size + additions.length} database setting(s); the rest of .env is untouched.`,
);

try {
  const status = execFileSync('npx', ['prisma', 'migrate', 'status'], {
    cwd: appRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!/up to date/i.test(status)) {
    console.log(
      `\n\x1b[33m!\x1b[0m ${database} has migrations that have not been applied.\n` +
        `  Run:  npx prisma migrate deploy`,
    );
  }
} catch {
  console.log(`\n\x1b[33m!\x1b[0m Could not confirm ${database} is migrated. Run:  npx prisma migrate deploy`);
}

console.log(`\nRestart the dev server — it reads .env only at boot.`);
