/**
 * Security core test suite.
 *
 * These are the parts of Phase 2 where a bug is expensive and silent: a TOTP
 * that drifts, an audit chain that does not actually detect tampering, an
 * encryption envelope that lets a row be moved between users. All of it runs
 * with no dependencies and no database.
 *
 * Run: node --experimental-strip-types tests/core.ts
 */

import {
  hashPassword, verifyPassword, needsRehash, validatePassword, DEFAULT_PARAMS,
} from '../src/password.ts';
import {
  base32Encode, base32Decode, hotp, generateTotp, verifyTotp, generateSecret,
  provisioningUri, generateRecoveryCodes, verifyRecoveryCode, DEFAULT_TOTP,
} from '../src/totp.ts';
import {
  keyRingFrom, encryptField, decryptField, needsKeyRotation, keyVersionOf, blindIndex,
} from '../src/field-crypto.ts';
import {
  canonicalJson, hashObject, appendEvent, verifyChain, GENESIS_HASH, isDeletable, retentionExpiry,
} from '../src/audit.ts';
import type { AuditEvent } from '../src/audit.ts';
import {
  issueSession, validateSession, touchSession, revokeSession,
  registerFailedLogin, isLockedOut, clearThrottle,
} from '../src/session.ts';
import type { LoginThrottleState } from '../src/session.ts';
import {
  commitProfile, verifySnapshot, planMatchesProfile, reprofileStatus, detectMaterialChanges,
} from '../src/profile-store.ts';
import { randomBytes } from 'node:crypto';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`\x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`\x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
  console.log('─'.repeat(72));
}

/* ================================================================== */
section('Passwords');
/* ================================================================== */

// Deliberately weaker params for test speed. Production uses DEFAULT_PARAMS.
const TEST_PARAMS = { N: 1024, r: 8, p: 1, keyLength: 32 };

const hash1 = await hashPassword('correct horse battery staple', TEST_PARAMS);
check('Hash is self-describing and parseable', hash1.startsWith('scrypt$1024$8$1$'));
check('Correct password verifies', await verifyPassword('correct horse battery staple', hash1));
check('Wrong password rejected', !(await verifyPassword('correct horse battery stapl', hash1)));
check('Empty password rejected', !(await verifyPassword('', hash1)));

const hash2 = await hashPassword('correct horse battery staple', TEST_PARAMS);
check('Same password gives different hashes (salted)', hash1 !== hash2);
check('Both salted hashes still verify', await verifyPassword('correct horse battery staple', hash2));

check('Malformed hash returns false, does not throw', !(await verifyPassword('x', 'garbage')));
check('Truncated hash returns false', !(await verifyPassword('x', 'scrypt$1024$8$1$abc')));
check('Empty stored hash returns false', !(await verifyPassword('x', '')));

check('Unicode passwords normalise consistently',
  await verifyPassword('café☕password', await hashPassword('café☕password', TEST_PARAMS)));

check('Weak params flagged for rehash', needsRehash(hash1, DEFAULT_PARAMS));
check('Current params not flagged',
  !needsRehash(await hashPassword('another one here', TEST_PARAMS), TEST_PARAMS));

check('Short password rejected', validatePassword('short').includes('too_short'));
check('Common password rejected', validatePassword('password123').includes('too_common'));
check('Password containing email local-part rejected',
  validatePassword('teeshasecret123', 'teesha@example.com').includes('contains_email'));
check('Strong password accepted', validatePassword('vault-mango-77-river', 'a@b.com').length === 0);
check('Overlong password rejected (KDF DoS guard)',
  validatePassword('a'.repeat(500)).includes('too_long'));

/* ================================================================== */
section('TOTP — against RFC 6238 published test vectors');
/* ================================================================== */

/* The RFC 6238 appendix B vectors. Seed is the ASCII string
   "12345678901234567890", codes are 8 digits. If an implementation matches
   these it will match every authenticator app; if it does not, it will fail
   for real users in ways that are painful to diagnose. */
