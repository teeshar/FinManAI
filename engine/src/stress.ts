/**
 * Stress testing.
 *
 * A plan that only works when nothing goes wrong is not a plan. Everything
 * upstream assumes income continues, markets behave and nobody falls ill.
 * These three scenarios test what happens when they don't — deterministically,
 * with no simulation and no probability claims we cannot defend.
 *
 * This is also where suitability stops being theoretical. SEBI expects the
 * client's *ability* to bear loss to be assessed; "you could survive 2.3 months
 * without income" is an assessment. "Moderate risk tolerance" is not.
 */

import type {
  DerivedFinancials,
  FinancialProfile,
  RebalancingPlan,
  StressTest,
} from './types.ts';
import { STRESS } from './assumptions/v2026-08.ts';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export function runStressTests(
  profile: FinancialProfile,
  d: DerivedFinancials,
  rebalancing: RebalancingPlan,
): StressTest[] {
  const tests: StressTest[] = [];
  const monthlyCommitment = d.essentialMonthlyExpenses + d.totalMonthlyEMI;

  /* ------------------------------------------------------------------ */
  /* 1. Job loss                                                         */
  /* ------------------------------------------------------------------ */

  const survivorIncome =
    profile.planningMode === 'household' ? profile.income.monthlyOtherFamilyIncome : 0;
  const monthlyShortfall = Math.max(0, monthlyCommitment - survivorIncome);
  const runwayMonths =
    monthlyShortfall > 0 ? d.emergencyFundCurrent / monthlyShortfall : Infinity;
  const target = STRESS.jobSearchMonths;

  tests.push({
    key: 'job_loss',
    title: 'You lose your income tomorrow',
    scenario: `No salary from next month. ${STRESS.assumedSeveranceMonths === 0 ? 'No severance assumed.' : ''} Essential costs and EMIs of ${inr(monthlyCommitment)} a month continue regardless${survivorIncome > 0 ? `, offset by ${inr(survivorIncome)} of household income that continues` : ''}. A realistic search takes about ${target} months.`,
    headline: Number.isFinite(runwayMonths)
      ? `You could cover ${runwayMonths.toFixed(1)} months before something has to give.`
      : 'Household income alone covers your essential costs — a job loss is survivable indefinitely.',
    survivesMonths: Number.isFinite(runwayMonths) ? Math.round(runwayMonths * 10) / 10 : undefined,
    impactAmount: Math.round(monthlyShortfall * target),
    severity: !Number.isFinite(runwayMonths)
      ? 'comfortable'
      : runwayMonths >= target
        ? 'comfortable'
        : runwayMonths >= target * 0.6
          ? 'manageable'
          : runwayMonths >= 2
            ? 'painful'
            : 'catastrophic',
    whatBreaks: !Number.isFinite(runwayMonths)
      ? 'Nothing breaks. This is the position everyone should be aiming for.'
      : runwayMonths >= target
        ? `Nothing breaks. You would pause investments and live off the buffer, which is exactly what it is for.`
        : `After month ${Math.floor(runwayMonths)} you would be forced to sell investments — probably into a weak market, since job losses and market falls tend to arrive together — or borrow at high rates. ${d.totalMonthlyEMI > 0 ? `Missing an EMI would also damage your credit score, which raises the cost of every future loan.` : ''}`,
    mitigation:
      runwayMonths >= target
        ? 'No action needed. Resist the temptation to over-fund the buffer beyond this point.'
        : `Reaching ${target} months of cover needs ${inr(Math.max(0, target * monthlyShortfall - d.emergencyFundCurrent))} more in liquid savings. That is the highest-value rupee in this entire plan.`,
  });

  /* ------------------------------------------------------------------ */
  /* 2. Market crash                                                     */
  /* ------------------------------------------------------------------ */

  const equityValue = rebalancing.drift.find((x) => x.assetClass === 'equity')?.currentValue ?? 0;
  const otherRiskValue =
    (rebalancing.drift.find((x) => x.assetClass === 'gold')?.currentValue ?? 0) +
    (rebalancing.drift.find((x) => x.assetClass === 'real_assets')?.currentValue ?? 0);
  const cryptoValue = rebalancing.drift.find((x) => x.assetClass === 'crypto')?.currentValue ?? 0;

  const crashLoss =
    equityValue * STRESS.marketCrashEquityFall +
    otherRiskValue * STRESS.marketCrashDebtFall +
    cryptoValue * STRESS.marketCrashCryptoFall;
  const portfolioAfter = Math.max(0, rebalancing.portfolioValue - crashLoss);
  const lossShare =
    rebalancing.portfolioValue > 0 ? crashLoss / rebalancing.portfolioValue : 0;
  const statedTolerance = profile.risk.maxAcceptableDrawdown;
  const withinTolerance = lossShare <= statedTolerance + 0.01;

  tests.push({
    key: 'market_crash',
    title: `Equity markets fall ${(STRESS.marketCrashEquityFall * 100).toFixed(0)}%`,
    scenario: `A severe but entirely ordinary bear market — the kind that has happened roughly once a decade. Equity falls ${(STRESS.marketCrashEquityFall * 100).toFixed(0)}%${cryptoValue > 0 ? `, crypto ${(STRESS.marketCrashCryptoFall * 100).toFixed(0)}% — it falls harder than equity in a risk-off episode, not softer` : ''}, other risk assets ${(STRESS.marketCrashDebtFall * 100).toFixed(0)}%, debt holds.`,
    headline:
      rebalancing.portfolioValue > 0
        ? `Your portfolio falls from ${inr(rebalancing.portfolioValue)} to about ${inr(portfolioAfter)} — a paper loss of ${inr(crashLoss)}, or ${(lossShare * 100).toFixed(1)}%.`
        : 'You have no market exposure yet, so a crash costs you nothing — and is the best possible time to be starting.',
    impactAmount: Math.round(crashLoss),
    severity:
      lossShare === 0
        ? 'comfortable'
        : withinTolerance
          ? 'manageable'
          : lossShare <= statedTolerance * 2
            ? 'painful'
            : 'catastrophic',
    whatBreaks:
      lossShare === 0
        ? 'Nothing.'
        : withinTolerance
          ? `Nothing structural. You said you could accept a ${(statedTolerance * 100).toFixed(0)}% fall, and this is ${(lossShare * 100).toFixed(1)}% — inside what you told us you could live with.`
          : `You told us you could accept a fall of ${(statedTolerance * 100).toFixed(0)}%. This is ${(lossShare * 100).toFixed(1)}% — ${inr(crashLoss)} on paper. The risk is not the loss itself but the reaction to it: selling at the bottom converts a temporary fall into a permanent one.` +
            (d.yearsToRetirement <= 5
              ? ` With only ${d.yearsToRetirement} years to retirement there is limited time to recover, which is why the near-retirement portion of your corpus is deliberately held in debt.`
              : ` With ${d.yearsToRetirement} years to retirement there is ample time to recover, and continuing to invest through the fall is what makes the eventual recovery work for you.`),
    mitigation: withinTolerance
      ? 'No change needed. If anything, a fall of this size is when the monthly contribution does its best work.'
      : 'Either reduce equity to a level you could genuinely hold through this, or decide now — in writing, while markets are calm — that you will not sell. The second is worth more than the first, and much harder.',
  });

  /* ------------------------------------------------------------------ */
  /* 3. Medical event                                                    */
  /* ------------------------------------------------------------------ */

  const eventCost =
    profile.personal.cityTier === 'metro'
      ? STRESS.medicalEventCostMetro
      : STRESS.medicalEventCostOther;
  const effectiveCover =
    profile.insurance.healthCoverSelf +
    profile.insurance.healthCoverFamilyFloater +
    profile.insurance.employerProvidedHealthCover;
  const outOfPocket = Math.max(0, eventCost - effectiveCover);
  const coveredByBuffer = Math.min(outOfPocket, d.emergencyFundCurrent);
  const mustLiquidate = Math.max(0, outOfPocket - d.emergencyFundCurrent);

  tests.push({
    key: 'medical_event',
    title: 'A serious hospitalisation in the family',
    scenario: `A cardiac event, a cancer diagnosis or a major accident — around ${inr(eventCost)} of treatment in a ${profile.personal.cityTier === 'metro' ? 'metro' : 'non-metro'} hospital. Your cover totals ${inr(effectiveCover)}${profile.insurance.employerProvidedHealthCover > 0 ? ', including employer cover that would disappear if the illness cost you your job' : ''}.`,
    headline:
      outOfPocket === 0
        ? 'Fully covered by insurance. Nothing comes out of your own money.'
        : `${inr(outOfPocket)} comes out of your own pocket${mustLiquidate > 0 ? `, of which ${inr(mustLiquidate)} would have to come from selling investments` : ', absorbed by your emergency fund'}.`,
    impactAmount: Math.round(outOfPocket),
    severity:
      outOfPocket === 0
        ? 'comfortable'
        : mustLiquidate === 0
          ? 'manageable'
          : mustLiquidate < d.totalAssets * 0.15
            ? 'painful'
            : 'catastrophic',
    whatBreaks:
      outOfPocket === 0
        ? 'Nothing. This is what insurance is for and yours is doing its job.'
        : mustLiquidate === 0
          ? `Your emergency fund absorbs it, but is then empty — leaving you exposed to the next event until it is rebuilt. ${inr(coveredByBuffer)} would need replacing.`
          : `The emergency fund is exhausted and ${inr(mustLiquidate)} of investments must be sold, at whatever price the market offers that week. Goals funded from those investments are set back by years. Medical events and income loss also frequently arrive together.`,
    mitigation:
      outOfPocket === 0
        ? 'Keep the policy current, and add a super top-up as costs rise.'
        : `A base policy plus a super top-up taking cover to ${inr(Math.max(eventCost, d.requiredHealthCover))} typically costs a few thousand rupees a month — far less than the ${inr(outOfPocket)} you would otherwise fund yourself. Employer cover should never be your only cover.`,
  });

  return tests;
}
