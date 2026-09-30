/**
 * GET /api/profile/status
 *
 * "Is my plan still true?" — the annual review clock, plus anything in the
 * draft that has moved since the profile was last committed.
 *
 * Metadata only. This is read on every dashboard render and has no business
 * decrypting a profile to report when it was last looked at.
 */

import { reviewState, pendingMaterialChanges } from '../../../../lib/reprofile.ts';
import { requireVerifiedUser, resolveSubject } from '../../../../lib/auth.ts';
import { handle, ok } from '../../../../lib/http.ts';

export async function GET(req: Request) {
  return handle(async () => {
    const actor = await requireVerifiedUser();
    const url = new URL(req.url);
    const { subjectUserId } = await resolveSubject(actor, url.searchParams.get('userId') ?? undefined);

    const [state, pending] = await Promise.all([
      reviewState(subjectUserId),
      pendingMaterialChanges(subjectUserId),
    ]);

    return ok({ ...state, pendingMaterialChanges: pending });
  });
}
