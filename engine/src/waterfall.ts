/**
 * Stage 3 — The priority waterfall.
 *
 * The next rupee does not go where the user wants. It goes where it does the
 * most good. Each level consumes surplus in strict order; investing only starts
 * once the levels above it are satisfied.
 *
 * ONE STRUCTURAL DECISION worth stating plainly: protection premiums are
 * treated as a FIXED COST, reserved before the waterfall runs — not as a
 * competitor inside it. Term and health premiums are small, urgent and
 * non-deferrable. Letting an aggressive debt-payoff schedule crowd them out
 * (which is what an earlier version did) produced a plan that committed more
 * than the household actually had. Debt-payoff speed is the dial; insurance is
 * not.
 *
 * Returns the ordered action plan, the surplus free for goals now, and the
 * surplus free once temporary commitments end.
 */

import type {
  ActionItem,
  DerivedFinancials,
  FinancialProfile,
  TaxRecommendation,
} from './types.ts';
import { TAX, WATERFALL } from './assumptions/v2026-08.ts';
import { comparePolicies } from './policy.ts';
import {
  termPremiumMonthly,
  healthPremiumMonthly,
  SUPER_TOPUP,
} from './premiums.ts';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export type WaterfallResult = {
  actions: ActionItem[];
  /** Surplus free for goal investing THIS month. */
  availableForGoals: number;
  /**
   * Surplus free once temporary commitments end — the debt is cleared and the
   * emergency fund is topped up. Goals are planned on this, because planning a
   * 20-year retirement around a 4-month credit-card payoff would understate
   * what the household can really do.
   */
  steadyStateAvailable: number;
  /** Amount-weighted months until the temporary commitments end. */
  monthsUntilSteadyState: number;
  blocked: boolean;
  warnings: string[];
};


