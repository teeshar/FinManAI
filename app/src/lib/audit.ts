/**
 * Appending to the audit chain.
 *
 * The chain has one hard requirement: appends must be SERIALISED. Two
 * concurrent writers reading the same "last event" would both compute sequence
 * N+1 and fork the chain, which verifyChain() would then report as tampering
 * forever after. A false tampering alarm during a compliance audit is nearly as
 * bad as a real one.
 *
 * So every append runs inside a serialisable transaction. On Postgres that is
 * `SERIALIZABLE`. Postgres resolves a serialisation conflict by aborting one
 * of the transactions rather than making it wait, so a losing append must be
 * retried or the request fails — retrying is safe because the whole append is
 * one transaction that either commits or leaves no trace. Under contention
 * this is a bottleneck by design: correctness of the audit trail matters more
 * than audit-write throughput.
 */

import { appendEvent } from '../../../core/src/audit.ts';
import type { AuditAction, AuditEvent, AuditInput } from '../../../core/src/audit.ts';
import { blindIndex } from '../../../core/src/field-crypto.ts';
import { ipPepper } from './keys.ts';
import { prisma } from './db.ts';

export type AuditContext = {
  /** Whose data this concerns. */
  userId: string | null;
  /** Who performed it. Differs from userId when an adviser acts for a client. */
  actorId: string | null;
  ip?: string | null;
};

/**
 * Prisma surfaces a serialisation failure or deadlock as P2034, and a race that
 * slips through to the unique index on `sequence` as P2002. Both mean "someone
 * else appended first" — re-read the tail and try again.
 */
const RETRYABLE = new Set(['P2034', 'P2002']);
const MAX_ATTEMPTS = 6;

export async function recordAudit(
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  ctx: AuditContext,
  metadata?: Record<string, unknown>,
): Promise<AuditEvent> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await appendOnce(action, entityType, entityId, ctx, metadata);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (!code || !RETRYABLE.has(code)) throw err;
      lastError = err;
      // Backoff with jitter so simultaneous losers do not collide again in
      // lockstep on the retry.
      const backoffMs = 5 * 2 ** attempt + Math.random() * 10;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError;
}

/**
 * One append attempt. The audit write commits atomically with the change it
 * records — an audit entry that survives a rolled-back write is a lie.
 */
async function appendOnce(
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  ctx: AuditContext,
  metadata?: Record<string, unknown>,
): Promise<AuditEvent> {
  return prisma.$transaction(
    async (tx) => {
      const previous = await tx.auditEvent.findFirst({
        orderBy: { sequence: 'desc' },
      });

      const input: AuditInput = {
        action,
        userId: ctx.userId,
        actorId: ctx.actorId,
        entityType,
        entityId,
        metadata,
        createdAt: new Date().toISOString(),
        ipHash: ctx.ip ? blindIndex(ctx.ip, ipPepper()) : null,
      };

      const event = appendEvent(
        input,
        previous
          ? {
              ...input,
              sequence: previous.sequence,
              prevHash: previous.prevHash,
              hash: previous.hash,
            }
          : null,
      );

      await tx.auditEvent.create({
        data: {
          sequence: event.sequence,
          userId: event.userId,
          actorId: event.actorId,
          action: event.action,
          entityType: event.entityType,
          entityId: event.entityId,
          // Never let a financial value into audit metadata — it is the one
          // table not encrypted, because it must stay queryable for audits.
          metadata: metadata ? JSON.stringify(metadata) : null,
          ipHash: event.ipHash,
          createdAt: new Date(event.createdAt),
          prevHash: event.prevHash,
          hash: event.hash,
        },
      });

      return event;
    },
    { isolationLevel: 'Serializable' },
  );
}

/**
 * Verify the whole chain. Run this on a schedule — monthly at minimum — so that
 * if a row is ever altered you find out in days rather than at the annual audit.
 */
export async function verifyAuditChain(): Promise<{
  valid: boolean;
  checked: number;
  brokenAt?: number;
  reason?: string;
}> {
  const { verifyChain } = await import('../../../core/src/audit.ts');

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

  return verifyChain(events);
}