const rfcSecret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));
const rfcConfig = { step: 30, digits: 8, algorithm: 'sha1' as const, window: 0 };

const vectors: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

for (const [time, expected] of vectors) {
  const actual = generateTotp(rfcSecret, time, rfcConfig);
  check(`RFC 6238 vector at T=${time} → ${expected}`, actual === expected, `got ${actual}`);
}

// RFC 4226 HOTP vectors, same seed, counters 0-9.
const hotpExpected = ['755224', '287082', '359152', '969429', '338314',
                      '254676', '287922', '162583', '399871', '520489'];
const hotpSecret = Buffer.from('12345678901234567890', 'ascii');
let hotpOk = true;
for (let c = 0; c < hotpExpected.length; c++) {
  if (hotp(hotpSecret, c, { ...DEFAULT_TOTP, digits: 6 }) !== hotpExpected[c]) hotpOk = false;
}
check('RFC 4226 HOTP vectors, counters 0–9', hotpOk);

check('Base32 round-trips arbitrary bytes', (() => {
  for (let i = 0; i < 50; i++) {
    const buf = randomBytes(1 + (i % 40));
    if (!base32Decode(base32Encode(buf)).equals(buf)) return false;
  }
  return true;
})());

const secret = generateSecret();
const now = 1_700_000_000;
const code = generateTotp(secret, now);
check('Generated code verifies at the same moment', verifyTotp(secret, code, now).valid);
check('Code valid one step early (clock drift)', verifyTotp(secret, code, now - 30).valid);
check('Code valid one step late (clock drift)', verifyTotp(secret, code, now + 30).valid);
check('Code rejected two steps away', !verifyTotp(secret, code, now + 90).valid);
check('Wrong code rejected', !verifyTotp(secret, '000000', now).valid);
check('Non-numeric code rejected', !verifyTotp(secret, 'abcdef', now).valid);
check('Wrong-length code rejected', !verifyTotp(secret, '1234567', now).valid);

const firstUse = verifyTotp(secret, code, now);
check('Replay of a used code is rejected',
  !verifyTotp(secret, code, now, DEFAULT_TOTP, firstUse.counter).valid);

const uri = provisioningUri(secret, 'teesha@example.com');
check('Provisioning URI is well-formed',
  uri.startsWith('otpauth://totp/FinManAI:') && uri.includes(`secret=${secret}`) && uri.includes('period=30'));

const recovery = generateRecoveryCodes();
check('Ten recovery codes generated', recovery.plaintext.length === 10 && recovery.hashes.length === 10);
check('Recovery codes are all distinct', new Set(recovery.plaintext).size === 10);
check('Recovery codes avoid ambiguous characters',
  recovery.plaintext.every((c) => !/[O0I1]/.test(c)));
check('Valid recovery code found at its index',
  verifyRecoveryCode(recovery.plaintext[3], recovery.hashes) === 3);
check('Recovery code is case-insensitive',
  verifyRecoveryCode(recovery.plaintext[0].toLowerCase(), recovery.hashes) === 0);
check('Unknown recovery code returns -1',
  verifyRecoveryCode('AAAAA-BBBBB', recovery.hashes) === -1);

/* ================================================================== */
section('Field encryption');
/* ================================================================== */

const k1 = randomBytes(32).toString('base64');
const k2 = randomBytes(32).toString('base64');
const ring1 = keyRingFrom({ v1: k1 }, 'v1');
const ring2 = keyRingFrom({ v1: k1, v2: k2 }, 'v2');

const secretProfile = JSON.stringify({ monthlyTakeHome: 95000, netWorth: 2813000 });
const envelope = encryptField(secretProfile, ring1, 'profile:abc123');

check('Ciphertext does not contain the plaintext', !envelope.includes('95000'));
check('Round-trips with the right key and AAD',
  decryptField(envelope, ring1, 'profile:abc123') === secretProfile);