export function runWaterfall(
  profile: FinancialProfile,
  d: DerivedFinancials,
  tax: TaxRecommendation,
): WaterfallResult {
  const actions: ActionItem[] = [];
  const warnings: string[] = [];
  let rank = 1;
  let surplus = d.investableSurplus;
  let blocked = false;

  /** Commitments that end on a known date, and the surplus they release. */
  const temporary: { amount: number; months: number }[] = [];

  const push = (a: Omit<ActionItem, 'rank'>) => {
    actions.push({ ...a, rank: rank++ });
  };

  /* ---------------------------------------------------------------- */
  /* Level 0 — deficit. Nothing else matters.                          */
  /* ---------------------------------------------------------------- */

  if (surplus <= 0) {
    blocked = true;
    const deficit = Math.abs(surplus);
    push({
      category: 'cashflow_repair',
      title: `Close a monthly deficit of ${inr(deficit)}`,
      monthlyAmount: deficit,
      surplusConsumed: 0,
      oneTimeAmount: 0,
      reason:
        `You are spending ${inr(deficit)} more than you earn every month, which is being funded by savings or borrowing. ` +
        `No investment can outrun that. Your discretionary spending is ${inr(d.discretionaryMonthlyExpenses)} a month and your EMIs are ${inr(d.totalMonthlyEMI)} — ` +
        `those are the two levers. We are not recommending any investment until the gap is closed.`,
      urgency: 'immediate',
      blocksInvesting: true,
    });
    warnings.push(
      'Recommendations are suspended: this profile has no investable surplus. The plan shown is a cashflow-repair plan, not an investment plan.',
    );
    return {
      actions,
      availableForGoals: 0,
      steadyStateAvailable: 0,
      monthsUntilSteadyState: 0,
      blocked,
      warnings,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Level 1 — protection, reserved as a fixed cost                    */
  /* ---------------------------------------------------------------- */

  // Per-earner premiums, summed — a household buys one policy per earner.
  const termPremium = d.termCoverByEarner.reduce((a, e) => a + e.estimatedMonthlyPremium, 0);

  const adults = 1 + (profile.additionalEarners?.length ?? 0) +
    (profile.personal.maritalStatus === 'married' && !(profile.additionalEarners?.length) ? 1 : 0);
  const children = profile.dependents.filter((x) => x.relationship === 'child').length;

  const healthPremium =
    d.healthCoverGap > 0
      ? healthPremiumMonthly({
          cover: d.healthCoverGap,
          eldestAdultAge: Math.max(
            profile.personal.age,
            ...(profile.additionalEarners ?? []).map((e) => e.age),
          ),
          cityTier: profile.personal.cityTier,
          adults,
          children,
        })
      : 0;
  const protectionCost = termPremium + healthPremium;

  if (protectionCost > surplus) {
    warnings.push(
      `Closing your insurance gaps would cost roughly ${inr(protectionCost)} a month, more than your ${inr(surplus)} surplus. ` +
        `Protection still comes first — reduce the cover to what you can afford today rather than going uninsured, and raise it as income grows.`,
    );
  }

  if (termPremium > 0) {
    const spend = Math.min(termPremium, surplus);
    surplus -= spend;
    push({
      category: 'protection',
      title: `Buy ${inr(d.termCoverGap)} of additional term life cover`,
      monthlyAmount: termPremium,
      surplusConsumed: spend,
      oneTimeAmount: 0,
      reason:
        `You need about ${inr(d.requiredTermCover)} of cover and hold ${inr(d.requiredTermCover - d.termCoverGap)}. ` +
        `With ${profile.dependents.length > 0 ? `${profile.dependents.length} financial dependent${profile.dependents.length === 1 ? '' : 's'}` : 'a financially dependent spouse'} and ${inr(d.totalLiabilities)} of liabilities, this gap is the largest single risk in your plan — larger than any market risk. ` +
        `At roughly ${inr(termPremium)} a month${d.termCoverByEarner.length > 1 ? ` across ${d.termCoverByEarner.length} earners` : ''} it is also the cheapest thing here, which is why it is funded before debt repayment rather than after it. ` +
        `Buy pure term insurance only: no ULIP, no endowment, no return-of-premium variant.`,
      urgency: 'immediate',
      blocksInvesting: false,
    });
  }

  if (healthPremium > 0) {
    const spend = Math.min(healthPremium, surplus);
    surplus -= spend;
    push({
      category: 'protection',
      title: `Add ${inr(d.healthCoverGap)} of health cover`,
      monthlyAmount: healthPremium,
      surplusConsumed: spend,
      oneTimeAmount: 0,
      reason:
        profile.insurance.employerProvidedHealthCover > 0 &&
        profile.insurance.healthCoverSelf + profile.insurance.healthCoverFamilyFloater === 0
          ? `Your only health cover comes from your employer, and it disappears the day you leave, are laid off, or fall ill enough to stop working — which is exactly when you need it. A personal policy, ideally a base plan plus a super top-up, fixes this for about ${inr(healthPremium)} a month.`
          : `Medical inflation runs at 10–12% a year. A single hospitalisation without adequate cover is the most common reason a household's investment plan gets liquidated — about ${inr(healthPremium)} a month prevents it.`,
      urgency: 'this_month',
      blocksInvesting: false,
    });
  }

  /* A super top-up is the cheapest large cover available and is routinely
     missed: ₹50 lakh above a ₹10 lakh deductible costs roughly ₹300 a month. */
  if (d.requiredHealthCover > 0 && d.healthCoverGap <= 0 && surplus > 0) {
    // Funded, not merely suggested. Protection is a fixed cost in this engine,
    // and at this price it is the single best value in the whole plan.
    const topUpMonthly = Math.min(Math.round(SUPER_TOPUP.annualPremium / 12), surplus);
    surplus -= topUpMonthly;
    push({
      category: 'protection',
      title: `Add a ${inr(SUPER_TOPUP.cover)} super top-up`,
      monthlyAmount: topUpMonthly,
      surplusConsumed: topUpMonthly,
      oneTimeAmount: 0,
      reason:
        `Your base cover is adequate for an ordinary hospitalisation. A super top-up pays out above a ${inr(SUPER_TOPUP.deductible)} deductible, ` +
        `so it costs about ${inr(topUpMonthly)} a month for ${inr(SUPER_TOPUP.cover)} of protection against the rare event that would otherwise ruin the plan — ` +
        `a cancer or transplant bill. It is the cheapest cover per rupee available in India, and the most commonly overlooked.`,
      urgency: 'this_month',
      blocksInvesting: false,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Level 2 — high-cost debt                                          */
  /* ---------------------------------------------------------------- */

  const expensiveLoans = profile.liabilities
    .filter((l) => l.interestRate > WATERFALL.highCostDebtRate && l.outstandingAmount > 0)
    .sort((a, b) => b.interestRate - a.interestRate);

  for (const loan of expensiveLoans) {
    if (surplus <= 0) break;
    const monthlyInterest = (loan.outstandingAmount * loan.interestRate) / 12;
    const extra = Math.max(0, surplus * 0.8);
    // The EMI is already being paid, so the total going at this loan is EMI + extra.
    const totalMonthly = extra + loan.monthlyEMI;
    const monthsToClear = totalMonthly > 0 ? Math.ceil(loan.outstandingAmount / totalMonthly) : 99;
    surplus -= extra;
    // Once cleared, BOTH the extra and the EMI come back to the household.
    temporary.push({ amount: totalMonthly, months: monthsToClear });
    push({
      category: 'debt_payoff',
      title: `Clear ${loan.type.replace(/_/g, ' ')} of ${inr(loan.outstandingAmount)} at ${(loan.interestRate * 100).toFixed(1)}%`,
      monthlyAmount: Math.round(totalMonthly),
      surplusConsumed: extra,
      oneTimeAmount: loan.outstandingAmount,
      reason:
        `This debt costs you ${inr(monthlyInterest)} a month in interest alone. ` +
        `Paying it off is a guaranteed, tax-free ${(loan.interestRate * 100).toFixed(1)}% return — no investment available in India reliably beats that. ` +
        `Put your existing ${inr(loan.monthlyEMI)} EMI plus ${inr(extra)} of surplus against it and it clears in about ${monthsToClear} month${monthsToClear === 1 ? '' : 's'}, ` +
        `after which ${inr(totalMonthly)} a month comes back to you permanently.`,
      urgency: 'immediate',
      blocksInvesting: true,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Level 3 — emergency fund                                          */
  /* ---------------------------------------------------------------- */

  const efGap = Math.max(0, d.emergencyFundTarget - d.emergencyFundCurrent);
  if (efGap > 0 && surplus > 0) {
    // Build it over 12 months, but never take more than 60% of what is left.
    const monthly = Math.min(surplus * 0.6, Math.ceil(efGap / 12));
    surplus -= monthly;
    temporary.push({ amount: monthly, months: monthly > 0 ? Math.ceil(efGap / monthly) : 12 });
    push({
      category: 'emergency_fund',
      title: `Build the emergency fund to ${inr(d.emergencyFundTarget)}`,
      monthlyAmount: Math.round(monthly),
      surplusConsumed: monthly,
      oneTimeAmount: Math.round(efGap),
      reason:
        `You have ${d.emergencyFundMonthsCovered.toFixed(1)} months of cover; the target for your income profile is ${d.emergencyFundTargetMonths} months (${inr(d.emergencyFundTarget)}). ` +
        `This is not an investment — it is what stops you selling investments at the worst possible moment. Keep it in a liquid fund or sweep-in FD, not equity.`,
      urgency: 'this_month',
      blocksInvesting: false,
    });
  } else if (efGap <= 0) {
    push({
      category: 'emergency_fund',
      title: 'Emergency fund is fully funded — stop adding to it',
      monthlyAmount: 0,
      surplusConsumed: 0,
      oneTimeAmount: 0,
      reason: `${inr(d.emergencyFundCurrent)} covers ${d.emergencyFundMonthsCovered.toFixed(1)} months against a target of ${d.emergencyFundTargetMonths}. Money beyond the target is earning around 6.5% when it could be working harder. Move the excess into the goal allocation below.`,
      urgency: 'ongoing',
      blocksInvesting: false,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Level 4 — investment-linked policy review                         */
  /* ---------------------------------------------------------------- */

  for (const cmp of comparePolicies(profile, d)) {
    if (cmp.recommendation === 'surrender_and_redirect') {
      push({
        category: 'product_review',
        title: `Surrender ${cmp.label} and redirect the premium — worth about ${inr(cmp.advantageOfSurrender)}`,
        monthlyAmount: 0,
        surplusConsumed: 0,
        oneTimeAmount: Math.round(cmp.surrenderValue),
        reason: cmp.reasoning,
        urgency: 'this_quarter',
        blocksInvesting: false,
      });
    } else {
      push({
        category: 'product_review',
        title: `Keep ${cmp.label} — we checked`,
        monthlyAmount: 0,
        surplusConsumed: 0,
        oneTimeAmount: 0,
        reason: cmp.reasoning,
        urgency: 'ongoing',
        blocksInvesting: false,
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Level 5 — tax efficiency                                          */
  /* ---------------------------------------------------------------- */

  if (tax.recommendedRegime === 'old' && tax.section80CGap > 0) {
    push({
      category: 'tax_efficiency',
      title: `Use ${inr(tax.section80CGap)} of unused 80C headroom`,
      monthlyAmount: 0,
      surplusConsumed: 0,
      oneTimeAmount: tax.section80CGap,
      reason:
        `On the old regime this is worth up to ${inr(tax.section80CGap * 0.312)} a year. ` +
        `Crucially, it is funded from the goal allocation below rather than being extra spending — ELSS and PPF appear inside your long-horizon allocation, so the deduction is a by-product of investing you were going to do anyway.`,
      urgency: 'this_quarter',
      blocksInvesting: false,
    });
  }

  /* Harvesting the annual LTCG exemption is free money, but only if the
     person actually has gains to harvest and acts before 31 March. */
  if (tax.ltcgExemptionUnused > 0 && d.investedAssets > 200_000) {
    const worth = tax.ltcgExemptionUnused * TAX.capitalGains.equityLTCGRate * (1 + TAX.cess);
    push({
      category: 'tax_efficiency',
      title: `Harvest ${inr(tax.ltcgExemptionUnused)} of equity gains before 31 March`,
      monthlyAmount: 0,
      surplusConsumed: 0,
      oneTimeAmount: Math.round(tax.ltcgExemptionUnused),
      reason:
        `The first ${inr(TAX.capitalGains.equityLTCGExemption)} of long-term equity gains each year is tax-free, and the allowance does not carry forward — unused, it is simply gone on 1 April. ` +
        `Sell enough units held over a year to realise ${inr(tax.ltcgExemptionUnused)} of gains, then buy the same fund back the next day. Your holding is unchanged; your cost base resets higher, ` +
        `which saves roughly ${inr(worth)} of tax you would otherwise pay later. Do it every year.`,
      urgency: 'this_quarter',
      blocksInvesting: false,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Level 6 — moderate-cost debt prepayment (a preference, not a rule)*/
  /* ---------------------------------------------------------------- */

  const homeLoan = profile.liabilities.find((l) => l.type === 'home_loan');
  if (homeLoan && homeLoan.interestRate <= WATERFALL.lowCostDebtRate) {
    push({
      category: 'debt_prepayment',
      title: `Home loan at ${(homeLoan.interestRate * 100).toFixed(1)}% — prepay only if you want to`,
      monthlyAmount: 0,
      surplusConsumed: 0,
      oneTimeAmount: 0,
      reason:
        `Prepaying gives a guaranteed ${(homeLoan.interestRate * 100).toFixed(1)}% return; a long-horizon equity allocation has a higher expected return but no guarantee. ` +
        `Mathematically, investing usually wins over 15+ years. Emotionally, being debt-free is worth a lot to some people. This one is genuinely your call, and we have not assumed either way.`,
      urgency: 'ongoing',
      blocksInvesting: false,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Level 7 — goal investing, now and at steady state                 */
  /* ---------------------------------------------------------------- */

  const availableForGoals = Math.max(0, Math.round(surplus));

  const releasedLater = temporary.reduce((a, t) => a + t.amount, 0);
  // Amount-weighted, not worst-case: a small emergency-fund top-up running for
  // 15 months should not delay the whole plan as if every rupee were frozen.
  const monthsUntilSteadyState =
    releasedLater > 0
      ? Math.round(temporary.reduce((a, t) => a + t.amount * t.months, 0) / releasedLater)
      : 0;
  const steadyStateAvailable = Math.max(0, Math.round(availableForGoals + releasedLater));

  if (steadyStateAvailable > 0) {
    const phased = releasedLater > 0 && monthsUntilSteadyState > 0;
    const startsNow = availableForGoals > 0;

    push({
      category: 'goal_investment',
      title: !phased
        ? `Invest ${inr(steadyStateAvailable)} a month across your goals`
        : startsNow
          ? `Start with ${inr(availableForGoals)} a month, rising to ${inr(steadyStateAvailable)} in about ${monthsUntilSteadyState} month${monthsUntilSteadyState === 1 ? '' : 's'}`
          : `Begin investing in about ${monthsUntilSteadyState} month${monthsUntilSteadyState === 1 ? '' : 's'}, at ${inr(steadyStateAvailable)} a month`,
      monthlyAmount: availableForGoals,
      monthlyAmountLater: phased ? steadyStateAvailable : undefined,
      startsInMonths: phased ? monthsUntilSteadyState : undefined,
      surplusConsumed: availableForGoals,
      oneTimeAmount: 0,
      reason: !phased
        ? `This is what remains after protection, debt and emergency cover are handled. It is split across your goals by priority and time horizon in the goal plan below — each goal gets its own asset mix, because money needed in two years and money needed in twenty should not be invested the same way.`
        : startsNow
          ? `${inr(availableForGoals)} is free to invest right now. Once the commitments above finish — roughly ${monthsUntilSteadyState} month${monthsUntilSteadyState === 1 ? '' : 's'} away — a further ${inr(releasedLater)} a month is released. Redirect it straight into this plan rather than into lifestyle; that single habit is worth more than any fund selection. The goal figures below are sized on the full ${inr(steadyStateAvailable)}.`
          : `Every rupee of your surplus is currently committed to protection, clearing high-cost debt and building your emergency fund — which is exactly where it should be. Nothing is left to invest this month, and that is the correct answer, not a failure. In about ${monthsUntilSteadyState} month${monthsUntilSteadyState === 1 ? '' : 's'} those commitments end and ${inr(steadyStateAvailable)} a month becomes available. The goal figures below are sized on that amount, starting from then.`,
      urgency: 'ongoing',
      blocksInvesting: false,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Self-check: the plan must fit inside the surplus.                 */
  /* ---------------------------------------------------------------- */

  const committed = actions.reduce((a, x) => a + x.surplusConsumed, 0);
  if (committed > Math.max(0, d.investableSurplus) + 1) {
    warnings.push(
      `ENGINE WARNING: the action plan commits ₹${Math.round(committed)} of a ₹${Math.round(d.investableSurplus)} surplus. This is a bug, not advice.`,
    );
  }

  return {
    actions,
    availableForGoals,
    steadyStateAvailable,
    monthsUntilSteadyState,
    blocked,
    warnings,
  };
}
