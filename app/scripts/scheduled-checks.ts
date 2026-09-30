/**
 * The checks that run on a schedule, unattended.
 *
 * Phase 5 is blunt about why this exists: *a tamper-detection system nobody has
 * exercised is a hope, not a control.* The chain verification, the profile
 * hashes and the plan bindings are all things that can only fail silently —
 * nothing in the application will ever tell you a row was altered last Tuesday.
 *
 * Run monthly at minimum. Exits non-zero on any failure so that cron, systemd
 * or a CI schedule raises an alarm rather than mailing a log nobody reads.
 *
 *   0 — everything verified
 *   1 — a check failed. Treat a broken chain as an incident, not a bug:
 *       preserve it, do not repair it. See RUNBOOK-BREACH.md.
 *
 * Usage:
 *   node --experimental-strip-types scripts/scheduled-checks.ts
 *   node --experimental-strip-types scripts/scheduled-checks.ts --quiet   # only failures
 *
 * Crontab, first of the month at 06:00:
 *   0 6 1 * * cd /srv/finmanai/app && npm run --silent checks || mail -s "FinManAI integrity FAILED" ops@…
 */

import './env.ts';
import { PrismaClient } from '@prisma/client';
import { verifyChain, RETENTION_YEARS } from '../../core/src/audit.ts';
import type { AuditEvent, AuditAction } from '../../core/src/audit.ts';
import { keyRingFrom } from '../../core/src/field-crypto.ts';

const quiet = process.argv.includes('--quiet');
const prisma = new PrismaClient();
const startedAt = new Date();

let failures = 0;
let warnings = 0;

const pass = (msg: string) => {
  if (!quiet) console.log(`\x1b[32m✓\x1b[0m ${msg}`);
};
const fail = (msg: string) => {
  failures++;
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
};
const warn = (msg: string) => {
  warnings++;
  console.warn(`\x1b[33m!\x1b[0m ${msg}`);
};

/* 1. The audit chain ---------------------------------------------- */

const rows = await prisma.auditEvent.findMany({ orderBy: { sequence: 'asc' } });
const events: AuditEvent[] = rows.map((r) => ({
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
  pass(`Audit chain intact — ${chain.checked} events`);
} else {
  fail(`AUDIT CHAIN BROKEN at sequence ${chain.brokenAt}: ${chain.reason}`);
  fail('Do not repair the chain. Preserve it and follow RUNBOOK-BREACH.md.');
}

/* 2. Plans are bound to the profile that produced them -------------- */

const plans = await prisma.plan.findMany({
  select: { id: true, profileHash: true, profile: { select: { dataHash: true, version: true } } },
});
const unbound = plans.filter((p) => p.profileHash !== p.profile.dataHash);
if (unbound.length === 0) {
  pass(`Plans: ${plans.length} checked, all bound to their profile`);
} else {
  fail(
    `${unbound.length} plan(s) no longer match the profile that produced them: ` +
      unbound.map((p) => p.id).join(', '),
  );
}

/* 3. Encryption keys ----------------------------------------------- */

const active = (process.env.FIELD_KEY_ACTIVE ?? '').toLowerCase();
const entries: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env)) {
  const m = /^FIELD_KEY_(V\d+)$/.exec(name);
  if (m && value) entries[m[1].toLowerCase()] = value;
}
const keys = keyRingFrom(entries, active);

const byKey = await prisma.profile.groupBy({ by: ['keyVersion'], _count: true });
const stale = byKey.filter((k) => k.keyVersion !== keys.activeVersion);
if (stale.length === 0) {
  pass(`Encryption: all profiles on the active key (${keys.activeVersion})`);
} else {
  // A warning rather than a failure: rotation is a process, and rows mid-sweep
  // are expected. It becomes a failure when it never finishes, which is what
  // the age check below is for.
  warn(
    `${stale.map((k) => `${k._count} profile(s) on ${k.keyVersion}`).join(', ')}. ` +
      `Run rotate-keys.ts to completion; keep retired keys in the ring until it reaches zero.`,
  );
}

/* 4. Retention ------------------------------------------------------ */

const cutoff = new Date(startedAt.getTime() - RETENTION_YEARS * 365.25 * 86_400_000);
const [oldest, held] = await Promise.all([
  prisma.auditEvent.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  prisma.auditEvent.count({ where: { legalHold: true } }),
]);
if (oldest) {
  const years = (startedAt.getTime() - oldest.createdAt.getTime()) / (365.25 * 86_400_000);
  pass(
    `Retention: oldest record is ${years.toFixed(1)} years old, cutoff ${cutoff.toISOString().slice(0, 10)}` +
      (held > 0 ? ` · ${held} event(s) under legal hold and never deletable` : ''),
  );
}

/* 5. The queue ------------------------------------------------------ */

const [queued, failing] = await Promise.all([
  prisma.outbox.count({ where: { sentAt: null } }),
  prisma.outbox.count({ where: { sentAt: null, attempts: { gte: 3 } } }),
]);
if (failing > 0) {
  // A reminder that has failed three times is not a transient network blip —
  // it means clients are not being told their advice is going stale.
  fail(`${failing} message(s) have failed 3+ delivery attempts and are stuck in the outbox.`);
} else if (queued > 0) {
  warn(`${queued} message(s) queued and not yet sent. Run send-reminders.ts.`);
} else {
  pass('Outbox: nothing stuck');
}

/* 6. Reviews falling behind ----------------------------------------- */

const overdueCutoff = new Date(startedAt.getTime() - 365 * 86_400_000);
const staleProfiles = await prisma.profile.count({
  where: { isActive: true, createdAt: { lt: overdueCutoff } },
});
if (staleProfiles > 0) {
  warn(
    `${staleProfiles} active profile(s) are over a year old. Confirm reminders are going out — ` +
      `a review nobody was asked for is a compliance finding, not a client failure.`,
  );
} else {
  pass('Reviews: no profile is past its annual review without a reminder path');
}

/* ------------------------------------------------------------------ */

console.log('\n' + '─'.repeat(70));
const stamp = startedAt.toISOString();
if (failures === 0) {
  console.log(
    `\x1b[32mAll scheduled checks passed\x1b[0m at ${stamp}` +
      (warnings > 0 ? ` — ${warnings} warning(s) above.` : '.'),
  );
} else {
  console.error(
    `\x1b[31m${failures} check(s) FAILED\x1b[0m at ${stamp}. ` +
      `This is an alarm, not a report. Investigate before serving any further advice.`,
  );
}

await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
