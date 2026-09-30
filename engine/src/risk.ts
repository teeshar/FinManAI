/**
 * Stage 2 — Risk profiling.
 *
 * Two independent axes:
 *   capacity  — objective ability to absorb loss, computed from the data
 *   tolerance — subjective willingness, from the questionnaire (§11)
 *
 * The final profile is min(capacity, tolerance). Where they diverge sharply we
 * say so explicitly; that sentence is both good advice and the suitability
 * record SEBI expects.
 */

import type { DerivedFinancials, FinancialProfile, RiskBand, RiskProfile } from './types.ts';
import { RISK_BANDS, RISK_DIVERGENCE_THRESHOLD, WATERFALL } from './assumptions/v2026-08.ts';

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Linear interpolation of a value onto a 0-100 score. */
function scale(value: number, worst: number, best: number): number {
  if (best === worst) return 50;
  return clamp(((value - worst) / (best - worst)) * 100);
}

export function assessRisk(profile: FinancialProfile, d: DerivedFinancials): RiskProfile {
  /* ------------------------------------------------------------ */
  /* Capacity — computed, never asked                              */
  /* ------------------------------------------------------------ */

  const factors: { factor: string; weight: number; score: number; note: string }[] = [];

  // 1. Years to retirement (25%)
  const yearsScore = scale(d.yearsToRetirement, 0, 30);
  factors.push({
    factor: 'Years to retirement',
    weight: 0.25,
    score: Math.round(yearsScore),
    note: `${d.yearsToRetirement} years until age ${profile.personal.expectedRetirementAge}. Time is what lets a portfolio recover from a fall.`,
  });

  // 2. Income stability (20%)
  const employmentScore: Record<string, number> = {
    government: 100,
    psu: 95,
    private: 75,
    startup: 50,
    business: 45,
    none: 25,
  };
  const typeScore: Record<string, number> = {
    salaried: 85,
    retired: 55,
    self_employed: 50,
    business_owner: 45,
    freelancer: 40,
  };
  const stabilityScore: Record<string, number> = {
    very_stable: 100,
    stable: 80,
    uncertain: 45,
    volatile: 20,
  };
  const incomeStabilityScore: Record<string, number> = {
    fixed: 100,
    mostly_fixed: 80,
    variable: 50,
    highly_variable: 25,
  };
  const stability = clamp(
    (employmentScore[profile.employment.employerType] ?? 50) * 0.25 +
      (typeScore[profile.employment.employmentType] ?? 50) * 0.3 +
      (stabilityScore[profile.employment.jobStability] ?? 50) * 0.25 +
      (incomeStabilityScore[profile.income.incomeStability] ?? 50) * 0.2,
  );
  factors.push({
    factor: 'Income stability',
    weight: 0.20,
    score: Math.round(stability),
    note: `${profile.employment.employmentType.replace('_', ' ')} in a ${profile.employment.employerType} setting, self-rated ${profile.employment.jobStability.replace('_', ' ')}.`,
  });

  // 3. Surplus ratio (15%)
  const savingsRate =
    d.plannableMonthlyIncome > 0 ? d.investableSurplus / d.plannableMonthlyIncome : 0;
  const surplusScore = savingsRate <= 0 ? 0 : scale(savingsRate, 0, 0.40);
  factors.push({
    factor: 'Savings rate',
    weight: 0.15,
    score: Math.round(surplusScore),
    note: `${(savingsRate * 100).toFixed(1)}% of income is free each month. A thin surplus means any loss has to be absorbed by assets, not by income.`,
  });

  // 4. Emergency fund coverage (15%) — a hard gate in practice
  const efScore = scale(d.emergencyFundMonthsCovered, 0, d.emergencyFundTargetMonths);
  factors.push({
    factor: 'Emergency fund',
    weight: 0.15,
    score: Math.round(efScore),
    note: `${d.emergencyFundMonthsCovered.toFixed(1)} of ${d.emergencyFundTargetMonths} months covered. Without a buffer, a market fall forces you to sell at the worst moment.`,
  });

  // 5. Dependency burden (10%)
  const dependants = Math.max(profile.personal.dependentMembers, profile.dependents.length);
  const dependencyRatio = dependants / Math.max(1, d.earnerCount);
  const dependencyScore = scale(4 - dependencyRatio, 0, 4);
  factors.push({
    factor: 'Dependency burden',
    weight: 0.10,
    score: Math.round(dependencyScore),
    note: `${dependants} dependent(s) supported by ${d.earnerCount} earner(s).`,
  });

  // 6. EMI to income (10%)
  const emiRatio = d.plannableMonthlyIncome > 0 ? d.totalMonthlyEMI / d.plannableMonthlyIncome : 0;
  const emiScore = scale(0.6 - emiRatio, 0, 0.6);
  factors.push({
    factor: 'Leverage',
    weight: 0.10,
    score: Math.round(emiScore),
    note: `${(emiRatio * 100).toFixed(1)}% of income committed to EMIs.`,
  });

  // 7. Insurance adequacy (5%)
  const termOK = d.termCoverGap === 0 ? 100 : d.requiredTermCover > 0 ? scale(1 - d.termCoverGap / d.requiredTermCover, 0, 1) : 100;
  const healthOK = d.healthCoverGap === 0 ? 100 : scale(1 - d.healthCoverGap / Math.max(1, d.requiredHealthCover), 0, 1);
  const insuranceScore = (termOK + healthOK) / 2;
  factors.push({
    factor: 'Protection',
    weight: 0.05,
    score: Math.round(insuranceScore),
    note:
      d.termCoverGap > 0 || d.healthCoverGap > 0
        ? 'Uncovered risk means an unexpected event would be paid for by liquidating investments.'
        : 'Life and health risks are adequately transferred to insurers.',
  });

  const capacityScore = Math.round(
    clamp(factors.reduce((a, f) => a + f.score * f.weight, 0)),
  );

  /* ------------------------------------------------------------ */
  /* Tolerance — from the §11 questionnaire                        */
  /* ------------------------------------------------------------ */

  const q = profile.risk;
  const five = (v: number) => ((v - 1) / 4) * 100;

  const toleranceBreakdown = [
    { factor: 'Investment experience', score: Math.round(five(q.investmentExperience)) },
    { factor: 'Product knowledge', score: Math.round(five(q.productKnowledge)) },
    { factor: 'Stated risk preference', score: Math.round(five(q.preferredRiskLevel)) },
    { factor: 'Acceptable drawdown', score: Math.round(scale(q.maxAcceptableDrawdown, 0, 0.40)) },
    { factor: 'Reaction to a market fall', score: Math.round(five(q.reactionToMarketDecline)) },
    { factor: 'Ability to bear losses', score: Math.round(five(q.abilityToHandleLosses)) },
    { factor: 'Time horizon', score: Math.round(scale(q.investmentTimeHorizon, 0, 20)) },
    { factor: 'Need for capital guarantee', score: Math.round(five(q.needForGuaranteedCapital)) },
    { factor: 'Comfort with volatility', score: Math.round(five(q.comfortWithVolatility)) },
  ];

  // Weighted: what someone DOES in a fall matters more than what they say they prefer.
  const toleranceWeights = [0.10, 0.08, 0.12, 0.15, 0.18, 0.12, 0.10, 0.08, 0.07];
  const toleranceScore = Math.round(
    clamp(toleranceBreakdown.reduce((a, t, i) => a + t.score * toleranceWeights[i], 0)),
  );

  /* ------------------------------------------------------------ */
  /* Final                                                         */
  /* ------------------------------------------------------------ */

  const finalScore = Math.min(capacityScore, toleranceScore);
  const bandDef = RISK_BANDS.find((b) => finalScore >= b.min && finalScore <= b.max) ?? RISK_BANDS[0];

  const divergence = Math.abs(capacityScore - toleranceScore);
  const divergenceFlag = divergence > RISK_DIVERGENCE_THRESHOLD;

  let divergenceNote: string | undefined;
  if (divergenceFlag && toleranceScore > capacityScore) {
    const weakest = [...factors].sort((a, b) => a.score - b.score)[0];
    divergenceNote =
      `You are willing to take more risk (${toleranceScore}/100) than your finances can currently absorb (${capacityScore}/100). ` +
      `The binding constraint is ${weakest.factor.toLowerCase()}: ${weakest.note} ` +
      `We have planned to your capacity, not your appetite. Fix the constraint and the ceiling rises automatically.`;
  } else if (divergenceFlag && capacityScore > toleranceScore) {
    divergenceNote =
      `Your finances could absorb more risk (${capacityScore}/100) than you are comfortable taking (${toleranceScore}/100). ` +
      `That is a legitimate choice and we have respected it — but it has a cost: a lower expected return means a higher monthly contribution to reach the same goal. ` +
      `As your experience grows this is worth revisiting.`;
  }

  return {
    capacityScore,
    toleranceScore,
    finalScore,
    band: bandDef.band as RiskBand,
    equityCeiling: bandDef.equityCeiling,
    capacityBreakdown: factors,
    toleranceBreakdown,
    divergenceFlag,
    divergenceNote,
  };
}

/** Ordering helper used by caps that require a minimum band. */
export function bandRank(band: RiskBand): number {
  return RISK_BANDS.findIndex((b) => b.band === band);
}

export const _riskInternal = { scale, clamp, WATERFALL };
