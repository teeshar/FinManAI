/**
 * Hash-chained audit log, and canonical hashing for profile snapshots.
 *
 * SEBI requires five years of records and an annual compliance audit. The
 * useful question is not "did we log it" but "can we show the log was not
 * edited afterwards". Chaining each event's hash to its predecessor does not
 * PREVENT tampering — anyone with database write access can rewrite rows — but
 * it makes tampering DETECTABLE, because rewriting one event breaks every hash
 * after it. That is the property that matters in a dispute.
 */

import { createHash } from 'node:crypto';

/* ------------------------------------------------------------------ */
/* Canonical JSON — the foundation of every hash here                  */
/* ------------------------------------------------------------------ */

/**
 * Serialise with keys in sorted order at every level, so the same logical
 * object always produces the same string. `JSON.stringify` preserves insertion
 * order, which means two identical profiles built in a different order would
 * hash differently — and a profile hash that changes without the profile
 * changing is worse than no hash at all.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    // undefined is absent, not null — match JSON.stringify's behaviour.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function hashObject(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/* ------------------------------------------------------------------ */
/* Audit events                                                        */
/* ------------------------------------------------------------------ */

export type AuditAction =
  | 'user.created'
  | 'user.login'
  | 'user.login_failed'
  | 'user.logout'
  | 'user.totp_enrolled'
  | 'user.password_changed'
  | 'profile.draft_saved'
  | 'profile.committed'
  | 'profile.viewed'
  | 'plan.generated'
  | 'plan.viewed'
  | 'plan.exported'
  | 'consent.recorded'
  | 'consent.revoked'
  | 'agreement.signed'
  | 'adviser.linked'
  | 'adviser.viewed_client'
  | 'compliance.exported'
  | 'key.rotated'
  // Phase 6 — living advice. A plan that is kept current generates its own
  // record: the reviews, the release decisions and the reminders are all part
  // of "what did you tell this client, and on what basis".
  | 'profile.reviewed'
  | 'plan.note_added'
  | 'plan.approved'
  | 'plan.withheld'
  | 'plan.compared'
  | 'reminder.queued'
  | 'reminder.sent'
  | 'assumptions.proposed'
  | 'assumptions.reviewed';

export type AuditInput = {
  action: AuditAction;
  /** Whose data this concerns. */
  userId: string | null;
  /** Who performed it — differs from userId when an adviser acts for a client. */
  actorId: string | null;
  entityType: string;
  entityId: string | null;
  metadata?: Record<string, unknown>;
  /** ISO timestamp, injected rather than read from the clock, so this is testable. */
  createdAt: string;
  ipHash?: string | null;
};

export type AuditEvent = AuditInput & {
  sequence: number;
  prevHash: string | null;
  hash: string;
};

/** The first link. A fixed, well-known value so the chain has a defined start. */
export const GENESIS_HASH = createHash('sha256').update('finmanai:audit:genesis').digest('hex');

export function computeEventHash(input: AuditInput, sequence: number, prevHash: string): string {
  return hashObject({
    sequence,
    prevHash,
    action: input.action,
    userId: input.userId,
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata ?? null,
    createdAt: input.createdAt,
    ipHash: input.ipHash ?? null,
  });
}

/**
 * Append an event to the chain.
 *
 * `previous` is the last event as stored. Passing null starts a new chain.
 * The caller must serialise appends — two concurrent writers producing the same
 * sequence number would fork the chain, which `verifyChain` will then report.
 */
export function appendEvent(input: AuditInput, previous: AuditEvent | null): AuditEvent {
  const sequence = previous ? previous.sequence + 1 : 0;
  const prevHash = previous ? previous.hash : GENESIS_HASH;
  return { ...input, sequence, prevHash, hash: computeEventHash(input, sequence, prevHash) };
}

export type ChainVerification = {
  valid: boolean;
  /** Index of the first event that fails, if any. */
  brokenAt?: number;
  reason?: string;
  checked: number;
};

/**
 * Walk the chain and confirm every link. This is what a compliance auditor
 * runs — and what you run yourself, on a schedule, so that if someone does
 * alter a row you learn about it in days rather than at the audit.
 */
export function verifyChain(events: AuditEvent[]): ChainVerification {
  let expectedPrev = GENESIS_HASH;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];

    if (e.sequence !== i) {
      return { valid: false, brokenAt: i, reason: `sequence is ${e.sequence}, expected ${i} — an event was inserted or removed`, checked: i };
    }
    if (e.prevHash !== expectedPrev) {
      return { valid: false, brokenAt: i, reason: 'prevHash does not match the previous event — the chain was cut', checked: i };
    }
    const recomputed = computeEventHash(e, e.sequence, e.prevHash);
    if (recomputed !== e.hash) {
      return { valid: false, brokenAt: i, reason: 'event contents do not match its hash — this event was edited after it was written', checked: i };
    }
    expectedPrev = e.hash;
  }

  return { valid: true, checked: events.length };
}

/* ------------------------------------------------------------------ */
/* Retention                                                           */
/* ------------------------------------------------------------------ */

/** SEBI minimum. Longer where a dispute or a direction is live. */
export const RETENTION_YEARS = 5;

export function retentionExpiry(createdAtISO: string, years = RETENTION_YEARS): string {
  const d = new Date(createdAtISO);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}

/**
 * Whether a record may be deleted. Deliberately conservative: a record under
 * legal hold is never deletable regardless of age.
 */
export function isDeletable(
  createdAtISO: string,
  nowISO: string,
  underLegalHold: boolean,
): boolean {
  if (underLegalHold) return false;
  return new Date(nowISO) >= new Date(retentionExpiry(createdAtISO));
}
