/**
 * Drive a field-encryption key rotation to completion.
 *
 * Rotation is incremental by design: each row records which key version
 * encrypted it, so a new key can go live immediately and old rows move over in
 * batches. The failure mode this script exists to prevent is the common one —
 * a rotation that is started, half finishes, and is forgotten, leaving retired
 * keys that can never be removed from the ring because nobody knows whether
 * anything still needs them.
 *
 * The plaintext never changes, so `dataHash` never changes, so every plan stays
 * verifiable across a rotation. That property is what makes this safe to run
 * against live data.
 *
 * To rotate:
 *   1. Generate a key:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *   2. Add FIELD_KEY_V2 to .env and set FIELD_KEY_ACTIVE="v2".
 *   3. KEEP FIELD_KEY_V1 — old ciphertext cannot be read without it.
 *   4. Run this until it reports zero remaining.
 *   5. Only then remove FIELD_KEY_V1.
 *
 * Usage: node --experimental-strip-types scripts/rotate-keys.ts [--batch 100]
 */

import './env.ts';
import { rotateProfileKeys } from '../src/lib/profile-service.ts';
import { recordAudit } from '../src/lib/audit.ts';
import { keyRing } from '../src/lib/keys.ts';
import { prisma } from '../src/lib/db.ts';

const batchArg = process.argv.indexOf('--batch');
const batchSize = batchArg > -1 ? Number(process.argv[batchArg + 1]) || 100 : 100;

const ring = keyRing();
console.log(`Active key: ${ring.activeVersion}. Rotating in batches of ${batchSize}.`);

let total = 0;
let pass = 0;

// Loop rather than one sweep: `rotateProfileKeys` takes a batch at a time so a
// large table does not become one enormous transaction.
for (;;) {
  const moved = await rotateProfileKeys(batchSize);
  if (moved === 0) break;
  total += moved;
  pass++;
  console.log(`  batch ${pass}: ${moved} profile(s) re-encrypted (${total} total)`);

  // A guard against an infinite loop if a row somehow refuses to move — better
  // to stop and be investigated than to spin forever against a live database.
  if (pass > 10_000) {
    console.error('\x1b[31mAborting: too many batches. A row is not moving off its old key.\x1b[0m');
    await prisma.$disconnect();
    process.exit(1);
  }
}

const remaining = await prisma.profile.groupBy({ by: ['keyVersion'], _count: true });
const stale = remaining.filter((r) => r.keyVersion !== ring.activeVersion);

if (total > 0) {
  await recordAudit('key.rotated', 'Profile', null, { userId: null, actorId: null }, {
    rotated: total,
    activeVersion: ring.activeVersion,
  });
}

console.log('\n' + '─'.repeat(70));
if (stale.length === 0) {
  console.log(
    `\x1b[32mRotation complete.\x1b[0m ${total} profile(s) moved; every row is now on ` +
      `${ring.activeVersion}. It is safe to remove the retired key from .env.`,
  );
} else {
  console.error(
    `\x1b[31m${stale.map((s) => `${s._count} on ${s.keyVersion}`).join(', ')} remain.\x1b[0m ` +
      `Do NOT remove the retired key yet.`,
  );
}

await prisma.$disconnect();
process.exit(stale.length === 0 ? 0 : 1);
