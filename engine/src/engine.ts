/**
 * The orchestrator.
 *
 * generatePlan() is a PURE function: profile in, plan out. No database, no
 * network, no clock (the date is injected). That is what makes it testable,
 * auditable, reproducible five years later, and reusable across the web app,
 * the adviser console and any batch re-run.
 */

import type { FinancialProfile, RecommendationPlan } from './types.ts';
import { ASSUMPTIONS_VERSION, DISCLOSURES } from './assumptions/v2026-08.ts';
import { normalise } from './normalise.ts';
import { diagnose, healthScore } from './diagnostics.ts';
import { assessRisk } from './risk.ts';
import { computeTax } from './tax.ts';
import { runWaterfall } from './waterfall.ts';
import { planGoals } from './goals.ts';
import { applySuitability } from './suitability.ts';
import { aggregateAllocation } from './allocation.ts';
import { planRebalancing } from './rebalance.ts';
import { comparePolicies } from './policy.ts';
import { runStressTests } from './stress.ts';
import type { AllocationContext } from './allocation.ts';

export const ENGINE_VERSION = '1.0.0';

export type EngineOptions = {
  /** Injected so plans are reproducible. ISO date. */
  today: string;
  /**
   * Path B switch. In 'diagnostic_only' mode the engine still computes
   * everything, but the caller must render only diagnostics and gaps — no
   * product recommendations. Used while RIA registration is pending.
   */
  advisoryMode?: 'advisory' | 'diagnostic_only';
};

export function generatePlan(profile: FinancialProfile, options: EngineOptions): RecommendationPlan {
  const warnings: string[] = [];

  /* Stage 0 — normalise & derive */
  const derived = normalise(profile);

  /* Stage 1 — diagnostics */
  const diagnostics = diagnose(profile, derived);

  /* Stage 2 — risk */
  const riskProfile = assessRisk(profile, derived);

  /* Stage 7 (early) — tax, because the waterfall and the allocation both need
     to know the regime and the 80C headroom before they decide anything. */
  const taxRecommendation = computeTax(profile, derived);

  /* Stage 3 — waterfall */
  const waterfall = runWaterfall(profile, derived, taxRecommendation);
  warnings.push(...waterfall.warnings);

  const ctx: AllocationContext = {
    profile,
    derived,
    risk: riskProfile,
    onOldRegime:
      profile.tax.selectedRegime === 'old' ||
      (profile.tax.selectedRegime === 'undecided' && taxRecommendation.recommendedRegime === 'old'),
    eightyCGap: taxRecommendation.section80CGap,
  };

  /* Stages 4–6 — goals, allocation, products */
  const goalResult = waterfall.blocked
    ? { plans: [], totalRequiredSIP: 0, warnings: [] }
    : planGoals(
        profile,
        derived,
        ctx,
        waterfall.steadyStateAvailable,
        options.today,
        waterfall.monthsUntilSteadyState,
      );
  warnings.push(...goalResult.warnings);

  /* Stage 8 — suitability */
  const suitability = applySuitability(profile, derived, riskProfile, goalResult.plans);
  warnings.push(...suitability.warnings);

  const aggregate = aggregateAllocation(suitability.goalPlans.flatMap((g) => g.allocation));

  /* Stage 5b — the EXISTING portfolio. Everything above directs new money; for
     most households over 40 the corpus already invested is far larger. */
  const rebalancing = planRebalancing(
    profile,
    derived,
    ctx,
    taxRecommendation,
    aggregate.reduce((a, s) => a + s.monthlyAmount, 0),
    options.today,
  );
  if (rebalancing.needsRebalancing) {
    warnings.push(
      `Your existing portfolio is ${rebalancing.maxDriftPoints.toFixed(1)} percentage points away from its target mix. See the rebalancing section — for a portfolio this size that matters more than where the next contribution goes.`,
    );
  }

  /* Stage 5c — insurance-linked policies: actually cost the decision. */
  const policyComparisons = comparePolicies(profile, derived);

  /* Stage 5d — stress tests. A plan that only works when nothing goes wrong
     is not a plan, and "ability to bear loss" is a SEBI suitability input. */
  const stressTests = runStressTests(profile, derived, rebalancing);
  for (const t of stressTests) {
    if (t.severity === 'catastrophic') {
      warnings.push(`Stress test "${t.title}": ${t.headline} ${t.whatBreaks}`);
    }
  }

  /* Sanity checks — these are engine bugs if they ever fire. */
  const allocatedMonthly = aggregate.reduce((a, s) => a + s.monthlyAmount, 0);
  if (!waterfall.blocked && allocatedMonthly > waterfall.steadyStateAvailable + 5) {
    warnings.push(
      `ENGINE WARNING: allocated ₹${allocatedMonthly} exceeds the ₹${waterfall.steadyStateAvailable} available. This is a bug, not advice.`,
    );
  }

  if (waterfall.monthsUntilSteadyState > 0 && waterfall.availableForGoals < waterfall.steadyStateAvailable) {
    warnings.push(
      `The goal allocation below assumes ₹${waterfall.steadyStateAvailable.toLocaleString('en-IN')} a month, which becomes available in about ${waterfall.monthsUntilSteadyState} month(s) once debt payoff and emergency-fund building are done. Until then you can invest ₹${waterfall.availableForGoals.toLocaleString('en-IN')} a month in the same proportions.`,
    );
  }

  const score = healthScore(diagnostics);
  if (score < 40) {
    warnings.push(
      `Overall financial health scores ${score}/100. The action plan is ordered to fix the weakest areas first; investment allocation matters less than those fixes right now.`,
    );
  }

  return {
    profileId: profile.profileId,
    generatedAt: options.today,
    engineVersion: ENGINE_VERSION,
    assumptionsVersion: ASSUMPTIONS_VERSION,
    planningMode: profile.planningMode,
    advisoryMode: options.advisoryMode ?? 'advisory',
    derived,
    diagnostics,
    riskProfile,
    actionPlan: waterfall.actions,
    goalPlans: suitability.goalPlans,
    aggregateAllocation: aggregate,
    taxRecommendation,
    rebalancing,
    policyComparisons,
    stressTests,
    suitability: suitability.records,
    warnings,
    disclosures: DISCLOSURES,
  };
}

export { healthScore };
