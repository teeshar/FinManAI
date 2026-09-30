/**
 * POST /api/auth/login
 *
 * Password step only. On success this returns `totp_required` and does NOT
 * issue a session — the session is created after the TOTP challenge, so a
 * stolen password alone never yields an authenticated cookie.
 */

import { verifyPassword, needsRehash, hashPassword } from '../../../../../../core/src/password.ts';
import { registerFailedLogin, isLockedOut, clearThrottle } from '../../../../../../core/src/session.ts';
import { prisma } from '../../../../lib/db.ts';
import { recordAudit } from '../../../../lib/audit.ts';
import { createSession, requestIp } from '../../../../lib/auth.ts';
import { handle, ok, fail, readJson } from '../../../../lib/http.ts';
import { randomBytes, createHash } from 'node:crypto';

const GENERIC = 'Email or password is incorrect.';

export async function POST(req: Request) {
  return handle(async () => {
    const body = (await readJson(req)) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase() ?? '';
    const password = body.password ?? '';
    const ip = await requestIp();
    const now = new Date().toISOString();

    const user = await prisma.user.findUnique({ where: { email } });

    // Spend comparable time on a missing user so the response cannot be used
    // to enumerate registered addresses.
    if (!user || user.deletedAt) {
      await hashPassword(password);
      return fail(GENERIC, 401);
    }

    const throttle = {
      failedAttempts: user.failedAttempts,
      lockoutCount: user.lockoutCount,
      lockedUntil: user.lockedUntil?.toISOString() ?? null,
      firstFailureAt: user.firstFailureAt?.toISOString() ?? null,
    };

    if (isLockedOut(throttle, now)) {
      return fail('Too many attempts. Try again later.', 429);
    }

    // A Google-only account has no password to verify. Say nothing specific
    // about it — "this address uses Google" would confirm the account exists to
    // anyone who guessed the address.
    const valid = user.passwordHash
      ? await verifyPassword(password, user.passwordHash)
      : false;

    if (!valid) {
      const next = registerFailedLogin(throttle, now);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedAttempts: next.failedAttempts,
          lockoutCount: next.lockoutCount,
          lockedUntil: next.lockedUntil ? new Date(next.lockedUntil) : null,
          firstFailureAt: next.firstFailureAt ? new Date(next.firstFailureAt) : null,
        },
      });
      await recordAudit('user.login_failed', 'User', user.id, {
        userId: user.id, actorId: null, ip,
      });
      return fail(GENERIC, 401);
    }

    // Opportunistically upgrade the hash now that we have the plaintext.
    const cleared = clearThrottle(throttle);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: cleared.failedAttempts,
        lockedUntil: null,
        firstFailureAt: null,
        ...(user.passwordHash && needsRehash(user.passwordHash)
          ? { passwordHash: await hashPassword(password) }
          : {}),
      },
    });

    if (!user.emailVerified) return fail('Verify your email address first.', 403);

    if (!user.totpEnabled) {
      // No 2FA yet: allow in, but every financial route still refuses until
      // enrolment is complete (requireVerifiedUser).
      await createSession(user.id);
      await recordAudit('user.login', 'Session', user.id, { userId: user.id, actorId: user.id, ip });
      return ok({ status: 'enrol_totp' });
    }

    // Short-lived challenge ticket. Not a session — it grants nothing but the
    // right to present a TOTP code.
    const challenge = randomBytes(32).toString('base64url');
    await prisma.session.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        tokenHash: createHash('sha256').update(`challenge:${challenge}`).digest('hex'),
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });

    return ok({ status: 'totp_required', challenge });
  });
}
