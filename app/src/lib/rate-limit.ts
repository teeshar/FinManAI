/**
 * Rate limiting, backed by the audit log.
 *
 * Plan generation is computationally cheap but not free: it runs the ten-stage
 * engine, calls a language model, and writes an encrypted row plus an audit
 * event that must serialise against every other audit write in the system. That
 * last part is the real cost — a client hammering "generate" does not slow down
 * their own request, it slows down everybody's audit appends.
 *
 * The counter is the audit log itself rather than a separate table. That is a
 * deliberate reuse: the events are already written, already indexed on
 * `(action, createdAt)`, and cannot drift out of step with what actually
 * happened. A limiter that counts something other than the thing it is limiting
 * is a limiter that eventually disagrees with reality.
 *
 * It is not a defence against a distributed attacker — that belongs at the edge.
 * It is a guard against a stuck client, a retry loop, or an impatient person.
 */

import type { AuditAction } from '../../../core/src/audit.ts';
import { prisma } from './db.ts';

export type RateLimit = { limit: number; windowMinutes: number };

/**
 * Generous enough that nobody planning in good faith will meet it. Someone
 * genuinely iterating on their profile — change a number, regenerate, read it —
 * takes minutes per cycle, not seconds.
 */
export const PLAN_GENERATION_LIMIT: RateLimit = { limit: 10, windowMinutes: 60 };

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMinutes: number; message: string };

export async function checkRateLimit(
  action: AuditAction,
  userId: string,
  rule: RateLimit,
  nowMs = Date.now(),
): Promise<RateLimitResult> {
  const since = new Date(nowMs - rule.windowMinutes * 60_000);

  const recent = await prisma.auditEvent.findMany({
    where: { action, userId, createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });

  if (recent.length < rule.limit) {
    return { allowed: true, remaining: rule.limit - recent.length };
  }

  // The window frees up when the OLDEST event in it ages out, not when the
  // newest does — otherwise a burst at the limit locks the user out for a full
  // window after their last attempt rather than after their first.
  const oldest = recent[0].createdAt.getTime();
  const retryAfterMinutes = Math.max(
    1,
    Math.ceil((oldest + rule.windowMinutes * 60_000 - nowMs) / 60_000),
  );

  return {
    allowed: false,
    retryAfterMinutes,
    message:
      `You have generated ${rule.limit} plans in the last ${rule.windowMinutes} minutes. ` +
      `Try again in ${retryAfterMinutes} minute${retryAfterMinutes === 1 ? '' : 's'}. ` +
      `If you are changing your profile to see what happens, the comparison view will show you that more clearly than regenerating will.`,
  };
}