check('Wrong AAD fails — a row cannot be moved between users', (() => {
  try { decryptField(envelope, ring1, 'profile:different'); return false; } catch { return true; }
})());

check('Tampered ciphertext fails authentication', (() => {
  const parts = envelope.split('.');
  const data = Buffer.from(parts[4], 'base64url');
  data[0] ^= 0xff;
  parts[4] = data.toString('base64url');
  try { decryptField(parts.join('.'), ring1, 'profile:abc123'); return false; } catch { return true; }
})());

check('Truncated envelope rejected', (() => {
  try { decryptField('v1.v1.abc', ring1, 'x'); return false; } catch { return true; }
})());

check('Same plaintext encrypts differently each time (random IV)',
  encryptField(secretProfile, ring1, 'profile:abc123') !== envelope);

check('Old ciphertext still readable after key rotation',
  decryptField(envelope, ring2, 'profile:abc123') === secretProfile);
check('New writes use the new key version',
  keyVersionOf(encryptField('x', ring2, 'aad')) === 'v2');
check('Rows needing rotation are identifiable', needsKeyRotation(envelope, ring2));
check('Freshly written rows do not need rotation',
  !needsKeyRotation(encryptField('x', ring2, 'aad'), ring2));

check('Missing retired key gives a clear error, not a silent failure', (() => {
  const onlyV2 = keyRingFrom({ v2: k2 }, 'v2');
  try { decryptField(envelope, onlyV2, 'profile:abc123'); return false; }
  catch (e) { return (e as Error).message.includes('key version'); }
})());

check('Short key rejected at construction', (() => {
  try { keyRingFrom({ v1: Buffer.alloc(16).toString('base64') }, 'v1'); return false; } catch { return true; }
})());
check('Active version must exist in the ring', (() => {
  try { keyRingFrom({ v1: k1 }, 'v9'); return false; } catch { return true; }
})());

check('Blind index is deterministic and pepper-dependent',
  blindIndex('1.2.3.4', 'pep') === blindIndex('1.2.3.4', 'pep') &&
  blindIndex('1.2.3.4', 'pep') !== blindIndex('1.2.3.4', 'other'));

/* ================================================================== */
section('Canonical hashing and the audit chain');
/* ================================================================== */

check('Key order does not change the hash',
  hashObject({ a: 1, b: { c: 2, d: 3 } }) === hashObject({ b: { d: 3, c: 2 }, a: 1 }));
check('Different values change the hash',
  hashObject({ a: 1 }) !== hashObject({ a: 2 }));
check('Arrays keep their order (order is meaningful)',
  hashObject([1, 2]) !== hashObject([2, 1]));
check('undefined is omitted, matching JSON.stringify',
  canonicalJson({ a: 1, b: undefined }) === '{"a":1}');
check('null is preserved', canonicalJson({ a: null }) === '{"a":null}');
check('Nested structures canonicalise',
  canonicalJson({ z: [{ b: 1, a: 2 }] }) === '{"z":[{"a":2,"b":1}]}');

const T = '2026-08-19T10:00:00.000Z';
const chain: AuditEvent[] = [];
chain.push(appendEvent({ action: 'user.created', userId: 'u1', actorId: 'u1', entityType: 'User', entityId: 'u1', createdAt: T }, null));
chain.push(appendEvent({ action: 'user.login', userId: 'u1', actorId: 'u1', entityType: 'Session', entityId: 's1', createdAt: T }, chain[0]));
chain.push(appendEvent({ action: 'profile.committed', userId: 'u1', actorId: 'u1', entityType: 'Profile', entityId: 'p1', metadata: { version: 1 }, createdAt: T }, chain[1]));
chain.push(appendEvent({ action: 'plan.generated', userId: 'u1', actorId: 'adv1', entityType: 'Plan', entityId: 'pl1', createdAt: T }, chain[2]));

