/**
 * GET /api/auth/google/callback — Google sends the browser back here.
 *
 * This route decides whether someone is signed in, so the order of checks
 * matters:
 *
 *   1. The `state` must match the one we issued. Without this, an attacker can
 *      feed their own authorization code into someone else's browser and end up
 *      with the victim signed into the *attacker's* account — where anything
 *      the victim then enters is visible to them.
 *   2. The code is exchanged server-to-server, and the resulting token's claims
 *      are checked, including the nonce.
 *   3. An existing Google link signs that user in. Otherwise we match on the
 *      **verified** email, and only then create an account.
 *
 * Errors redirect back to the sign-in page with a short reason rather than
 * rendering JSON at a URL the user has landed on in their address bar.
 */

import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import {
  googleConfig, completeAuth, stateMatches, hashPending, OAuthError, PENDING_COOKIE,
} from '../../../../../lib/oauth-google.ts';
import { createSession, requestIp } from '../../../../../lib/auth.ts';
import { recordAudit } from '../../../../../lib/audit.ts';
import { prisma } from '../../../../../lib/db.ts';

const appUrl = () => (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const back = (reason: string) =>
  NextResponse.redirect(`${appUrl()}/login?error=${encodeURIComponent(reason)}`);

export async function GET(req: Request) {
  const config = googleConfig();
  if (!config) return back('Google sign-in is not configured.');

  const url = new URL(req.url);
  const store = await cookies();
  const pending = store.get(PENDING_COOKIE)?.value;
  // One attempt per cookie, whatever the outcome.
  store.delete(PENDING_COOKIE);

  if (url.searchParams.get('error')) {
    return back('Google sign-in was cancelled.');
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || !pending) return back('That sign-in link has expired. Try again.');

  const [expectedStateHash, nonce] = pending.split('.');
  if (!expectedStateHash || !nonce) return back('That sign-in link has expired. Try again.');
  if (!stateMatches(expectedStateHash, hashPending(state))) {
    return back('That sign-in could not be verified. Try again.');
  }

  let identity;
  try {
    identity = await completeAuth(config, code, nonce);
  } catch (err) {
    console.error('[google oauth]', err instanceof OAuthError ? err.message : err);
    return back('Google sign-in failed. Try again.');
  }

  if (!identity.emailVerified) {
    // Without a verified address there is nothing safe to match on, and
    // creating an account would let anyone claim any address.
    return back('Google has not verified that email address, so we cannot use it to sign in.');
  }

  const ip = await requestIp();
  const h = await headers();

  // 1. An identity we have seen before.
  const existingLink = await prisma.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider: 'google', providerAccountId: identity.sub } },
    include: { user: true },
  });

  let userId: string;
  let created = false;

  if (existingLink) {
    if (existingLink.user.deletedAt) return back('That account is no longer active.');
    userId = existingLink.userId;
    await prisma.oAuthAccount.update({
      where: { id: existingLink.id },
      data: { lastUsedAt: new Date(), email: identity.email },
    });
  } else {
    // 2. Same verified address as an existing account — link them, so someone
    //    who signed up with a password can start using Google without ending up
    //    with two separate financial histories.
    const byEmail = await prisma.user.findUnique({ where: { email: identity.email } });

    if (byEmail) {
      if (byEmail.deletedAt) return back('That account is no longer active.');
      userId = byEmail.id;
      await prisma.oAuthAccount.create({
        data: { userId, provider: 'google', providerAccountId: identity.sub, email: identity.email },
      });
      // Google asserting a verified address is at least as good as our own
      // verification email, so an account linked this way is verified.
      if (!byEmail.emailVerified) {
        await prisma.user.update({ where: { id: userId }, data: { emailVerified: new Date() } });
      }
    } else {
      // 3. A new account. No password: this identity is the only way in unless
      //    they set one later.
      const user = await prisma.user.create({
        data: { email: identity.email, passwordHash: null, emailVerified: new Date() },
      });
      userId = user.id;
      created = true;
      await prisma.oAuthAccount.create({
        data: { userId, provider: 'google', providerAccountId: identity.sub, email: identity.email },
      });
      await recordAudit('user.created', 'User', userId, { userId, actorId: userId, ip }, {
        via: 'google',
      });
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      lastLoginAt: new Date(),
      // A successful federated sign-in clears the password throttle: the lockout
      // exists to slow password guessing, and no password was guessed here.
      failedAttempts: 0, lockedUntil: null, firstFailureAt: null,
    },
  });

  await createSession(userId);
  await recordAudit('user.login', 'User', userId, { userId, actorId: userId, ip }, {
    method: 'google',
    newAccount: created,
    userAgent: h.get('user-agent')?.slice(0, 120) ?? null,
  });

  return NextResponse.redirect(appUrl() + '/');
}
