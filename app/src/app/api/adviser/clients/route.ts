/**
 * GET /api/adviser/clients — the adviser's active client list.
 */

import { prisma } from '../../../../lib/db.ts';
import { requireRole } from '../../../../lib/auth.ts';
import { handle, ok } from '../../../../lib/http.ts';

export async function GET() {
  return handle(async () => {
    const adviser = await requireRole('ADVISER', 'ADMIN');

    const links = await prisma.adviserClient.findMany({
      where: { adviserId: adviser.id, revokedAt: null },
      include: {
        client: {
          select: {
            id: true,
            email: true,
            profiles: {
              where: { isActive: true },
              select: { version: true, createdAt: true, planningMode: true },
            },
          },
        },
      },
      orderBy: { invitedAt: 'desc' },
    });

    // SEBI grades the lien deposit by client count, so the adviser should be
    // able to see where they sit against the next threshold.
    const active = links.filter((l) => l.status === 'active').length;

    return ok({
      activeClients: active,
      depositBand:
        active <= 150 ? '₹1,00,000' : active <= 300 ? '₹2,00,000' : active <= 1000 ? '₹5,00,000' : '₹10,00,000',
      clients: links.map((l) => ({
        id: l.client.id,
        email: l.client.email,
        status: l.status,
        invitedAt: l.invitedAt,
        acceptedAt: l.acceptedAt,
        profileVersion: l.client.profiles[0]?.version ?? null,
        profileUpdatedAt: l.client.profiles[0]?.createdAt ?? null,
        planningMode: l.client.profiles[0]?.planningMode ?? null,
      })),
    });
  });
}
