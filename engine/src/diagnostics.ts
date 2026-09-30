/**
 * Stage 1 — Financial health diagnostics.
 *
 * Ten ratios. These are useful on their own: in the non-advisory (Path B)
 * presentation mode this is the entire visible product, with no
 * recommendations attached.
 */

import type { Band, Diagnostic, DerivedFinancials, FinancialProfile } from './types.ts';
import { BENCHMARKS, WATERFALL } from './assumptions/v2026-08.ts';

const inr = (n: number): string =>
  '₹' + Math.round(n).toLocaleString('en-IN');

const pct = (n: number): string => (n * 100).toFixed(1) + '%';

/** Band from a value where HIGHER is better. */
function bandUp(value: number, poor: number, fair: number, good: number, excellent: number): Band {
  if (value >= excellent) return 'excellent';
  if (value >= good) return 'good';
  if (value >= fair) return 'fair';
  if (value >= poor) return 'poor';
  return 'critical';
}

/** Band from a value where LOWER is better. */
function bandDown(value: number, excellent: number, good: number, fair: number, poor: number): Band {
  if (value <= excellent) return 'excellent';
  if (value <= good) return 'good';
  if (value <= fair) return 'fair';
  if (value <= poor) return 'poor';
  return 'critical';
}

export function diagnose(profile: FinancialProfile, d: DerivedFinancials): Diagnostic[] {
  const out: Diagnostic[] = [];
  const income = d.plannableMonthlyIncome;
  const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);

  /* 1. Savings rate */
  const savingsRate = safeDiv(d.investableSurplus, income);
  out.push({
    key: 'savings_rate',
    label: 'Savings rate',
    value: Math.round(savingsRate * 1000) / 1000,
    unit: 'ratio',
    benchmark: '≥ 20% of income',
    band:
      savingsRate < 0
        ? 'critical'
        : bandUp(savingsRate, 0.05, 0.10, BENCHMARKS.savingsRateGood, BENCHMARKS.savingsRateExcellent),
    comment:
      savingsRate < 0
        ? `You are spending ${inr(Math.abs(d.investableSurplus))} more than you earn each month. Nothing else in this plan matters until that is fixed.`
        : `${inr(d.investableSurplus)} of your ${inr(income)} monthly income is left after expenses and EMIs — a savings rate of ${pct(savingsRate)}.`,
  });

  /* 2. Essential expense ratio */
  const essentialRatio = safeDiv(d.essentialMonthlyExpenses, income);
  out.push({
    key: 'essential_expense_ratio',
    label: 'Essential expenses vs income',
    value: Math.round(essentialRatio * 1000) / 1000,
    unit: 'ratio',
    benchmark: '≤ 50% of income',
    band: bandDown(essentialRatio, 0.35, 0.45, BENCHMARKS.essentialExpenseRatioMax, 0.65),
    comment: `${inr(d.essentialMonthlyExpenses)} a month goes on non-negotiable costs — ${pct(essentialRatio)} of income.`,
  });

  /* 3. EMI to income */
  const emiRatio = safeDiv(d.totalMonthlyEMI, income);
  const nonHomeEMI = profile.liabilities
    .filter((l) => l.type !== 'home_loan')
    .reduce((a, l) => a + l.monthlyEMI, 0);
  const nonHomeRatio = safeDiv(nonHomeEMI, income);
  out.push({
    key: 'emi_to_income',
    label: 'EMI burden',
    value: Math.round(emiRatio * 1000) / 1000,
    unit: 'ratio',
    benchmark: '≤ 40% total, ≤ 20% excluding home loan',
    band:
      nonHomeRatio > BENCHMARKS.nonHomeEmiToIncomeMax
        ? bandDown(emiRatio, 0.15, 0.25, 0.35, 0.45)
        : bandDown(emiRatio, 0.20, 0.30, BENCHMARKS.emiToIncomeMax, 0.50),
    comment:
      nonHomeEMI > 0
        ? `${inr(d.totalMonthlyEMI)} a month in EMIs (${pct(emiRatio)} of income), of which ${inr(nonHomeEMI)} is non-home debt.`
        : d.totalMonthlyEMI > 0
          ? `${inr(d.totalMonthlyEMI)} a month in EMIs (${pct(emiRatio)} of income), all of it home loan.`
          : 'No loan EMIs. This is a strong position.',
  });

  /* 4. Emergency fund months */
  out.push({
    key: 'emergency_fund_months',
    label: 'Emergency fund cover',
    value: d.emergencyFundMonthsCovered,
    unit: 'months',
    benchmark: `${d.emergencyFundTargetMonths} months of essential costs + EMIs`,
    band: bandUp(
      d.emergencyFundMonthsCovered,
      1,
      3,
      d.emergencyFundTargetMonths * 0.75,
      d.emergencyFundTargetMonths,
    ),
    comment:
      d.emergencyFundMonthsCovered >= d.emergencyFundTargetMonths
        ? `${inr(d.emergencyFundCurrent)} in liquid savings covers ${d.emergencyFundMonthsCovered.toFixed(1)} months. Target met — do not over-fund this.`
        : `${inr(d.emergencyFundCurrent)} covers ${d.emergencyFundMonthsCovered.toFixed(1)} months. You need ${inr(d.emergencyFundTarget)} to reach ${d.emergencyFundTargetMonths} months.`,
  });

  /* 5. Debt to asset */
  const debtToAsset = safeDiv(d.totalLiabilities, d.totalAssets);
  out.push({
    key: 'debt_to_asset',
    label: 'Debt vs assets',
    value: Math.round(debtToAsset * 1000) / 1000,
    unit: 'ratio',
    benchmark: '≤ 50%',
    band: bandDown(debtToAsset, 0.10, 0.30, BENCHMARKS.debtToAssetMax, 0.75),
    comment: `${inr(d.totalLiabilities)} owed against ${inr(d.totalAssets)} of assets. Net worth ${inr(d.netWorth)}.`,
  });

  /* 6. Term life adequacy */
  const existingTerm = profile.insurance.termLifeCover + profile.insurance.employerProvidedLifeCover;
  const termAdequacy = d.requiredTermCover > 0 ? safeDiv(existingTerm, d.requiredTermCover) : 1;
  out.push({
    key: 'term_life_adequacy',
    label: 'Life cover adequacy',
    value: Math.round(termAdequacy * 100) / 100,
    unit: 'multiple',
    benchmark: d.hasFinancialDependents ? `${inr(d.requiredTermCover)} of term cover` : 'Not required — no financial dependents',
    band: !d.hasFinancialDependents ? 'excellent' : bandUp(termAdequacy, 0.25, 0.5, 0.85, 1.0),
    comment: !d.hasFinancialDependents
      ? 'No one depends financially on your income, so term life insurance is optional for you.'
      : termAdequacy >= 1
        ? `${inr(existingTerm)} of cover against a need of ${inr(d.requiredTermCover)}. Adequately protected.`
        : `Only ${inr(existingTerm)} of cover against a need of ${inr(d.requiredTermCover)} — a gap of ${inr(d.termCoverGap)}. This is the largest single risk in your plan.`,
  });

  /* 7. Health cover adequacy */
  const effectiveHealth =
    profile.insurance.healthCoverSelf +
    profile.insurance.healthCoverFamilyFloater +
    profile.insurance.healthCoverParents +
    profile.insurance.employerProvidedHealthCover * 0.5;
  const healthAdequacy = safeDiv(effectiveHealth, d.requiredHealthCover);
  out.push({
    key: 'health_cover_adequacy',
    label: 'Health cover adequacy',
    value: Math.round(healthAdequacy * 100) / 100,
    unit: 'multiple',
    benchmark: `${inr(d.requiredHealthCover)} for your city and family`,
    band: bandUp(healthAdequacy, 0.2, 0.5, 0.8, 1.0),
    comment:
      profile.insurance.employerProvidedHealthCover > 0 &&
      profile.insurance.healthCoverSelf + profile.insurance.healthCoverFamilyFloater === 0
        ? `Your only health cover is from your employer. It ends the day the job does, and it counts at half weight here for that reason. A personal policy of ${inr(d.healthCoverGap)} is the fix.`
        : healthAdequacy >= 1
          ? `${inr(effectiveHealth)} of effective cover against a need of ${inr(d.requiredHealthCover)}.`
          : `${inr(effectiveHealth)} of effective cover against a need of ${inr(d.requiredHealthCover)} — a gap of ${inr(d.healthCoverGap)}.`,
  });

  /* 8. Liquidity ratio */
  const liquidityRatio = safeDiv(d.liquidAssets, d.totalMonthlyExpenses);
  out.push({
    key: 'liquidity_ratio',
    label: 'Liquidity',
    value: Math.round(liquidityRatio * 10) / 10,
    unit: 'months',
    benchmark: '≥ 3 months of total expenses in liquid form',
    band: bandUp(liquidityRatio, 0.5, 1.5, BENCHMARKS.liquidityRatioMin, 6),
    comment: `${inr(d.liquidAssets)} is accessible within a day or two — ${liquidityRatio.toFixed(1)} months of total spending.`,
  });

  /* 9. Net worth vs income (age-benchmarked) */
  const annualIncome = income * 12;
  const nwRatio = safeDiv(d.netWorth, annualIncome);
  // A widely used rule of thumb: net worth ≈ (age × annual income) / 10.
  const nwBenchmark = (profile.personal.age * 1) / 10;
  const nwScore = nwBenchmark > 0 ? nwRatio / nwBenchmark : 1;
  out.push({
    key: 'net_worth_to_income',
    label: 'Net worth vs income',
    value: Math.round(nwRatio * 100) / 100,
    unit: 'multiple',
    benchmark: `≈ ${nwBenchmark.toFixed(1)}× annual income at age ${profile.personal.age}`,
    band: bandUp(nwScore, 0.2, 0.5, 0.9, 1.5),
    comment: `Net worth of ${inr(d.netWorth)} is ${nwRatio.toFixed(1)}× your annual income. The rough age benchmark is ${nwBenchmark.toFixed(1)}×.`,
  });

  /* 10. Goal funding ratio */
  const goalsWithTargets = profile.goals.filter((g) => g.requiredAmountToday > 0);
  const totalRequired = goalsWithTargets.reduce((a, g) => a + g.requiredAmountToday, 0);
  const totalSaved = goalsWithTargets.reduce((a, g) => a + g.amountAlreadySaved, 0);
  const goalRatio = safeDiv(totalSaved, totalRequired);
  out.push({
    key: 'goal_funding_ratio',
    label: 'Goal funding progress',
    value: Math.round(goalRatio * 1000) / 1000,
    unit: 'ratio',
    benchmark: 'Tracked per goal — see the goal plan',
    band: goalsWithTargets.length === 0 ? 'fair' : bandUp(goalRatio, 0.05, 0.15, 0.35, 0.6),
    comment:
      goalsWithTargets.length === 0
        ? 'No goals recorded yet. Goals are what turn saving into planning — add at least one.'
        : `${inr(totalSaved)} saved against ${inr(totalRequired)} of goals in today's money (${pct(goalRatio)}). Individual goals vary — see the goal plan below.`,
  });

  return out;
}

/** Convenience: overall health score 0-100 from the ten bands. */
export function healthScore(diagnostics: Diagnostic[]): number {
  const scoreOf: Record<Band, number> = {
    critical: 0,
    poor: 25,
    fair: 50,
    good: 75,
    excellent: 100,
  };
  if (diagnostics.length === 0) return 0;
  const total = diagnostics.reduce((a, x) => a + scoreOf[x.band], 0);
  return Math.round(total / diagnostics.length);
}

export const _fmt = { inr, pct, bandUp, bandDown, WATERFALL };
