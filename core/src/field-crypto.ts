/**
 * Field-level encryption for the financial profile.
 *
 * The `Profile.data` column holds income, assets, debts, dependents and goals.
 * Database-level encryption at rest protects against a stolen disk; it does
 * nothing against a leaked connection string, a compromised read replica, or a
 * backup landing in the wrong bucket. Encrypting the field protects against all
 * of those.
 *
 * AES-256-GCM, which authenticates as well as encrypts: a tampered ciphertext
 * fails to decrypt rather than silently returning altered financial data.
 *
 * Two things that are usually got wrong and are handled here:
 *
 *   1. KEY ROTATION. The envelope records which key version encrypted it, so
 *      old rows stay readable while new rows use the new key. Without this,
 *      rotating a key means a migration of every row, so nobody ever rotates.
 *   2. ADDITIONAL AUTHENTICATED DATA. The profile id is bound into the
 *      ciphertext. An attacker with database write access cannot move user A's
 *      encrypted profile onto user B's row — it will not decrypt.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, the GCM standard
const TAG_LENGTH = 16;

export type KeyRing = {
  /** Version used for new encryptions. */
  activeVersion: string;
  /** All versions, so old ciphertext stays readable through a rotation. */
  keys: Record<string, Buffer>;
};

/**
 * Build a key ring from environment configuration.
 * Keys must be 32 raw bytes, base64-encoded. Generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * In production these come from KMS or Vault, never from a .env file in the
 * repository — the whole point is that a leaked codebase is not a leaked
 * database.
 */
export function keyRingFrom(
  entries: Record<string, string>,
  activeVersion: string,
): KeyRing {
  const keys: Record<string, Buffer> = {};
  for (const [version, base64] of Object.entries(entries)) {
    const key = Buffer.from(base64, 'base64');
    if (key.length !== 32) {
      throw new Error(`Key "${version}" is ${key.length} bytes; AES-256 needs exactly 32.`);
    }
    keys[version] = key;
  }
  if (!keys[activeVersion]) {
    throw new Error(`Active key version "${activeVersion}" is not present in the key ring.`);
  }
  return { activeVersion, keys };
}

/**
 * Self-describing envelope: v1.<keyVersion>.<iv>.<tag>.<ciphertext>
 * Storing the format version means a future change of algorithm does not
 * require guessing what old rows contain.
 */
export function encryptField(plaintext: string, keyRing: KeyRing, aad: string): string {
  const key = keyRing.keys[keyRing.activeVersion];
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  cipher.setAAD(Buffer.from(aad, 'utf8'));

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    'v1',
    keyRing.activeVersion,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptField(envelope: string, keyRing: KeyRing, aad: string): string {
  const parts = envelope.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') {
    throw new Error('Unrecognised ciphertext envelope format.');
  }
  const [, keyVersion, ivB64, tagB64, dataB64] = parts;

  const key = keyRing.keys[keyVersion];
  if (!key) {
    throw new Error(
      `Ciphertext was encrypted with key version "${keyVersion}", which is not in the key ring. ` +
        `Retired keys must be kept until every row using them has been re-encrypted.`,
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64url'), {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** Which key version encrypted this row — used to find rows needing rotation. */
export function keyVersionOf(envelope: string): string | null {
  const parts = envelope.split('.');
  return parts.length === 5 && parts[0] === 'v1' ? parts[1] : null;
}

export function needsKeyRotation(envelope: string, keyRing: KeyRing): boolean {
  return keyVersionOf(envelope) !== keyRing.activeVersion;
}

/* ------------------------------------------------------------------ */
/* Hashing for lookup and minimisation                                 */
/* ------------------------------------------------------------------ */

/**
 * Deterministic hash for values we must match on but should not store — IP
 * addresses in the audit log, for example. Peppered, so a stolen database
 * cannot be brute-forced against the small IPv4 space.
 */
export function blindIndex(value: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${value.toLowerCase().trim()}`).digest('hex');
}
