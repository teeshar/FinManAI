/**
 * May this actor see this plan, and can it still be shown as advice?
 *
 * Pulled out of the page and the routes because three of them need the same
 * answer, and a rule about who may read someone's financial position should
 * exist once. The two questions are deliberately answered together: the second
 * is meaningless without the first.
 */

import { decryptField } from '../../../core/src/field-crypto.ts';
import type { RecommendationPlan } from '../../../engine/src/types.ts';
import { reviewState } from './reprofile.ts';
import { approvalState } from './adviser-service.ts';
import type { ApprovalState } from './adviser-service.ts';
import { AuthError } from './auth.ts';
import type { AuthedUser } from './auth.ts';
import { keyRing } from './keys.ts';
import { prisma } from './db.ts';

export type LoadedPlan = {
  id: string;
  plan: RecommendationPlan;
  narrative: string | null;
  narrativeSource: string;
  generatedAt: Date;
  subjectUserId: string;
  profileVersion: number;
  /** False when the plan no longer matches the profile that produced it. */
  verifiable: boolean;
  /**
   * The plan is intact and correct, but the profile behind it is far enough
   * past its annual review that we will not present it as live advice. It is
   * shown, clearly labelled, as a record of what was said at the time.
   */
  historical: boolean;
  daysSinceReview: number | null;
  approval: ApprovalState;
  /** True when the actor is an adviser reading a client's plan. */
  actingAsAdviser: boolean;
};

/**
 * Authorisation: your own plan, or a client's if you hold an active link to
 * them. `notFound` rather than `forbidden` for a stranger's plan — telling an
 * attacker that a plan ID exists is itself a disclosure.
 */
export async function loadPlanFor(planId: string, actor: AuthedUser): Promise<LoadedPlan | null> {
  const row = await prisma.plan.findUnique({
    where: { id: planId },
    include: { profile: true },
  });
  if (!row) return null;

  const subjectUserId = row.profile.userId;
  let actingAsAdviser = false;

  if (subjectUserId !== actor.id) {
    if (actor.role !== 'ADVISER' && actor.role !== 'ADMIN') return null;
    const link = await prisma.adviserClient.findUnique({
      where: { adviserId_clientId: { adviserId: actor.id, clientId: subjectUserId } },
    });
    if (!link || link.status !== 'active' || link.revokedAt) return null;
    actingAsAdviser = true;
  }

  const verifiable = row.profileHash === row.profile.dataHash;
  const state = await reviewState(subjectUserId);

  return {
    id: row.id,
    plan: JSON.parse(decryptField(row.outputEncrypted, keyRing(), `plan:${row.id}`)),
    narrative: row.narrative,
    narrativeSource: row.narrativeSource,
    generatedAt: row.generatedAt,
    subjectUserId,
    profileVersion: row.profile.version,
    verifiable,
    // A superseded plan is historical whatever the review clock says: it was
    // built from a profile version that is no longer the current one.
    historical: state.materiallyOverdue || !row.profile.isActive,
    daysSinceReview: state.status?.daysSinceProfile ?? null,
    approval: await approvalState(row.id),
    actingAsAdviser,
  };
}

export async function requirePlan(planId: string, actor: AuthedUser): Promise<LoadedPlan> {
  const loaded = await loadPlanFor(planId, actor);
  if (!loaded) throw new AuthError('Plan not found.', 404);
  return loaded;
}
