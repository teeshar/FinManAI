/**
 * Session handling and route guards.
 *
 * Everything that decides "may this request see this data" lives here, so no
 * route handler has to get it right on its own.
 */

import { cookies, headers } from 'next/headers';
import {
  issueSession, validateSession, touchSession, revokeSession,
  sessionCookieOptions, SESSION_CONFIG,
} from '../../../core/src/session.ts';
import { blindIndex } from '../../../core/src/field-crypto.ts';
import { ipPepper } from './keys.ts';
import { prisma } from './db.ts';

export const SESSION_COOKIE = 'finmanai_session';

export type AuthedUser = {
  id: string;
  email: string;
  role: 'CLIENT' | 'ADVISER' | 'COMPLIANCE' | 'ADMIN';
  totpEnabled: boolean;
  /** True when this account signs in through Google. */
  hasGoogle: boolean;
  /**
   * Whether this account is protected by more than a password.
   *
   * Two things satisfy it. An authenticator app is the original route. Google
   * sign-in is the other, and it counts because there is no password of ours to
   * steal — reaching the account means holding the Google account itself, which
   * carries whatever protection its owner has put on it.
   *
   * The distinction matters because the product refuses to produce a financial
   * plan for an account guarded by a password alone.
   */
  stronglyAuthenticated: boolean;
  sessionId: string;
};

/* ------------------------------------------------------------------ */
/* Request context                                                     */
/* ------------------------------------------------------------------ */

export async function requestIp(): Promise<string | null> {
  const h = await headers();
  // Trust only the leftmost entry, and only behind a proxy you control.
  const forwarded = h.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
}

export async function requestIpHash(): Promise<string | null> {
  const ip = await requestIp();
  return ip ? blindIndex(ip, ipPepper()) : null;
}

/* ------------------------------------------------------------------ */
/* Session lifecycle                                                   */
/* ------------------------------------------------------------------ */

export async function createSession(userId: string): Promise<void> {
  const h = await headers();
  const sessionId = crypto.randomUUID();

  const { token, record } = issueSession({
    sessionId,
    userId,
    nowISO: new Date().toISOString(),
    userAgent: h.get('user-agent'),
    ipHash: await requestIpHash(),
  });

  // Cap concurrent sessions: revoke the oldest beyond the limit rather than
  // letting an account accumulate live sessions forever.
  const live = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
  });
  const excess = live.slice(SESSION_CONFIG.maxConcurrent - 1);
  if (excess.length > 0) {
    await prisma.session.updateMany({
      where: { id: { in: excess.map((s) => s.id) } },
      data: { revokedAt: new Date() },
    });
  }

  await prisma.session.create({
    data: {
      id: record.id,
      userId: record.userId,
      tokenHash: record.tokenHash,
      createdAt: new Date(record.createdAt),
      lastSeenAt: new Date(record.lastSeenAt),
      expiresAt: new Date(record.expiresAt),
      userAgent: record.userAgent,
      ipHash: record.ipHash,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(process.env.NODE_ENV === 'production'));
}

/** Current user, or null. Rolls the idle window forward on every valid read. */
export async function currentUser(): Promise<AuthedUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const { hashToken } = await import('../../../core/src/session.ts');
  const row = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { oauthAccounts: { select: { provider: true } } } } },
  });
  if (!row) return null;

  const check = validateSession(
    token,
    {
      id: row.id,
      userId: row.userId,
      tokenHash: row.tokenHash,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      userAgent: row.userAgent,
      ipHash: row.ipHash,
    },
    new Date().toISOString(),
  );

  if (!check.valid) return null;
  if (row.user.deletedAt) return null;

  const touched = touchSession(check.record, new Date().toISOString());
  await prisma.session.update({
    where: { id: row.id },
    data: { lastSeenAt: new Date(touched.lastSeenAt) },
  });

  const hasGoogle = row.user.oauthAccounts.some((a) => a.provider === 'google');

  return {
    id: row.user.id,
    email: row.user.email,
    role: row.user.role as AuthedUser['role'],
    totpEnabled: row.user.totpEnabled,
    hasGoogle,
    stronglyAuthenticated: row.user.totpEnabled || hasGoogle,
    sessionId: row.id,
  };
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const { hashToken } = await import('../../../core/src/session.ts');
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { revokedAt: new Date() },
    });
  }
  store.delete(SESSION_COOKIE);
}

/** Revoke every session for a user. Used on password change and on demand. */
export async function endAllSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function requireUser(): Promise<AuthedUser> {
  const user = await currentUser();
  if (!user) throw new AuthError('Sign in to continue.', 401);
  return user;
}

/**
 * For anything that touches financial data.
 *
 * A password on its own is never enough here — the account must be protected by
 * an authenticator app or by Google sign-in.
 */
export async function requireVerifiedUser(): Promise<AuthedUser> {
  const user = await requireUser();
  if (!user.stronglyAuthenticated) {
    throw new AuthError(
      'Protect your account with an authenticator app, or sign in with Google, before accessing financial data.',
      403,
    );
  }
  return user;
}

export async function requireRole(...roles: AuthedUser['role'][]): Promise<AuthedUser> {
  const user = await requireVerifiedUser();
  if (!roles.includes(user.role)) throw new AuthError('You do not have access to this.', 403);
  return user;
}

/**
 * Resolve whose profile is being acted on.
 *
 * A client may only ever reach their own. An adviser may reach a client's only
 * through an active, accepted link — and that read is itself audited by the
 * profile service.
 */
export async function resolveSubject(
  actor: AuthedUser,
  requestedUserId?: string,
): Promise<{ subjectUserId: string; actorId: string }> {
  if (!requestedUserId || requestedUserId === actor.id) {
    return { subjectUserId: actor.id, actorId: actor.id };
  }

  if (actor.role !== 'ADVISER' && actor.role !== 'ADMIN') {
    throw new AuthError('You do not have access to this.', 403);
  }

  const link = await prisma.adviserClient.findUnique({
    where: { adviserId_clientId: { adviserId: actor.id, clientId: requestedUserId } },
  });
  if (!link || link.status !== 'active' || link.revokedAt) {
    throw new AuthError('You are not authorised to act for this client.', 403);
  }

  return { subjectUserId: requestedUserId, actorId: actor.id };
}
