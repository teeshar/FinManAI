/**
 * POST /api/adviser/invite — invite a client to be advised.
 *
 * Creates the link in `invited` state only. The client must accept before the
 * adviser can read anything: consent to be advised is the client's to give,
 * never the adviser's to assume.
 */

import { prisma } from '../../../../lib/db.ts';
import { recordAudit } from '../../../../lib/audit.ts';
import { requireRole, requestIp } from '../../../../lib/auth.ts';
import { handle, ok, fail, readJson } from '../../../../lib/http.ts';

export async function POST(req: Request) {
  return handle(async () => {
    const adviser = await requireRole('ADVISER', 'ADMIN');
    const { email } = (await readJson(req)) as { email?: string };
    if (!email) return fail('Enter the client’s email address.');

    const client = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });

    // Same response either way — an adviser should not be able to probe which
    // email addresses have accounts.
    if (!client || client.id === adviser.id) return ok({ status: 'invited' });

    await prisma.adviserClient.upsert({
      where: { adviserId_clientId: { adviserId: adviser.id, clientId: client.id } },
      create: { adviserId: adviser.id, clientId: client.id, status: 'invited' },
      update: { status: 'invited', revokedAt: null },
    });

    await recordAudit('adviser.linked', 'AdviserClient', client.id, {
      userId: client.id, actorId: adviser.id, ip: await requestIp(),
    }, { state: 'invited' });

    return ok({ status: 'invited' });
  });
}
