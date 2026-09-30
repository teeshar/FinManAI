/**
 * POST /api/plan/generate
 *
 * The gates (consent, 2FA, signed agreement) live in the plan service, not
 * here — one place to get right rather than one per route.
 *
 * The rate limit does live here, because it is about request volume rather
 * than about advice: generation is cheap to run but every plan writes an audit
 * event, and audit appends serialise against each other across the whole
 * system. One impatient client should not slow everybody's audit trail.
 */

import { loadActiveProfile } from '../../../../lib/profile-service.ts';
import { generateAndStorePlan } from '../../../../lib/plan-service.ts';
import { requireVerifiedUser, resolveSubject, requestIp } from '../../../../lib/auth.ts';
import { checkRateLimit, PLAN_GENERATION_LIMIT } from '../../../../lib/rate-limit.ts';
import { handle, ok, fail, readJson } from '../../../../lib/http.ts';

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireVerifiedUser();
    const body = (await readJson(req).catch(() => ({}))) as { userId?: string };
    const { subjectUserId, actorId } = await resolveSubject(actor, body.userId);
    const ctx = { userId: subjectUserId, actorId, ip: await requestIp() };

    const limit = await checkRateLimit('plan.generated', subjectUserId, PLAN_GENERATION_LIMIT);
    if (!limit.allowed) return fail(limit.message, 429);

    const snapshot = await loadActiveProfile(subjectUserId, ctx);
    if (!snapshot) return fail('Complete your profile before generating a plan.', 409);

    const result = await generateAndStorePlan(snapshot, ctx);
    if (result.status === 'blocked') return fail(result.reason, 403);

    return ok({ status: 'generated', planId: result.planId });
  });
}
