/**
 * Sign in with Google.
 *
 * The authorization-code flow, written directly against Google's endpoints
 * rather than through a framework. That is a deliberate choice for this
 * codebase: the whole flow is about a hundred lines, it is the single most
 * security-sensitive path in the application, and a dependency here would put
 * the decision of *what counts as an authenticated user* inside somebody else's
 * abstraction.
 *
 * **Why the ID token's signature is not checked here.** The token is not read
 * from the browser — it is fetched by this server from Google's token endpoint
 * over TLS, in a request authenticated with our client secret. Google's own
 * documentation says a token obtained that way needs no signature validation,
 * because the transport already establishes it came from Google and was issued
 * to us. What still must be checked, and is below, are the claims: issuer,
 * audience, expiry, and that Google actually verified the address.
 *
 * **Why accounts are matched on `sub`, never on email.** Email addresses get
 * changed and, on some domains, reassigned to a different person. `sub` is
 * Google's stable identifier for the account. Matching on the address is how
 * one person ends up signed into another person's financial position.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/**
 * Holds the hashed `state` and the `nonce` between leaving for Google and
 * coming back. Lives here rather than in a route file because a Next route
 * module may only export handlers and a fixed set of config keys — anything
 * else is a build error.
 */
export const PENDING_COOKIE = 'finmanai_oauth';

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function googleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const base = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return { clientId, clientSecret, redirectUri: `${base}/api/auth/google/callback` };
}

/** True when Google sign-in is configured. The button is hidden when it is not. */
export const googleEnabled = () => googleConfig() !== null;

/* ------------------------------------------------------------------ */
/* Outbound                                                            */
/* ------------------------------------------------------------------ */

export type PendingAuth = { state: string; nonce: string; url: string };

/**
 * Begin the flow.
 *
 * `state` is CSRF protection: it is stored in a cookie and compared on return,
 * so a link that drops someone into our callback with an attacker's code fails.
 * `nonce` is bound into the ID token by Google and checked on the way back, so
 * a token captured from one sign-in cannot be replayed into another.
 */
export function beginAuth(config: GoogleConfig): PendingAuth {
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  // Ask Google to show the account chooser rather than silently reusing a
  // session — on a shared machine, signing in as "whoever was last here" is a
  // bad default for a financial application.
  url.searchParams.set('prompt', 'select_account');

  return { state, nonce, url: url.toString() };
}

/* ------------------------------------------------------------------ */
/* Inbound                                                             */
/* ------------------------------------------------------------------ */

export type GoogleIdentity = {
  /** Google's stable subject id. The only safe key for an account. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
};

export class OAuthError extends Error {}

/** Constant-time comparison, so a returned state cannot be probed byte by byte. */
export function stateMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Exchange the authorization code for an ID token, and read the identity out
 * of it.
 */
export async function completeAuth(
  config: GoogleConfig,
  code: string,
  expectedNonce: string,
): Promise<GoogleIdentity> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    // Google's body can echo request details; keep it out of our logs and out
    // of the response the browser sees.
    throw new OAuthError(`Google rejected the sign-in (HTTP ${res.status}).`);
  }

  const token = (await res.json()) as { id_token?: string };
  if (!token.id_token) throw new OAuthError('Google returned no identity token.');

  const claims = decodeJwtPayload(token.id_token);

  if (!ISSUERS.has(String(claims.iss))) throw new OAuthError('Identity token has the wrong issuer.');
  if (claims.aud !== config.clientId) throw new OAuthError('Identity token was issued for a different application.');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) {
    throw new OAuthError('Identity token has expired.');
  }
  if (claims.nonce !== expectedNonce) {
    throw new OAuthError('Identity token does not match this sign-in attempt.');
  }
  if (!claims.sub || typeof claims.sub !== 'string') {
    throw new OAuthError('Identity token carries no subject.');
  }

  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  // An unverified address must never be trusted to match an existing account:
  // it would let anyone who can claim an address take over the account behind
  // it. Google marks consumer Gmail verified; some Workspace configurations do
  // not.
  const emailVerified = claims.email_verified === true;

  if (!email) throw new OAuthError('Google did not return an email address.');

  return {
    sub: claims.sub,
    email,
    emailVerified,
    name: typeof claims.name === 'string' ? claims.name : undefined,
  };
}

/**
 * Read a JWT's payload without verifying its signature.
 *
 * Safe *only* because of where this token came from — see the note at the top
 * of this file. Do not reuse this for a token that arrived from a browser.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new OAuthError('Malformed identity token.');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new OAuthError('Identity token payload could not be read.');
  }
}

/** Hash for the transient state/nonce cookie, so neither is stored in the clear. */
export const hashPending = (value: string) =>
  createHash('sha256').update(`oauth:${value}`).digest('hex');