check('First event chains to genesis', chain[0].prevHash === GENESIS_HASH && chain[0].sequence === 0);
check('Sequence increments', chain.map((e) => e.sequence).join(',') === '0,1,2,3');
check('Intact chain verifies', verifyChain(chain).valid);

check('Editing an event is detected', (() => {
  const tampered = structuredClone(chain);
  (tampered[1].metadata ??= {}).injected = true;
  const r = verifyChain(tampered);
  return !r.valid && r.brokenAt === 1 && (r.reason ?? '').includes('edited');
})());

check('Deleting an event is detected', (() => {
  const r = verifyChain([chain[0], chain[2], chain[3]]);
  return !r.valid && r.brokenAt === 1;
})());

check('Reordering events is detected', (() => {
  const r = verifyChain([chain[1], chain[0], chain[2], chain[3]]);
  return !r.valid;
})());

check('Re-hashing a tampered event does not save it — the chain still breaks', (() => {
  const tampered = structuredClone(chain);
  tampered[1] = appendEvent({ ...tampered[1], action: 'user.logout' }, tampered[0]);
  // Event 1 is now internally consistent, but event 2 still points at the old hash.
  const r = verifyChain(tampered);
  return !r.valid && r.brokenAt === 2;
})());

check('Empty chain is trivially valid', verifyChain([]).valid);
check('Adviser action records both subject and actor',
  chain[3].userId === 'u1' && chain[3].actorId === 'adv1');

check('Retention expiry is five years out',
  retentionExpiry('2026-08-19T00:00:00.000Z').startsWith('2031-08-19'));
check('Record inside retention is not deletable',
  !isDeletable('2026-08-19T00:00:00.000Z', '2029-01-01T00:00:00.000Z', false));
check('Record past retention is deletable',
  isDeletable('2020-01-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z', false));
check('Legal hold overrides retention expiry',
  !isDeletable('2010-01-01T00:00:00.000Z', '2026-08-19T00:00:00.000Z', true));

/* ================================================================== */
section('Sessions and login throttling');
/* ================================================================== */

const t0 = '2026-08-19T10:00:00.000Z';
const issued = issueSession({ sessionId: 's1', userId: 'u1', nowISO: t0 });

check('Raw token is never stored', issued.record.tokenHash !== issued.token);
check('Token has 256 bits of entropy', Buffer.from(issued.token, 'base64url').length === 32);
check('Valid token accepted', validateSession(issued.token, issued.record, t0).valid);
check('Wrong token rejected as not_found (no oracle)', (() => {
  const r = validateSession('wrong-token', issued.record, t0);
  return !r.valid && r.reason === 'not_found';
})());
check('Missing record rejected', !validateSession(issued.token, null, t0).valid);

check('Idle timeout enforced at 30 minutes', (() => {
  const r = validateSession(issued.token, issued.record, '2026-08-19T10:31:00.000Z');
  return !r.valid && r.reason === 'idle_timeout';
})());
check('Activity rolls the idle window forward', (() => {
  const touched = touchSession(issued.record, '2026-08-19T10:25:00.000Z');
  return validateSession(issued.token, touched, '2026-08-19T10:50:00.000Z').valid;
})());
check('Absolute timeout is NOT extended by activity', (() => {
  const touched = touchSession(issued.record, '2026-08-19T21:59:00.000Z');
  const r = validateSession(issued.token, touched, '2026-08-19T22:01:00.000Z');
  return !r.valid && r.reason === 'expired';
})());
check('Revoked session rejected immediately', (() => {
  const revoked = revokeSession(issued.record, '2026-08-19T10:05:00.000Z');
  const r = validateSession(issued.token, revoked, '2026-08-19T10:06:00.000Z');
  return !r.valid && r.reason === 'revoked';
})());

let throttle: LoginThrottleState = { failedAttempts: 0, lockoutCount: 0, lockedUntil: null, firstFailureAt: null };
for (let i = 0; i < 4; i++) throttle = registerFailedLogin(throttle, t0);
check('Four failures do not lock the account', !isLockedOut(throttle, t0) && throttle.failedAttempts === 4);

