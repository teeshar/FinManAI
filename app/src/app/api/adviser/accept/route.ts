/**
 * POST /api/adviser/accept — the CLIENT accepts or revokes an adviser link.
 *
 * Deliberately a client-side action. Nothing an adviser does can grant them
 * access to someone's finances.
 */

import { prisma } from '../../../../lib/db.ts';
import { recordAudit } from '../../../../lib/audit.ts';
import { requireVerifiedUser, requestIp } from '../../../../lib/auth.ts';
import { handle, ok, fail, readJson } from '../../../../lib/http.ts';

export async function POST(req: Request) {
  return handle(async () => {
    const client = await requireVerifiedUser();
    const { adviserId, action } = (await readJson(req)) as {
      adviserId?: string;
      action?: 'accept' | 'revoke';
    };
    if (!adviserId || (action !== 'accept' && action !== 'revoke')) {
      return fail('Specify an adviser and whether to accept or revoke.');
    }

    const link = await prisma.adviserClient.findUnique({
      where: { adviserId_clientId: { adviserId, clientId: client.id } },
    });
    if (!link) return fail('No such invitation.', 404);

    await prisma.adviserClient.update({
      where: { id: link.id },
      data:
        action === 'accept'
          ? { status: 'active', acceptedAt: new Date(), revokedAt: null }
          : { status: 'revoked', revokedAt: new Date() },
    });

    await recordAudit('adviser.linked', 'AdviserClient', link.id, {
      userId: client.id, actorId: client.id, ip: await requestIp(),
    }, { state: action === 'accept' ? 'active' : 'revoked' });

    return ok({ status: action === 'accept' ? 'active' : 'revoked' });
  });
}
