/**
 * POST /api/plan/[id]/approve
 *
 * The adviser's decision to release a plan to the client, or to hold it back.
 *
 * An RIA is personally accountable for advice issued under their name, so in
 * advisory mode a generated plan is not automatically advice — someone signs
 * off on it. In `diagnostic_only` mode there is nothing to sign off, because a
 * diagnostic report makes no recommendation, and the endpoint says so rather
 * than recording a meaningless approval.
 */

import { decidePlan } from '../../../../../lib/adviser-service.ts';
import { requirePlan } from '../../../../../lib/plan-access.ts';
import { requireRole, requestIp } from '../../../../../lib/auth.ts';
import { advisoryMode } from '../../../../../lib/keys.ts';
import { handle, ok, fail, readJson } from '../../../../../lib/http.ts';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const adviser = await requireRole('ADVISER', 'ADMIN');
    const plan = await requirePlan((await params).id, adviser);

    if (advisoryMode() !== 'advisory') {
      return fail(
        'This deployment is in diagnostic-only mode. A diagnostic report makes no recommendation, ' +
          'so there is nothing to approve.',
        409,
      );
    }

    // A plan that cannot be traced to the profile that produced it must not be
    // released by anyone, however senior.
    if (!plan.verifiable) {
      return fail(
        'This plan no longer matches the profile version that produced it. It cannot be released as advice. ' +
          'Generate a fresh plan from the current profile.',
        409,
      );
    }

    const body = (await readJson(req)) as { decision?: string; reason?: string };
    const decision = body.decision === 'withheld' ? 'withheld' : body.decision === 'approved' ? 'approved' : null;
    if (!decision) return fail('Specify a decision: "approved" or "withheld".');

    const reason = (body.reason ?? '').trim() || null;
    if (decision === 'withheld' && !reason) {
      return fail('Say why you are holding this back. The reason is retained with the plan.');
    }

    await decidePlan(plan.id, adviser.id, decision, reason, {
      userId: plan.subjectUserId,
      actorId: adviser.id,
      ip: await requestIp(),
    });

    return ok({ status: decision });
  });
}
