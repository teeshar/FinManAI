/**
 * GET /api/plan/compare?a=<older>&b=<newer>
 *
 * The diff between two of a client's plans, with the change attributed to a
 * cause where one is knowable. See `plan-diff.ts` for why this is worth a
 * screen of its own.
 *
 * Both plans are authorised independently and must belong to the same person —
 * otherwise this endpoint would be a way to read one plan while holding access
 * to another.
 */

import { diffPlans } from '../../../../lib/plan-diff.ts';
import { requirePlan } from '../../../../lib/plan-access.ts';
import { requireVerifiedUser, requestIp } from '../../../../lib/auth.ts';
import { recordAudit } from '../../../../lib/audit.ts';
import { handle, ok, fail } from '../../../../lib/http.ts';

export async function GET(req: Request) {
  return handle(async () => {
    const actor = await requireVerifiedUser();
    const url = new URL(req.url);
    const a = url.searchParams.get('a');
    const b = url.searchParams.get('b');
    if (!a || !b) return fail('Specify two plans to compare: ?a=<older>&b=<newer>');
    if (a === b) return fail('Those are the same plan.');

    const [older, newer] = await Promise.all([requirePlan(a, actor), requirePlan(b, actor)]);
    if (older.subjectUserId !== newer.subjectUserId) {
      return fail('Those plans belong to different people.', 403);
    }

    const diff = diffPlans(older.plan, newer.plan, {
      profileVersionBefore: older.profileVersion,
      profileVersionAfter: newer.profileVersion,
    });

    await recordAudit('plan.compared', 'Plan', newer.id, {
      userId: newer.subjectUserId,
      actorId: actor.id,
      ip: await requestIp(),
    }, { comparedWith: older.id });

    return ok({
      older: { id: older.id, generatedAt: older.generatedAt, profileVersion: older.profileVersion },
      newer: { id: newer.id, generatedAt: newer.generatedAt, profileVersion: newer.profileVersion },
      diff,
    });
  });
}
