/**
 * The checks that matter for a compliance audit, and that no UI would show you.
 *
 * 1. Every audit event chains correctly to its predecessor.
 * 2. Every stored profile still matches its own hash.
 * 3. Every plan is bound to the profile version that produced it.
 * 4. Nothing is encrypted with a retired key.
 * 5. Tampering is actually detected — proved by tampering with a copy.
 *
 * Run this on a schedule, not just before an audit. If a row is ever altered
 * you want to find out in days rather than at the annual review.
 *
 * Usage: node --experimental-strip-types scripts/verify-integrity.ts
 */

import { PrismaClient } from '@prisma/client';
import { verifyChain, computeEventHash, hashObject } from '../../core/src/audit.ts';
import type { AuditEvent, AuditAction } from '../../core/src/audit.ts';
import { decryptField, keyVersionOf } from '../../core/src/field-crypto.ts';
import { keyRingFrom } from '../../core/src/field-crypto.ts';

const prisma = new PrismaClient();

function ring() {
  const active = (process.env.FIELD_KEY_ACTIVE ?? 'v1').toLowerCase();
  const entries: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    const m = /^FIELD_KEY_(V\d+)$/.exec(name);
    if (m && value) entries[m[1].toLowerCase()] = value;
  }
  return keyRingFrom(entries, active);
}

let problems = 0;
const say = (ok: boolean, msg: string) => {
  if (!ok) problems++;
  console.log(`${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
};

const keys = ring();

/* 1. Audit chain -------------------------------------------------- */

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
say(chain.valid, `Audit chain: ${chain.checked} events${chain.valid ? ' intact' : ` BROKEN at #${chain.brokenAt} — ${chain.reason}`}`);

/* 2. Tamper detection actually works ------------------------------ */

if (events.length >= 2) {
  const copy = structuredClone(events);
  copy[1].metadata = { ...(copy[1].metadata ?? {}), injected: true };
  const tampered = verifyChain(copy);
  say(!tampered.valid, `Tamper detection works (edited event #1 → ${tampered.valid ? 'NOT DETECTED' : 'detected'})`);
} else {
  console.log('\x1b[2m·\x1b[0m Too few events to run the tamper check');
}

/* 3. Profiles match their hashes ---------------------------------- */

const profiles = await prisma.profile.findMany();
let badProfiles = 0;
let staleKeys = 0;

for (const p of profiles) {
  try {
    const data = JSON.parse(decryptField(p.dataEncrypted, keys, `profile:${p.id}`));
    if (hashObject(data) !== p.dataHash) {
      badProfiles++;
      console.log(`  \x1b[31mProfile ${p.id} v${p.version}: contents do not match stored hash\x1b[0m`);
    }
  } catch (e) {
    badProfiles++;
    console.log(`  \x1b[31mProfile ${p.id}: cannot decrypt — ${(e as Error).message}\x1b[0m`);
  }
  if (keyVersionOf(p.dataEncrypted) !== keys.activeVersion) staleKeys++;
}

say(badProfiles === 0, `Profiles: ${profiles.length} checked, ${badProfiles} failed integrity`);

/* 4. Plans bound to their profile --------------------------------- */

const plans = await prisma.plan.findMany({ include: { profile: true } });
const orphaned = plans.filter((pl) => pl.profileHash !== pl.profile.dataHash);
say(
  orphaned.length === 0,
  `Plans: ${plans.length} checked, ${orphaned.length} no longer match the profile that produced them`,
);
for (const o of orphaned) {
  console.log(`  \x1b[31mPlan ${o.id} cannot be explained by profile ${o.profileId}\x1b[0m`);
}

/* 5. Key rotation ------------------------------------------------- */

if (staleKeys > 0) {
  console.log(
    `\x1b[33m!\x1b[0m ${staleKeys} profile(s) still encrypted with a retired key. ` +
      `Run rotateProfileKeys() until this reaches zero, and keep the old key until it does.`,
  );
} else {
  say(true, `Key rotation: all rows on the active key (${keys.activeVersion})`);
}

/* ----------------------------------------------------------------- */

console.log('\n' + '─'.repeat(70));
if (problems === 0) {
  console.log('\x1b[32mAll integrity checks passed.\x1b[0m This is what you show a compliance auditor.\n');
} else {
  console.log(`\x1b[31m${problems} check(s) failed. Investigate before serving any advice.\x1b[0m\n`);
}

await prisma.$disconnect();
process.exit(problems === 0 ? 0 : 1);
