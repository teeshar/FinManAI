/**
 * GET /api/auth/google/start — hand the browser off to Google.
 *
 * The `state` and `nonce` are stored as hashes in a short-lived, HttpOnly
 * cookie. Hashed rather than plain so that a cookie read off a device does not
 * hand someone a usable sign-in attempt, and short-lived because an
 * authorization flow that is still open an hour later is not a real one.
 */

import { NextResponse } from 'next/server';
import {
  googleConfig, beginAuth, hashPending, PENDING_COOKIE,
} from '../../../../../lib/oauth-google.ts';
import { fail } from '../../../../../lib/http.ts';

export async function GET() {
  const config = googleConfig();
  if (!config) {
    return fail(
      'Google sign-in is not configured on this deployment. Sign in with your email and password.',
      503,
    );
  }

  const pending = beginAuth(config);
  const response = NextResponse.redirect(pending.url);

  response.cookies.set(PENDING_COOKIE, `${hashPending(pending.state)}.${pending.nonce}`, {
    httpOnly: true,
    sameSite: 'lax', // must survive the top-level redirect back from Google
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });

  return response;
}
