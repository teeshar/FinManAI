/**
 * Generate a plan and persist it immutably.
 *
 * Three gates before the engine runs, in this order: consent, 2FA, and a
 * signed client agreement. Each is a SEBI requirement, and each is cheaper to
 * enforce here — once, in one place — than in every route that might reach a
 * plan.
 */

import { generatePlan } from '../../../engine/src/engine.ts';
import type { FinancialProfile } from '../../../engine/src/types.ts';
import { generateNarrative } from '../../../engine/src/narrative.ts';
import { clientFromEnv } from '../../../engine/src/llm-client.ts';
import { encryptField } from '../../../core/src/field-crypto.ts';
import { hashObject } from '../../../core/src/audit.ts';
import { planMatchesProfile } from '../../../core/src/profile-store.ts';
import type { ProfileSnapshot } from '../../../core/src/profile-store.ts';
import { keyRing, advisoryMode } from './keys.ts';
import { recordAudit } from './audit.ts';
import type { AuditContext } from './audit.ts';
import { prisma } from './db.ts';

const planAad = (planId: string) => `plan:${planId}`;

export type GenerateResult =
  | { status: 'generated'; planId: string }
  | { status: 'blocked'; reason: string };

export async function generateAndStorePlan(
  snapshot: ProfileSnapshot,
  ctx: AuditContext,
): Promise<GenerateResult> {
  const user = await prisma.user.findUnique({
    where: { id: snapshot.userId },
    include: {
      consents: { where: { revokedAt: null }, orderBy: { acceptedAt: 'desc' }, take: 1 },
      agreements: { orderBy: { signedAt: 'desc' }, take: 1 },
      oauthAccounts: { select: { provider: true } },
    },
  });
  if (!user) return { status: 'blocked', reason: 'User not found.' };

  const consent = user.consents[0];
  if (!consent?.generatePersonalisedRecommendations || !consent?.riskDisclosuresAccepted) {
    return {
      status: 'blocked',
      reason:
        'Consent for personalised recommendations and acceptance of the risk disclosures must both be recorded before a plan can be generated.',
    };
  }

  // A password alone must never be enough to produce a financial plan. An
  // authenticator app satisfies this; so does Google sign-in, where there is no
  // password of ours to steal in the first place.
  const stronglyAuthenticated = user.totpEnabled || user.oauthAccounts.length > 0;
  if (!stronglyAuthenticated) {
    return {
      status: 'blocked',
      reason:
        'Protect this account with an authenticator app, or sign in with Google, before a financial plan can be generated.',
    };
  }

  const mode = advisoryMode();
  if (mode === 'advisory' && !user.agreements[0]) {
    return {
      status: 'blocked',
      reason:
        'A signed client agreement including the standardised MITC is required before advisory output can be produced.',
    };
  }

  // The engine is pure: profile in, plan out. The date is injected so the same
  // profile regenerates identically for an audit years from now.
  const plan = generatePlan(snapshot.data as FinancialProfile, {
    today: new Date().toISOString().slice(0, 10),
    advisoryMode: mode,
  });

  // Prose only. The validator inside rejects any figure the engine did not
  // produce and falls back to deterministic text.
  const narrative = await generateNarrative(plan, clientFromEnv());

  const planId = crypto.randomUUID();
  const ring = keyRing();

  await prisma.plan.create({
    data: {
      id: planId,
      profileId: snapshot.id,
      profileHash: snapshot.dataHash,
      engineVersion: plan.engineVersion,
      assumptionsVersion: plan.assumptionsVersion,
      advisoryMode: mode,
      outputEncrypted: encryptField(JSON.stringify(plan), ring, planAad(planId)),
      outputHash: hashObject(plan),
      keyVersion: ring.activeVersion,
      narrative: narrative.text,
      narrativeSource: narrative.source,
      narrativeModel: process.env.FINMANAI_LLM_MODEL ?? null,
      narrativePromptHash: narrative.promptHash,
      narrativeRejection: narrative.rejectionReason ?? null,
      generatedBy: ctx.actorId ?? snapshot.userId,
    },
  });

  await recordAudit('plan.generated', 'Plan', planId, ctx, {
    profileVersion: snapshot.version,
    engineVersion: plan.engineVersion,
    assumptionsVersion: plan.assumptionsVersion,
    advisoryMode: mode,
    narrativeSource: narrative.source,
  });

  return { status: 'generated', planId };
}

/**
 * A stored plan may only be shown if it still matches the profile that produced
 * it. If it does not, the advice cannot be explained — and unexplainable advice
 * must not be presented as though it can be.
 */
export function assertPlanExplainable(planProfileHash: string, snapshot: ProfileSnapshot): void {
  if (!planMatchesProfile(planProfileHash, snapshot)) {
    throw new Error(
      'This plan cannot be traced to the profile version that produced it. It must not be presented as current advice.',
    );
  }
}
