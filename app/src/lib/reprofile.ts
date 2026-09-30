/**
 * Is this plan still true?
 *
 * Everything before Phase 6 produces a plan. This module answers the question
 * that decides whether the plan may still be shown as advice: how long has it
 * been since anyone confirmed the facts underneath it, and have the rules it
 * was built on changed since?
 *
 * Two clocks run here and they are deliberately separate:
 *
 *   1. The CLIENT clock — the annual risk-profile review SEBI requires. It is
 *      reset by a review, not by a change, because a client who reads their
 *      profile and confirms nothing has moved has done exactly what was asked.
 *   2. The RULES clock — the dated assumptions version stamped on the plan
 *      against the one the engine now uses. A Budget that moves the tax slabs
 *      makes a correct plan stale without the client doing anything at all.
 */

import {
  reprofileStatus,
  isMateriallyOverdue,
  detectMaterialChanges,
} from '../../../core/src/profile-store.ts';
import type { ReprofileStatus } from '../../../core/src/profile-store.ts';
import { decryptField } from '../../../core/src/field-crypto.ts';
import { ASSUMPTIONS_VERSION } from '../../../engine/src/assumptions/v2026-08.ts';
import { ENGINE_VERSION } from '../../../engine/src/engine.ts';
import { keyRing } from './keys.ts';
import { prisma } from './db.ts';

export type ReviewState = {
  /** Null when the user has never committed a profile. */
  profileId: string | null;
  profileVersion: number | null;
  /** Whichever is later: the profile version's date, or the last review of it. */
  lastReviewedAt: string | null;
  /** Null when there is no profile to be due. */
  status: ReprofileStatus | null;
  /** Past this the newest plan is shown as a historical record, not as advice. */
  materiallyOverdue: boolean;
  /** Set when the newest plan predates a change in the rules it was built on. */
  assumptionsDrift: { planVersion: string; currentVersion: string } | null;
  engineDrift: { planVersion: string; currentVersion: string } | null;
  /** Newest plan, for the "your plan is stale" prompts. Metadata only. */
  latestPlan: { id: string; generatedAt: string; verifiable: boolean } | null;
};

/**
 * The review clock for one user.
 *
 * Reads metadata only — this is called on every dashboard render and has no
 * business decrypting a profile to answer "when was it last looked at".
 */
export async function reviewState(userId: string, nowISO = new Date().toISOString()): Promise<ReviewState> {
  const profile = await prisma.profile.findFirst({
    where: { userId, isActive: true },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, createdAt: true, dataHash: true },
  });

  if (!profile) {
    return {
      profileId: null,
      profileVersion: null,
      lastReviewedAt: null,
      status: null,
      materiallyOverdue: false,
      assumptionsDrift: null,
      engineDrift: null,
      latestPlan: null,
    };
  }

  const [lastReview, latestPlan] = await Promise.all([
    prisma.profileReview.findFirst({
      where: { userId, profileId: profile.id },
      orderBy: { reviewedAt: 'desc' },
      select: { reviewedAt: true },
    }),
    prisma.plan.findFirst({
      where: { profile: { userId } },
      orderBy: { generatedAt: 'desc' },
      select: {
        id: true,
        generatedAt: true,
        profileHash: true,
        assumptionsVersion: true,
        engineVersion: true,
        profile: { select: { dataHash: true } },
      },
    }),
  ]);

  // A review of the CURRENT version counts; a review of an older one does not,
  // because committing a new version is itself a fresh statement of the facts.
  const reviewedAt =
    lastReview && lastReview.reviewedAt > profile.createdAt
      ? lastReview.reviewedAt
      : profile.createdAt;

  const status = reprofileStatus(reviewedAt.toISOString(), nowISO);

  return {
    profileId: profile.id,
    profileVersion: profile.version,
    lastReviewedAt: reviewedAt.toISOString(),
    status,
    materiallyOverdue: isMateriallyOverdue(status),
    assumptionsDrift:
      latestPlan && latestPlan.assumptionsVersion !== ASSUMPTIONS_VERSION
        ? { planVersion: latestPlan.assumptionsVersion, currentVersion: ASSUMPTIONS_VERSION }
        : null,
    engineDrift:
      latestPlan && latestPlan.engineVersion !== ENGINE_VERSION
        ? { planVersion: latestPlan.engineVersion, currentVersion: ENGINE_VERSION }
        : null,
    latestPlan: latestPlan
      ? {
          id: latestPlan.id,
          generatedAt: latestPlan.generatedAt.toISOString(),
          verifiable: latestPlan.profileHash === latestPlan.profile.dataHash,
        }
      : null,
  };
}

/**
 * What has moved in the draft that is not yet committed.
 *
 * The re-profiling screen shows this before asking anyone to confirm anything:
 * "nothing has changed" is only a meaningful answer if we have shown them what
 * we think their answers currently are.
 */
export async function pendingMaterialChanges(userId: string): Promise<string[]> {
  const [profile, drafts] = await Promise.all([
    prisma.profile.findFirst({
      where: { userId, isActive: true },
      orderBy: { version: 'desc' },
    }),
    prisma.profileDraft.findMany({ where: { userId } }),
  ]);
  if (!profile || drafts.length === 0) return [];

  const ring = keyRing();
  const current = JSON.parse(
    decryptField(profile.dataEncrypted, ring, `profile:${profile.id}`),
  ) as Record<string, unknown>;

  const assembled = drafts
    .sort((a, b) => a.step - b.step)
    .reduce<Record<string, unknown>>(
      (acc, row) => ({
        ...acc,
        ...(JSON.parse(decryptField(row.data, ring, `draft:${userId}:${row.step}`)) as object),
      }),
      {},
    );

  return detectMaterialChanges(current, assembled);
}

/**
 * Record that a review happened.
 *
 * `unchanged` is the interesting case: no new profile version is written,
 * because nothing changed and a version that differs from its predecessor in
 * nothing but its timestamp is noise in an audit. The review itself is the
 * record, and it is what resets the clock.
 */
export async function recordReview(params: {
  userId: string;
  profileId: string;
  outcome: 'unchanged' | 'updated';
  changes: string[];
  reviewedBy: string;
}): Promise<void> {
  await prisma.profileReview.create({
    data: {
      userId: params.userId,
      profileId: params.profileId,
      outcome: params.outcome,
      changes: params.changes.length > 0 ? JSON.stringify(params.changes) : null,
      reviewedBy: params.reviewedBy,
    },
  });
}
