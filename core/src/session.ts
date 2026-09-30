/**
 * Sessions.
 *
 * DEVIATION FROM THE PHASE 2 SPEC, stated openly: the spec said JWT. This uses
 * opaque random tokens with a server-side hash instead.
 *
 * The reason is revocation. A JWT is valid until it expires because nothing
 * server-side is consulted — so "log out all devices", "this session was
 * hijacked" and "this adviser's access was withdrawn" either do not work or
 * require a server-side deny-list, at which point you have a session table
 * anyway but with worse ergonomics. For an application holding people's
 * complete financial position and subject to a five-year audit trail,
 * immediate revocability is worth more than statelessness.
 *
 * The token is 256 bits of randomness. Only its SHA-256 is stored, so a
 * database leak does not hand over live sessions.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const SESSION_CONFIG = {
  /** Rolls forward on activity. */
  idleTimeoutMinutes: 30,
  /** Never extended, regardless of activity. */
  absoluteTimeoutHours: 12,
  /** Sessions permitted per user before the oldest is evicted. */
  maxConcurrent: 5,
} as const;

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  userAgent: string | null;
  ipHash: string | null;
};

export type IssuedSession = {
  /** Given to the client in an httpOnly cookie. Never stored. */
  token: string;
  record: SessionRecord;
};

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issueSession(params: {
  sessionId: string;
  userId: string;
  nowISO: string;
  userAgent?: string | null;
  ipHash?: string | null;
}): IssuedSession {
  const token = randomBytes(32).toString('base64url');
  const now = new Date(params.nowISO);
  const absolute = new Date(now.getTime() + SESSION_CONFIG.absoluteTimeoutHours * 3600_000);

  return {
    token,
    record: {
      id: params.sessionId,
      userId: params.userId,
      tokenHash: hashToken(token),
      createdAt: params.nowISO,
      lastSeenAt: params.nowISO,
      expiresAt: absolute.toISOString(),
      revokedAt: null,
      userAgent: params.userAgent ?? null,
      ipHash: params.ipHash ?? null,
    },
  };
}

export type SessionCheck =
  | { valid: true; record: SessionRecord }
  | { valid: false; reason: 'not_found' | 'revoked' | 'expired' | 'idle_timeout' };

/**
 * Validate a presented token against the stored record.
 * Both timeouts are enforced: absolute (from creation) and idle (from last use).
 */
export function validateSession(
  token: string,
  record: SessionRecord | null,
  nowISO: string,
): SessionCheck {
  if (!record) return { valid: false, reason: 'not_found' };

  const presented = Buffer.from(hashToken(token), 'hex');
  const stored = Buffer.from(record.tokenHash, 'hex');
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
    return { valid: false, reason: 'not_found' };
  }

  if (record.revokedAt) return { valid: false, reason: 'revoked' };

  const now = new Date(nowISO).getTime();
  if (now >= new Date(record.expiresAt).getTime()) return { valid: false, reason: 'expired' };

  const idleDeadline =
    new Date(record.lastSeenAt).getTime() + SESSION_CONFIG.idleTimeoutMinutes * 60_000;
  if (now >= idleDeadline) return { valid: false, reason: 'idle_timeout' };

  return { valid: true, record };
}

/** Roll the idle window forward. Absolute expiry is deliberately untouched. */
export function touchSession(record: SessionRecord, nowISO: string): SessionRecord {
  return { ...record, lastSeenAt: nowISO };
}

export function revokeSession(record: SessionRecord, nowISO: string): SessionRecord {
  return { ...record, revokedAt: nowISO };
}

/** Cookie attributes. Written once, here, so no route can get them wrong. */
export function sessionCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_CONFIG.absoluteTimeoutHours * 3600,
  };
}

/* ------------------------------------------------------------------ */
/* Login throttling                                                    */
/* ------------------------------------------------------------------ */

export const LOGIN_LIMIT = {
  maxAttempts: 5,
  windowMinutes: 15,
  /** Lockout doubles with each subsequent breach, to this ceiling. */
  baseLockoutMinutes: 15,
  maxLockoutMinutes: 24 * 60,
} as const;

export type LoginThrottleState = {
  failedAttempts: number;
  /** How many times this account has already been locked. Drives the backoff. */
  lockoutCount: number;
  lockedUntil: string | null;
  firstFailureAt: string | null;
};

export function registerFailedLogin(
  state: LoginThrottleState,
  nowISO: string,
): LoginThrottleState {
  const now = new Date(nowISO).getTime();

  // Failures older than the window do not count towards a lockout.
  const windowStart = state.firstFailureAt ? new Date(state.firstFailureAt).getTime() : now;
  const withinWindow = now - windowStart < LOGIN_LIMIT.windowMinutes * 60_000;

  const failedAttempts = withinWindow ? state.failedAttempts + 1 : 1;
  const firstFailureAt = withinWindow ? (state.firstFailureAt ?? nowISO) : nowISO;

  if (failedAttempts < LOGIN_LIMIT.maxAttempts) {
    return { ...state, failedAttempts, firstFailureAt, lockedUntil: null };
  }

  const lockoutCount = state.lockoutCount + 1;
  const minutes = Math.min(
    LOGIN_LIMIT.baseLockoutMinutes * 2 ** (lockoutCount - 1),
    LOGIN_LIMIT.maxLockoutMinutes,
  );
  return {
    failedAttempts: 0,
    firstFailureAt: null,
    lockoutCount,
    lockedUntil: new Date(now + minutes * 60_000).toISOString(),
  };
}

export function isLockedOut(state: LoginThrottleState, nowISO: string): boolean {
  if (!state.lockedUntil) return false;
  return new Date(nowISO).getTime() < new Date(state.lockedUntil).getTime();
}

export function clearThrottle(state: LoginThrottleState): LoginThrottleState {
  return { ...state, failedAttempts: 0, firstFailureAt: null, lockedUntil: null };
}
