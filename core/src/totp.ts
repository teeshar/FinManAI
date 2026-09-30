/**
 * TOTP — RFC 6238, on top of HOTP (RFC 4226).
 *
 * Mandatory before any plan can be generated: this data is a person's entire
 * financial position, and a password alone is not enough to protect it.
 *
 * Implemented against node:crypto so the package stays dependency-free, and
 * verified against the RFC 6238 published test vectors in tests/ — an
 * implementation nobody checked against the vectors is not an implementation,
 * it is a guess that happens to work with one authenticator app.
 */

import { createHmac, randomBytes, randomInt, timingSafeEqual, createHash } from 'node:crypto';

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

export type TotpConfig = {
  /** Seconds per code. 30 is what every authenticator app assumes. */
  step: number;
  digits: number;
  algorithm: TotpAlgorithm;
  /**
   * How many steps either side of "now" to accept, covering clock drift
   * between the phone and the server. 1 = ±30s. Higher widens the window an
   * attacker has to replay a stolen code.
   */
  window: number;
};

export const DEFAULT_TOTP: TotpConfig = {
  step: 30,
  digits: 6,
  algorithm: 'sha1', // What Google Authenticator and Authy actually implement.
  window: 1,
};

/* ------------------------------------------------------------------ */
/* Base32 (RFC 4648, no padding) — what authenticator apps expect       */
/* ------------------------------------------------------------------ */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/* ------------------------------------------------------------------ */
/* HOTP / TOTP                                                         */
/* ------------------------------------------------------------------ */

/** RFC 4226 HOTP. Counter is a 64-bit big-endian integer. */
export function hotp(secret: Buffer, counter: number, config: TotpConfig): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac(config.algorithm, secret).update(counterBuf).digest();

  // Dynamic truncation, RFC 4226 §5.3.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** config.digits).padStart(config.digits, '0');
}

/** Generate the code for a given moment. `nowSeconds` is injected for testing. */
export function generateTotp(
  secretBase32: string,
  nowSeconds: number,
  config: TotpConfig = DEFAULT_TOTP,
): string {
  const counter = Math.floor(nowSeconds / config.step);
  return hotp(base32Decode(secretBase32), counter, config);
}

export type TotpVerification = {
  valid: boolean;
  /** Which step matched, so the caller can reject replays of the same code. */
  counter?: number;
};

/**
 * Verify a submitted code within the drift window.
 *
 * `lastUsedCounter` MUST be persisted per user and passed in: without it, a
 * code observed over someone's shoulder stays valid for its whole window.
 */
export function verifyTotp(
  secretBase32: string,
  token: string,
  nowSeconds: number,
  config: TotpConfig = DEFAULT_TOTP,
  lastUsedCounter?: number,
): TotpVerification {
  const cleaned = token.replace(/\s/g, '');
  if (!/^\d+$/.test(cleaned) || cleaned.length !== config.digits) return { valid: false };

  const secret = base32Decode(secretBase32);
  const current = Math.floor(nowSeconds / config.step);

  for (let drift = -config.window; drift <= config.window; drift++) {
    const counter = current + drift;
    if (counter < 0) continue;
    if (lastUsedCounter !== undefined && counter <= lastUsedCounter) continue; // replay
    const expected = hotp(secret, counter, config);
    const a = Buffer.from(expected);
    const b = Buffer.from(cleaned);
    if (a.length === b.length && timingSafeEqual(a, b)) return { valid: true, counter };
  }
  return { valid: false };
}

/* ------------------------------------------------------------------ */
/* Enrolment                                                           */
/* ------------------------------------------------------------------ */

/** 20 bytes = 160 bits, the RFC 4226 recommended secret length. */
export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** otpauth:// URI for the enrolment QR code. */
export function provisioningUri(
  secretBase32: string,
  accountEmail: string,
  issuer = 'FinManAI',
  config: TotpConfig = DEFAULT_TOTP,
): string {
  // The Key URI spec allows a literal or url-encoded colon between issuer and
  // account. Encode the two parts separately and join with a LITERAL colon —
  // some authenticator apps parse %3A poorly and end up showing the whole
  // label as the account name.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountEmail)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: config.algorithm.toUpperCase(),
    digits: String(config.digits),
    period: String(config.step),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ------------------------------------------------------------------ */
/* Recovery codes                                                      */
/* ------------------------------------------------------------------ */

export type RecoveryCodes = {
  /** Shown to the user exactly once. */
  plaintext: string[];
  /** Stored. Single-use: delete the hash when consumed. */
  hashes: string[];
};

/**
 * Recovery codes are the thing that decides whether a lost phone is an
 * inconvenience or a lost account. Ten single-use codes, hashed at rest.
 */
export function generateRecoveryCodes(count = 10): RecoveryCodes {
  const plaintext: string[] = [];
  for (let i = 0; i < count; i++) {
    // Avoid 0/O and 1/I — these get read off paper and typed by hand.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let j = 0; j < 10; j++) code += alphabet[randomInt(alphabet.length)];
    plaintext.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return { plaintext, hashes: plaintext.map(hashRecoveryCode) };
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(code.toUpperCase().replace(/\s/g, '')).digest('hex');
}

/** Returns the index of the matching hash so the caller can consume it. */
export function verifyRecoveryCode(code: string, hashes: string[]): number {
  const candidate = hashRecoveryCode(code);
  const a = Buffer.from(candidate, 'hex');
  for (let i = 0; i < hashes.length; i++) {
    const b = Buffer.from(hashes[i], 'hex');
    if (a.length === b.length && timingSafeEqual(a, b)) return i;
  }
  return -1;
}