throttle = registerFailedLogin(throttle, t0);
check('Fifth failure locks the account', isLockedOut(throttle, t0));
check('Lockout expires after 15 minutes', !isLockedOut(throttle, '2026-08-19T10:16:00.000Z'));

let escalating = throttle;
for (let i = 0; i < 5; i++) escalating = registerFailedLogin(escalating, '2026-08-19T11:00:00.000Z');
check('Second lockout is longer than the first (exponential backoff)', (() => {
  const first = new Date(throttle.lockedUntil!).getTime() - new Date(t0).getTime();
  const second = new Date(escalating.lockedUntil!).getTime() - new Date('2026-08-19T11:00:00.000Z').getTime();
  return second > first;
})());

check('Failures outside the window do not accumulate', (() => {
  let s: LoginThrottleState = { failedAttempts: 4, lockoutCount: 0, lockedUntil: null, firstFailureAt: t0 };
  s = registerFailedLogin(s, '2026-08-19T10:20:00.000Z'); // window expired
  return s.failedAttempts === 1;
})());
check('Successful login clears the counter',
  clearThrottle(throttle).failedAttempts === 0 && clearThrottle(throttle).lockedUntil === null);

/* ================================================================== */
section('Profile versioning');
/* ================================================================== */

const profileV1 = { planningMode: 'individual', income: { monthlyTakeHome: 95000 }, dependents: [] };
const snap1 = commitProfile({ id: 'p1', userId: 'u1', data: profileV1, createdBy: 'u1', nowISO: t0, previous: null })!;

check('First commit is version 1', snap1.version === 1);
check('Snapshot hash verifies', verifySnapshot(snap1));

check('Re-committing identical data creates no new version',
  commitProfile({ id: 'p2', userId: 'u1', data: { ...profileV1 }, createdBy: 'u1', nowISO: t0, previous: snap1 }) === null);

const profileV2 = { ...profileV1, income: { monthlyTakeHome: 120000 } };
const snap2 = commitProfile({ id: 'p2', userId: 'u1', data: profileV2, createdBy: 'u1', nowISO: t0, previous: snap1 })!;
check('Changed data creates version 2', snap2.version === 2);
check('Different versions have different hashes', snap1.dataHash !== snap2.dataHash);

check('Tampered snapshot fails verification', (() => {
  const t = structuredClone(snap1);
  (t.data as { income: { monthlyTakeHome: number } }).income.monthlyTakeHome = 1;
  return !verifySnapshot(t);
})());

check('A plan can prove which profile produced it', planMatchesProfile(snap1.dataHash, snap1));
check('A plan cannot be attributed to the wrong version', !planMatchesProfile(snap1.dataHash, snap2));

check('Profile within a year is current',
  reprofileStatus('2026-06-01T00:00:00.000Z', t0).state === 'current');
check('Profile approaching a year warns',
  reprofileStatus('2025-09-01T00:00:00.000Z', t0).state === 'due_soon');
check('Profile over a year old is overdue',
  reprofileStatus('2025-01-01T00:00:00.000Z', t0).state === 'overdue');

check('Material income change detected',
  detectMaterialChanges(profileV1, profileV2).some((c) => c.includes('Monthly income')));
check('A new dependent is material',
  detectMaterialChanges(profileV1, { ...profileV1, dependents: [{ id: 'd1' }] })
    .some((c) => c.includes('dependents')));
check('Switching to household mode is material',
  detectMaterialChanges(profileV1, { ...profileV1, planningMode: 'household' })
    .some((c) => c.includes('Planning mode')));
check('Trivial change is not flagged as material',
  detectMaterialChanges(profileV1, { ...profileV1, income: { monthlyTakeHome: 96000 } }).length === 0);

/* ================================================================== */

console.log('\n' + '─'.repeat(72));
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('');
