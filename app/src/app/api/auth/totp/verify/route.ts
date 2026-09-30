/**
 * POST /api/auth/totp/verify
 *
 * Completes login. Accepts either a TOTP code or a single-use recovery code,
 * and only now is a session cookie issued.
 */

import { verifyTotp, verifyRecoveryCode } from '../../../../../../../core/src/totp.ts';
import { decryptField } from '../../../../../../../core/src/field-crypto.ts';
import { keyRing } from '../../../../../lib/keys.ts';
import { prisma } from '../../../../../lib/db.ts';
import { recordAudit } from '../../../../../lib/audit.ts';
import { createSession, requestIp } from '../../../../../lib/auth.ts';
import { handle, ok, fail, readJson } from '../../../../../lib/http.ts';
import { createHash } from 'node:crypto';

export async function POST(req: Request) {
  return handle(async () => {
    const body = (await readJson(req)) as { challenge?: string; code?: string; recoveryCode?: string };
    if (!body.challenge) return fail('Sign in again.', 401);

    const ticket = await prisma.session.findUnique({
      where: { tokenHash: createHash('sha256').update(`challenge:${body.challenge}`).digest('hex') },
      include: { user: true },
    });

    if (!ticket || ticket.revokedAt || ticket.expiresAt < new Date()) {
      return fail('That sign-in attempt expired. Please start again.', 401);
    }

    const user = ticket.user;
    let counterUsed: number | undefined;

    if (body.code) {
      if (!user.totpSecretEncrypted) return fail('Two-factor is not set up.', 409);
      const secret = decryptField(user.totpSecretEncrypted, keyRing(), `user:${user.id}:totp`);
      const result = verifyTotp(
        secret,
        body.code,
        Math.floor(Date.now() / 1000),
        undefined,
        // Replay guard: a code already accepted is never accepted twice.
        user.totpLastCounter ?? undefined,
      );
      if (!result.valid) return fail('That code is not right, or has already been used.', 401);
      counterUsed = result.counter;
    } else if (body.recoveryCode) {
      const hashes: string[] = JSON.parse(user.recoveryCodeHashes ?? '[]');
      const index = verifyRecoveryCode(body.recoveryCode, hashes);
      if (index === -1) return fail('That recovery code is not valid.', 401);
      hashes.splice(index, 1); // single use
      await prisma.user.update({
        where: { id: user.id },
        data: { recoveryCodeHashes: JSON.stringify(hashes) },
      });
    } else {
      return fail('Enter a code from your authenticator app, or a recovery code.');
    }

    // Burn the challenge ticket so it cannot be reused.
    await prisma.session.update({ where: { id: ticket.id }, data: { revokedAt: new Date() } });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), ...(counterUsed !== undefined ? { totpLastCounter: counterUsed } : {}) },
    });

    await createSession(user.id);
    await recordAudit('user.login', 'Session', user.id, {
      userId: user.id, actorId: user.id, ip: await requestIp(),
    });

    return ok({ status: 'signed_in' });
  });
}
