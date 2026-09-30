/**
 * POST /api/profile/review
 *
 * Records the annual review. Two outcomes, and the distinction matters:
 *
 *   `unchanged` — the client read their profile and confirmed it still holds.
 *     No new profile version is written, because a version identical to its
 *     predecessor except for a timestamp is noise in an audit. The review
 *     record IS the evidence, and it is what resets the clock.
 *
 *   `updated` — they changed something. The wizard and
 *     `POST /api/profile/commit` do that work; this endpoint only notes that
 *     the review took place, so the two facts stay separately provable.
 */

import { reviewState, pendingMaterialChanges, recordReview } from '../../../../lib/reprofile.ts';
import { requireVerifiedUser, resolveSubject, requestIp } from '../../../../lib/auth.ts';
import { recordAudit } from '../../../../lib/audit.ts';
import { handle, ok, fail, readJson } from '../../../../lib/http.ts';

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireVerifiedUser();
    const body = (await readJson(req).catch(() => ({}))) as {
      userId?: string;
      outcome?: 'unchanged' | 'updated';
    };
    const { subjectUserId, actorId } = await resolveSubject(actor, body.userId);

    const outcome = body.outcome === 'updated' ? 'updated' : 'unchanged';
    const state = await reviewState(subjectUserId);
    if (!state.profileId) {
      return fail('There is no committed profile to review yet.', 409);
    }

    // Refusing to accept "nothing has changed" while the draft plainly says
    // otherwise. Confirming a profile we can see is out of date would put a
    // signed statement of accuracy on record against data we know is stale.
    const pending = await pendingMaterialChanges(subjectUserId);
    if (outcome === 'unchanged' && pending.length > 0) {
      return fail(
        'Your answers have changed since this profile was saved, so we cannot record it as unchanged. ' +
          'Finish the update and save it — that counts as your review.',
        409,
        { pendingMaterialChanges: pending },
      );
    }

    const ctx = { userId: subjectUserId, actorId, ip: await requestIp() };
    await recordReview({
      userId: subjectUserId,
      profileId: state.profileId,
      outcome,
      changes: pending,
      reviewedBy: actorId,
    });
    await recordAudit('profile.reviewed', 'Profile', state.profileId, ctx, {
      outcome,
      changeCount: pending.length,
      profileVersion: state.profileVersion,
    });

    const after = await reviewState(subjectUserId);
    return ok({ status: 'reviewed', outcome, nextReviewInDays: after.status?.dueInDays ?? null });
  });
}
