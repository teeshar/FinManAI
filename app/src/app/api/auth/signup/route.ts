/**
 * POST /api/auth/signup
 *
 * Creates an account and sends a verification email. Deliberately does NOT
 * create a session: email must be verified and 2FA enrolled before anything
 * financial happens.
 */

import { hashPassword, validatePassword } from '../../../../../../core/src/password.ts';
import { prisma } from '../../../../lib/db.ts';
import { recordAudit } from '../../../../lib/audit.ts';
import { requestIp } from '../../../../lib/auth.ts';
import { handle, ok, fail, readJson } from '../../../../lib/http.ts';
import { deliverSoon } from '../../../../lib/mailer.ts';
import { verificationMessage, alreadyRegisteredMessage } from '../../../../lib/reminders.ts';
import { randomBytes, createHash } from 'node:crypto';

export async function POST(req: Request) {
  return handle(async () => {
    const body = (await readJson(req)) as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? '';

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return fail('Enter a valid email address.');
    }

    const problems = validatePassword(password, email);
    if (problems.length > 0) {
      const messages: Record<string, string> = {
        too_short: 'Use at least 12 characters.',
        too_long: 'That password is too long.',
        too_common: 'That password appears in known breach lists.',
        contains_email: 'Do not use your email address in your password.',
        known_breached: 'That password appears in known breach lists.',
      };
      return fail(problems.map((p) => messages[p]).join(' '), 422);
    }

    const existing = await prisma.user.findUnique({ where: { email } });

    // Never reveal whether an address is registered. Both paths return the same
    // response and take similar time.
    if (existing) {
      await hashPassword(password, { N: 16384, r: 8, p: 1, keyLength: 32 });

      // Tell the mailbox, not the caller. Without this the person is told to
      // check their email and nothing ever arrives — they conclude the product
      // is broken, which is exactly what happened during development. Only the
      // real owner of the address sees this, so nothing is disclosed.
      const existingMessage = alreadyRegisteredMessage(existing.emailVerified !== null);
      await deliverSoon({
        userId: existing.id,
        kind: 'verify_email',
        toEmail: email,
        subject: existingMessage.subject,
        body: existingMessage.body,
        // Rate-limited to one a day per account, so this cannot be turned into
        // a way to flood someone's inbox by repeatedly "signing up" as them.
        dedupeKey: `already_registered:${existing.id}:${new Date().toISOString().slice(0, 10)}`,
      });

      return ok({ status: 'check_your_email' });
    }

    const verifyToken = randomBytes(32).toString('base64url');
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        // Reuse the session table's hashing discipline: store only the hash.
        totpSecretEncrypted: null,
      },
    });

    await prisma.session.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        tokenHash: createHash('sha256').update(`verify:${verifyToken}`).digest('hex'),
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      },
    });

    await recordAudit('user.created', 'User', user.id, {
      userId: user.id,
      actorId: user.id,
      ip: await requestIp(),
    });

    // Queued, then delivered without blocking this response. The row is the
    // record of what we owe them; delivery is a separate, retryable step, so a
    // slow mail server cannot turn a successful signup into a failed request.
    const message = verificationMessage(verifyToken);
    await deliverSoon({
      userId: user.id,
      kind: 'verify_email',
      toEmail: email,
      subject: message.subject,
      body: message.body,
      // One verification mail per token. A retried signup mints a new token and
      // therefore legitimately sends again.
      dedupeKey: `verify_email:${user.id}:${createHash('sha256').update(verifyToken).digest('hex').slice(0, 16)}`,
    });

    // Also printed in development, so the flow is testable with no mail server
    // configured at all. Never in production: the token is a bearer credential
    // and logs are not the place for one.
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[dev] verify link: ${process.env.APP_URL ?? ''}/verify-email?token=${verifyToken}`);
    }

    return ok({ status: 'check_your_email' });
  });
}
