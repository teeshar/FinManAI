/**
 * POST /api/profile/draft — save one wizard step
 * GET  /api/profile/draft — load all saved steps
 *
 * Drafts are mutable and disposable. They are not a record of advice, so they
 * are not versioned — but they ARE encrypted, because a half-filled form still
 * contains someone's salary.
 */

import { saveDraftStep, loadDraft } from '../../../../lib/profile-service.ts';
import { validateStep } from '../../../../lib/validation.ts';
import { requireVerifiedUser, resolveSubject, requestIp } from '../../../../lib/auth.ts';
import { handle, ok, fail, readJson } from '../../../../lib/http.ts';

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireVerifiedUser();
    const body = (await readJson(req)) as { step?: number; data?: unknown; userId?: string };

    if (typeof body.step !== 'number') return fail('Missing step number.');
    const { subjectUserId, actorId } = await resolveSubject(actor, body.userId);

    // Validate per step so the user gets errors now, not eight screens later.
    const result = validateStep(body.step, body.data);
    if (!result.success) return fail('Some answers need attention.', 422, { errors: result.errors });

    await saveDraftStep(subjectUserId, body.step, result.data, {
      userId: subjectUserId, actorId, ip: await requestIp(),
    });

    return ok({ status: 'saved', step: body.step });
  });
}

export async function GET(req: Request) {
  return handle(async () => {
    const actor = await requireVerifiedUser();
    const url = new URL(req.url);
    const { subjectUserId } = await resolveSubject(actor, url.searchParams.get('userId') ?? undefined);
    return ok({ steps: await loadDraft(subjectUserId) });
  });
}
