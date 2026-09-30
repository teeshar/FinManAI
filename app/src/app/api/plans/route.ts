/**
 * GET /api/plans — a client's plan history.
 *
 * Returns metadata only, never the plan bodies: a list endpoint should not
 * decrypt and ship nine plans' worth of financial data to render a sidebar.
 */

import { prisma } from '../../../lib/db.ts';
import { requireVerifiedUser, resolveSubject } from '../../../lib/auth.ts';
import { handle, ok } from '../../../lib/http.ts';

export async function GET(req: Request) {
  return handle(async () => {
    const actor = await requireVerifiedUser();
    const url = new URL(req.url);
    const { subjectUserId } = await resolveSubject(actor, url.searchParams.get('userId') ?? undefined);

    const plans = await prisma.plan.findMany({
      where: { profile: { userId: subjectUserId } },
      orderBy: { generatedAt: 'desc' },
      select: {
        id: true,
        generatedAt: true,
        engineVersion: true,
        assumptionsVersion: true,
        advisoryMode: true,
        narrativeSource: true,
        profileHash: true,
        profile: { select: { version: true, dataHash: true } },
      },
    });

    return ok({
      plans: plans.map((p) => ({
        id: p.id,
        generatedAt: p.generatedAt,
        profileVersion: p.profile.version,
        engineVersion: p.engineVersion,
        assumptionsVersion: p.assumptionsVersion,
        advisoryMode: p.advisoryMode,
        narrativeSource: p.narrativeSource,
        // Surfaced so a stale plan is visibly stale rather than quietly wrong.
        verifiable: p.profileHash === p.profile.dataHash,
      })),
    });
  });
}
