/**
 * Key ring, assembled from the environment once per process.
 *
 * Fails loudly at startup if keys are missing or malformed. A silent fallback
 * to unencrypted storage is the kind of bug that is only discovered during a
 * breach, so there is deliberately no fallback at all.
 */

import { keyRingFrom } from '../../../core/src/field-crypto.ts';
import type { KeyRing } from '../../../core/src/field-crypto.ts';

let cached: KeyRing | null = null;

export function keyRing(): KeyRing {
  if (cached) return cached;

  const active = process.env.FIELD_KEY_ACTIVE;
  if (!active) {
    throw new Error('FIELD_KEY_ACTIVE is not set. Refusing to start without field encryption.');
  }

  // Collect every FIELD_KEY_<VERSION>. Retired versions must stay present until
  // every row using them has been re-encrypted.
  const entries: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    const match = /^FIELD_KEY_(V\d+)$/.exec(name);
    if (match && value) entries[match[1].toLowerCase()] = value;
  }

  if (Object.keys(entries).length === 0) {
    throw new Error(
      'No FIELD_KEY_V* values found. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }

  cached = keyRingFrom(entries, active.toLowerCase());
  return cached;
}

export function ipPepper(): string {
  const pepper = process.env.IP_PEPPER;
  if (!pepper) throw new Error('IP_PEPPER is not set. Refusing to store unpeppered IP hashes.');
  return pepper;
}

export type AdvisoryMode = 'advisory' | 'diagnostic_only';

/**
 * The Path B switch. Defaults to diagnostic_only — the safe direction. Turning
 * on advisory output must be a deliberate act, not the consequence of a missing
 * environment variable.
 */
export function advisoryMode(): AdvisoryMode {
  return process.env.ADVISORY_MODE === 'advisory' ? 'advisory' : 'diagnostic_only';
}
