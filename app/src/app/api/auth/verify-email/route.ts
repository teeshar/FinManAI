/**
 * POST /api/auth/verify-email
 *
 * Consumes the token issued at signup. The token is stored hashed, single-use,
 * and expires in 24 hours — the same discipline as a session token, because it
 * grants the same thing: the ability to become this account.
 */

import { prisma } from '../../../../lib/db.ts';
import { recordAudit } from '../../../../lib/audit.ts';
import { requestIp } from '../../../../lib/auth.ts';
import { handle, ok, fail, readJson } from '../../../../lib/http.ts';
import { createHash } from 'node:crypto';

export async function POST(req: Request) {
  return handle(async () => {
    const { token } = (await readJson(req)) as { token?: string };
    if (!token) return fail('Verification link is missing its token.');

    const row = await prisma.session.findUnique({
      where: { tokenHash: createHash('sha256').update(`verify:${token}`).digest('hex') },
      include: { user: true },
    });

    // One generic message for every failure mode: unknown, used, or expired.
    // Distinguishing them tells an attacker which tokens once existed.
    if (!row || row.revokedAt || row.expiresAt < new Date()) {
      return fail('That verification link is no longer valid. Request a new one.', 400);
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.userId },
        data: { emailVerified: new Date() },
      }),
      // Burn the token so the link cannot be reused from a forwarded email.
      prisma.session.update({ where: { id: row.id }, data: { revokedAt: new Date() } }),
    ]);

    await recordAudit('user.created', 'User', row.userId, {
      userId: row.userId, actorId: row.userId, ip: await requestIp(),
    }, { emailVerified: true });

    return ok({ status: 'verified' });
  });
}
