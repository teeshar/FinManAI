/**
 * Password hashing.
 *
 * Uses scrypt from node:crypto — a memory-hard KDF, and the strongest option
 * available without adding a dependency. The Phase 2 spec called for argon2id,
 * which is marginally preferable; `PasswordHasher` is an interface precisely so
 * that swapping in the `argon2` package later touches one file and no callers.
 *
 * Parameters are stored inside the hash string, so raising them later does not
 * invalidate existing passwords — `needsRehash()` tells you which users to
 * upgrade on their next successful login.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// promisify() resolves to scrypt's 3-argument callback overload, which hides
// the options parameter we rely on for N/r/p and maxmem. The call is valid at
// runtime, so state the signature we actually use.
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

export type ScryptParams = {
  /** CPU/memory cost. Must be a power of 2. Memory ≈ 128 * N * r bytes. */
  N: number;
  /** Block size. */
  r: number;
  /** Parallelisation. */
  p: number;
  keyLength: number;
};

/**
 * N=2^15, r=8 → about 32 MiB per hash. Comfortably above the point where GPU
 * attacks stop being cheap, and fast enough that a login does not feel slow.
 */
export const DEFAULT_PARAMS: ScryptParams = { N: 32768, r: 8, p: 1, keyLength: 32 };

const PREFIX = 'scrypt';

/** Minimum length. Length beats composition rules — no forced symbols here. */
export const MIN_PASSWORD_LENGTH = 12;

export type PasswordProblem =
  | 'too_short'
  | 'too_long'
  | 'known_breached'
  | 'too_common'
  | 'contains_email';

/**
 * A small set of passwords that appear at the top of every breach corpus.
 * Production should check against a real breached-password service (k-anonymity
 * range query against HIBP) — this is the offline floor, not the ceiling.
 */
const COMMON = new Set([
  'password', 'password1', 'password123', '123456789012', 'qwertyuiop12',
  'administrator', 'letmein12345', 'welcome12345', 'iloveyou1234', 'abcd1234abcd',
  'india@123456', 'passw0rd1234', 'qwerty123456', '111111111111', 'aaaaaaaaaaaa',
]);

export function validatePassword(password: string, email?: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) problems.push('too_short');
  // Long inputs are a denial-of-service vector against a memory-hard KDF.
  if (password.length > 256) problems.push('too_long');
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) problems.push('too_common');
  if (email) {
    const localPart = email.split('@')[0]?.toLowerCase();
    if (localPart && localPart.length >= 3 && lower.includes(localPart)) {
      problems.push('contains_email');
    }
  }
  return problems;
}

/** Hash a password. Returns a self-describing string safe to store as-is. */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_PARAMS,
): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password.normalize('NFKC'), salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    // Node's default maxmem is too small for high N; give it room.
    maxmem: 256 * params.N * params.r,
  })) as Buffer;

  return [
    PREFIX,
    params.N,
    params.r,
    params.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/**
 * Verify a password. Constant-time comparison, and never throws on a malformed
 * stored hash — a corrupt row must read as "wrong password", not as a 500 that
 * tells an attacker something interesting.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== PREFIX) return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    if (salt.length === 0 || expected.length === 0) return false;

    const derived = (await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * N * r,
    })) as Buffer;

    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** True when a stored hash used weaker parameters than we now require. */
export function needsRehash(stored: string, params: ScryptParams = DEFAULT_PARAMS): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return true;
  return Number(parts[1]) < params.N || Number(parts[2]) < params.r || Number(parts[3]) < params.p;
}
