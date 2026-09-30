/**
 * Back up, and prove the backup restores.
 *
 * Phase 6 lists this as "backup and restore, tested", and the emphasis is the
 * whole point: **an untested restore is not a backup.** The failure people
 * actually have is not a missing dump — it is a dump that has been running
 * nightly for two years and cannot be loaded, discovered on the worst possible
 * day.
 *
 * So this script does not stop at `pg_dump`. With `--verify` it restores the
 * dump into a scratch database, counts the rows, re-verifies the audit chain
 * inside the restored copy, and then drops it. A backup that has not survived
 * that round trip is reported as unverified.
 *
 * Field encryption means the dump contains ciphertext, not financial data — but
 * it still contains email addresses, hashed IPs and the audit trail. Treat the
 * file as sensitive, store it encrypted at rest, and never keep it beside the
 * keys that decrypt its contents.
 *
 * Usage:
 *   node --experimental-strip-types scripts/backup.ts                 # dump only
 *   node --experimental-strip-types scripts/backup.ts --verify        # dump, restore, check, drop
 *   node --experimental-strip-types scripts/backup.ts --out /srv/backups
 */

import './env.ts';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { verifyChain } from '../../core/src/audit.ts';
import type { AuditEvent, AuditAction } from '../../core/src/audit.ts';

const args = process.argv.slice(2);
const verify = args.includes('--verify');
const outArg = args.indexOf('--out');
const outDir = outArg > -1 ? args[outArg + 1] : join(process.cwd(), 'backups');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Refusing to guess where your data lives.');
  process.exit(1);
}

/**
 * Prisma's connection string carries parameters libpq has never heard of —
 * `schema`, `connection_limit`, `pgbouncer` and friends — and `pg_dump` rejects
 * the whole URL rather than ignoring them. Strip them before handing the string
 * to any Postgres command-line tool.
 */
const PRISMA_ONLY_PARAMS = [
  'schema', 'connection_limit', 'pool_timeout', 'socket_timeout',
  'pgbouncer', 'statement_cache_size', 'sslidentity', 'sslcert', 'sslpassword',
];

function forLibpq(connectionString: string): string {
  const u = new URL(connectionString);
  for (const p of PRISMA_ONLY_PARAMS) u.searchParams.delete(p);
  return u.toString();
}

const parsed = new URL(url);
const dbName = parsed.pathname.replace(/^\//, '');
const pgUrl = forLibpq(url);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = join(outDir, `finmanai-${dbName}-${stamp}.dump`);

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const run = (cmd: string, cmdArgs: string[]) =>
  execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/* 1. Dump ----------------------------------------------------------- */

console.log(`Dumping ${dbName} → ${file}`);
try {
  // Custom format: compressed, and restorable selectively, which matters when
  // you need one table back rather than the whole database.
  run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', file, pgUrl]);
} catch (err) {
  console.error(`\x1b[31mpg_dump failed.\x1b[0m ${(err as Error).message}`);
  process.exit(1);
}

const size = statSync(file).size;
console.log(`\x1b[32m✓\x1b[0m Wrote ${(size / 1024 / 1024).toFixed(2)} MB`);

if (!verify) {
  console.log(
    `\n\x1b[33m!\x1b[0m Not verified. Run with --verify at least monthly — a dump that has ` +
      `never been restored is a file, not a backup.`,
  );
  process.exit(0);
}

/* 2. Restore into a scratch database --------------------------------- */

const scratch = `finmanai_restore_check_${Date.now()}`;
const adminUrl = new URL(pgUrl);
adminUrl.pathname = '/postgres';
const scratchUrl = new URL(pgUrl);
scratchUrl.pathname = `/${scratch}`;

console.log(`\nRestoring into scratch database ${scratch}`);
let restoreProblems = 0;

try {
  run('psql', [adminUrl.toString(), '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${scratch}"`]);

  try {
    run('pg_restore', ['--no-owner', '--no-acl', '--dbname', scratchUrl.toString(), file]);
  } catch (err) {
    // pg_restore warns on things that are not fatal (extensions, ownership).
    // Only treat it as a failure if the data did not actually arrive, which the
    // checks below establish.
    console.warn(`\x1b[33m!\x1b[0m pg_restore reported issues: ${(err as Error).message.split('\n')[0]}`);
  }

  /* 3. Is the restored copy actually usable? ------------------------- */

  const { PrismaClient } = await import('@prisma/client');
  const restored = new PrismaClient({ datasources: { db: { url: scratchUrl.toString() } } });

  const [users, profiles, plans, auditRows] = await Promise.all([
    restored.user.count(),
    restored.profile.count(),
    restored.plan.count(),
    restored.auditEvent.findMany({ orderBy: { sequence: 'asc' } }),
  ]);

  console.log(
    `\x1b[32m✓\x1b[0m Restored: ${users} users, ${profiles} profiles, ${plans} plans, ` +
      `${auditRows.length} audit events`,
  );

  // The check that matters. A restore that loads rows but breaks the chain has
  // produced a database you cannot prove anything with.
  const events: AuditEvent[] = auditRows.map((r) => ({
    sequence: r.sequence,
    userId: r.userId,
    actorId: r.actorId,
    action: r.action as AuditAction,
    entityType: r.entityType,
    entityId: r.entityId,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    createdAt: r.createdAt.toISOString(),
    ipHash: r.ipHash,
    prevHash: r.prevHash,
    hash: r.hash,
  }));

  const chain = verifyChain(events);
  if (chain.valid) {
    console.log(`\x1b[32m✓\x1b[0m Audit chain verifies inside the restored copy (${chain.checked} events)`);
  } else {
    restoreProblems++;
    console.error(`\x1b[31m✗ Restored chain is broken at ${chain.brokenAt}: ${chain.reason}\x1b[0m`);
  }

  if (users === 0 && profiles === 0) {
    restoreProblems++;
    console.error('\x1b[31m✗ The restored database is empty. This backup is not usable.\x1b[0m');
  }

  await restored.$disconnect();
} finally {
  // Always drop the scratch database, including after a failure — leaving
  // copies of client data lying around is its own incident.
  try {
    run('psql', [adminUrl.toString(), '-c', `DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`]);
    console.log(`\x1b[32m✓\x1b[0m Scratch database dropped`);
  } catch (err) {
    console.error(
      `\x1b[31m✗ Could not drop ${scratch}.\x1b[0m Drop it by hand — it holds a full copy of ` +
        `client data. ${(err as Error).message}`,
    );
    restoreProblems++;
  }
}

console.log('\n' + '─'.repeat(70));
if (restoreProblems === 0) {
  console.log(`\x1b[32mBackup verified.\x1b[0m ${file}`);
} else {
  console.error(`\x1b[31mBackup could NOT be verified.\x1b[0m Do not rely on ${file}.`);
}
process.exit(restoreProblems === 0 ? 0 : 1);
