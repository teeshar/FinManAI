/**
 * GET /api/adviser/queue
 *
 * Which of this adviser's clients need attention, most urgent first — overdue
 * reviews, plans awaiting release, profiles built on superseded assumptions.
 *
 * Metadata only: an adviser's morning triage list should not decrypt a single
 * client's financial position.
 */

import { adviserQueue } from '../../../../lib/adviser-service.ts';
import { requireRole } from '../../../../lib/auth.ts';
import { handle, ok } from '../../../../lib/http.ts';

export async function GET() {
  return handle(async () => {
    const adviser = await requireRole('ADVISER', 'ADMIN');
    return ok(await adviserQueue(adviser.id));
  });
}
