/**
 * Versioned, immutable profile snapshots.
 *
 * The single most consequential storage decision in Phase 2: a profile is never
 * edited in place. Every commit writes a new version, and plans reference the
 * exact version that produced them by hash.
 *
 * Why it has to work this way: SEBI requires five-year retention and requires
 * that advice be justifiable after the fact. If a client's profile is mutable,
 * a plan generated in March can never be explained in September — the inputs
 * that produced it are simply gone, overwritten by a later edit. "We recommended
 * 70% equity because at the time you had a 20-year horizon and no dependents"
 * is only defensible if you can prove what the profile said at the time.
 *
 * Storage-agnostic on purpose: these are pure functions over a repository
 * interface, so they are testable without a database and portable across one.
 */

import { hashObject } from './audit.ts';

export type ProfileSnapshot = {
  id: string;
  userId: string;
  version: number;
  isActive: boolean;
  /** The full FinancialProfile, already validated. */
  data: unknown;
  /** SHA-256 of canonical `data`. Computed on plaintext, before encryption. */
  dataHash: string;
  createdAt: string;
  /** userId of whoever committed it — the client, or an adviser acting for them. */
  createdBy: string;
};

export type DraftStep = {
  userId: string;
  step: number;
  data: unknown;
  updatedAt: string;
};

/**
 * Commit a validated profile as a new immutable version.
 *
 * Returns null when nothing changed: re-committing an identical profile would
 * otherwise fill the history with noise and make a genuine change hard to find
 * during an audit.
 */
export function commitProfile(params: {
  id: string;
  userId: string;
  data: unknown;
  createdBy: string;
  nowISO: string;
  previous: ProfileSnapshot | null;
}): ProfileSnapshot | null {
  const dataHash = hashObject(params.data);

  if (params.previous && params.previous.dataHash === dataHash) return null;

  return {
    id: params.id,
    userId: params.userId,
    version: params.previous ? params.previous.version + 1 : 1,
    isActive: true,
    data: params.data,
    dataHash,
    createdAt: params.nowISO,
    createdBy: params.createdBy,
  };
}

/** Confirm a stored snapshot has not been altered since it was written. */
export function verifySnapshot(snapshot: ProfileSnapshot): boolean {
  return hashObject(snapshot.data) === snapshot.dataHash;
}

/**
 * Confirm a plan was produced from the profile it claims.
 * Run this before showing any historical plan — if it fails, the plan cannot be
 * explained and must not be presented as though it can.
 */
export function planMatchesProfile(planProfileHash: string, snapshot: ProfileSnapshot): boolean {
  return planProfileHash === snapshot.dataHash && verifySnapshot(snapshot);
}

/* ------------------------------------------------------------------ */
/* Re-profiling reminders                                              */
/* ------------------------------------------------------------------ */

/**
 * SEBI requires the risk profile to be reviewed at least annually, or on a
 * material life event. This is a product feature, not a background job:
 * a stale profile means the advice on screen is no longer suitable.
 */
export const REPROFILE_INTERVAL_DAYS = 365;
export const REPROFILE_WARNING_DAYS = 30;
/**
 * How far past the annual review a plan may still be shown as current advice.
 *
 * The regulation says "at least annually", so day 366 is technically a breach —
 * but withdrawing someone's plan the morning it turns a year old, when they may
 * be mid-way through acting on it, punishes the client for our reminder
 * schedule. Ninety days is long enough to reach someone who is travelling,
 * changing jobs or simply busy, and short enough that a profile can never drift
 * a full extra season without the plan being demoted to a historical record.
 *
 * Past this the plan is not deleted or hidden — it is relabelled. What we told
 * them in March is still exactly what we told them in March.
 */
export const REPROFILE_GRACE_DAYS = 90;

/** True once a profile is too old for its plans to be presented as live advice. */
export function isMateriallyOverdue(status: ReprofileStatus): boolean {
  return status.dueInDays <= -REPROFILE_GRACE_DAYS;
}

export type ReprofileStatus = {
  daysSinceProfile: number;
  dueInDays: number;
  state: 'current' | 'due_soon' | 'overdue';
  message: string;
};

export function reprofileStatus(lastProfiledAtISO: string, nowISO: string): ReprofileStatus {
  const days = Math.floor(
    (new Date(nowISO).getTime() - new Date(lastProfiledAtISO).getTime()) / 86_400_000,
  );
  const dueInDays = REPROFILE_INTERVAL_DAYS - days;

  if (dueInDays <= 0) {
    return {
      daysSinceProfile: days,
      dueInDays,
      state: 'overdue',
      message:
        `Your risk profile was last reviewed ${days} days ago. It is now overdue. ` +
        `Recommendations based on a profile older than a year cannot be relied on — income, family and goals all move.`,
    };
  }
  if (dueInDays <= REPROFILE_WARNING_DAYS) {
    return {
      daysSinceProfile: days,
      dueInDays,
      state: 'due_soon',
      message: `Your annual profile review is due in ${dueInDays} days. It takes a few minutes and keeps the advice valid.`,
    };
  }
  return {
    daysSinceProfile: days,
    dueInDays,
    state: 'current',
    message: `Profile reviewed ${days} days ago. Next review due in ${dueInDays} days.`,
  };
}

/* ------------------------------------------------------------------ */
/* Material change detection                                           */
/* ------------------------------------------------------------------ */

/**
 * A change big enough that the plan should be regenerated and the risk profile
 * revisited, rather than quietly carrying on with stale advice.
 */
export function detectMaterialChanges(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown>,
): string[] {
  if (!previous) return [];
  const changes: string[] = [];

  const num = (obj: Record<string, unknown>, path: string[]): number => {
    let cur: unknown = obj;
    for (const key of path) {
      if (cur === null || typeof cur !== 'object') return 0;
      cur = (cur as Record<string, unknown>)[key];
    }
    return typeof cur === 'number' ? cur : 0;
  };

  const moved = (path: string[], threshold: number, label: string) => {
    const before = num(previous, path);
    const after = num(next, path);
    if (before === 0 && after === 0) return;
    const change = before === 0 ? 1 : Math.abs(after - before) / before;
    if (change >= threshold) {
      changes.push(`${label} changed by ${(change * 100).toFixed(0)}%`);
    }
  };

  moved(['income', 'monthlyTakeHome'], 0.2, 'Monthly income');
  moved(['expenses', 'rentOrHome'], 0.3, 'Housing cost');
  moved(['insurance', 'termLifeCover'], 0.25, 'Life cover');

  const depsBefore = Array.isArray((previous as { dependents?: unknown[] }).dependents)
    ? (previous as { dependents: unknown[] }).dependents.length
    : 0;
  const depsAfter = Array.isArray((next as { dependents?: unknown[] }).dependents)
    ? (next as { dependents: unknown[] }).dependents.length
    : 0;
  if (depsBefore !== depsAfter) {
    changes.push(`Number of dependents changed from ${depsBefore} to ${depsAfter}`);
  }

  const modeBefore = (previous as { planningMode?: string }).planningMode;
  const modeAfter = (next as { planningMode?: string }).planningMode;
  if (modeBefore !== modeAfter) changes.push(`Planning mode changed to ${modeAfter}`);

  return changes;
}
