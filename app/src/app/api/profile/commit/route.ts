/**
 * POST /api/profile/commit
 *
 * Assembles the draft, validates the whole profile, and writes a new immutable
 * version. Returns `unchanged` when nothing moved, so re-submitting does not
 * fill the audit history with noise.
 */

import { commitProfileFromDraft } from '../../../../lib/profile-service.ts';
import { requireVerifiedUser, resolveSubject, requestIp } from '../../../../lib/auth.ts';
import { handle, ok, fail, readJson } from '../../../../lib/http.ts';

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireVerifiedUser();
    const body = (await readJson(req).catch(() => ({}))) as { userId?: string };
    const { subjectUserId, actorId } = await resolveSubject(actor, body.userId);

    const result = await commitProfileFromDraft(subjectUserId, {
      userId: subjectUserId, actorId, ip: await requestIp(),
    });

    if (result.status === 'invalid') {
      return fail('Your profile is not complete yet.', 422, { errors: result.errors });
    }
    if (result.status === 'unchanged') {
      return ok({ status: 'unchanged', message: 'Nothing has changed since your last saved profile.' });
    }

    return ok({
      status: 'committed',
      version: result.snapshot.version,
      materialChanges: result.materialChanges,
    });
  });
}
