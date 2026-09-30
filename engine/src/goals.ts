/**
 * Stage 4 — The goal engine.
 *
 * Inflate the target, grow what is already saved, compute the SIP that closes
 * the gap, and — critically — NEGOTIATE when the required SIP exceeds what the
 * person actually has. A planner that says "invest ₹47,000/month" to someone
 * with ₹18,000 of surplus is not planning, it is arithmetic with no judgement.
 *
 * Decision 3: a `house_purchase` goal activates the full affordability model.
 */

import type {
  AllocationSlice,
  DerivedFinancials,
  FinancialProfile,
  Goal,
  GoalPlan,
  HorizonBucket,
} from './types.ts';
import {
  FEASIBILITY,
  GENERAL_INFLATION,
  GOAL_INFLATION,
  HORIZON_BUCKETS,
  PROPERTY,
  RETIREMENT,
  STEP_UP,
  WATERFALL,
} from './assumptions/v2026-08.ts';
import {
  assetClassWeights,
  blendedReturn,
  buildAllocation,
  buildAllocationFromWeights,
  retirementTranches,
  retirementWeights,
} from './allocation.ts';
import type { AllocationContext, Tranche } from './allocation.ts';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export function yearsBetween(fromISO: string, toISO: string): number {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  return Math.max(0, (to - from) / (365.25 * 24 * 3600 * 1000));
}

export function bucketFor(years: number): HorizonBucket {
  if (years <= HORIZON_BUCKETS.shortMaxYears) return 'short';
  if (years <= HORIZON_BUCKETS.mediumMaxYears) return 'medium';
  return 'long';
}

/** Future value of a lump sum. */
export function fv(principal: number, annualRate: number, years: number): number {
  return principal * Math.pow(1 + annualRate, years);
}

/** Monthly SIP needed to accumulate `target` in `years` at `annualRate`. */
export function requiredSIP(target: number, annualRate: number, years: number): number {
  const n = Math.max(1, Math.round(years * 12));
  const r = Math.pow(1 + annualRate, 1 / 12) - 1;
  if (r <= 0) return target / n;
  // SIP at the start of each month (annuity-due), which is how a real SIP works.
  return (target * r) / ((Math.pow(1 + r, n) - 1) * (1 + r));
}

/** Corpus a given SIP accumulates. Inverse of the above. */
export function sipFutureValue(sip: number, annualRate: number, years: number): number {
  const n = Math.max(1, Math.round(years * 12));
  const r = Math.pow(1 + annualRate, 1 / 12) - 1;
  if (r <= 0) return sip * n;
  return sip * ((Math.pow(1 + r, n) - 1) / r) * (1 + r);
}

/* ------------------------------------------------------------------ */
/* Step-up SIP                                                         */
/*                                                                     */
/* Nobody invests the same rupee amount for thirty years. Contributions */
/* rise with income, and modelling them as flat overstated every        */
/* required SIP badly enough to mark almost every goal impossible.      */
/*                                                                     */
/* There is no closed form for the required starting contribution when  */
/* payments step up annually, so we compute the accumulation factor for */
/* ₹1 and divide. Exact, and cheap: at most ~600 iterations.            */
/* ------------------------------------------------------------------ */

const MAX_MONTHS = 600;

/**
 * Future value of ₹1 a month, stepped up by `stepUp` every 12 months,
 * invested at `annualRate` for `years`. Annuity-due (paid at the start of
 * each month), matching how a real SIP mandate works.
 */
export function stepUpAccumulationFactor(
  annualRate: number,
  years: number,
  stepUp: number,
): number {
  const n = Math.min(MAX_MONTHS, Math.max(1, Math.round(years * 12)));
  const r = Math.pow(1 + annualRate, 1 / 12) - 1;
  let factor = 0;
  for (let m = 0; m < n; m++) {
    const yearIndex = Math.floor(m / 12);
    const payment = Math.pow(1 + stepUp, yearIndex);
    factor += payment * Math.pow(1 + r, n - m);
  }
  return factor;
}

/** Starting monthly contribution needed to reach `target` with annual step-ups. */
export function requiredStepUpSIP(
  target: number,
  annualRate: number,
  years: number,
  stepUp: number,
): number {
  if (stepUp <= 0) return requiredSIP(target, annualRate, years);
  const factor = stepUpAccumulationFactor(annualRate, years, stepUp);
  return factor > 0 ? target / factor : requiredSIP(target, annualRate, years);
}

/** Corpus accumulated by a stepped-up SIP starting at `startingSip`. */
export function stepUpFutureValue(
  startingSip: number,
  annualRate: number,
  years: number,
  stepUp: number,
): number {
  if (stepUp <= 0) return sipFutureValue(startingSip, annualRate, years);
  return startingSip * stepUpAccumulationFactor(annualRate, years, stepUp);
}

/**
 * The step-up rate we are willing to assume for a household.
 *
 * Deliberately conservative: only part of income growth reaches the SIP
 * (lifestyle absorbs the rest), and it is capped regardless of what the user
 * optimistically claims their income will do.
 */
export function stepUpRateFor(profile: FinancialProfile, years: number): number {
  if (!STEP_UP.enabled || years < STEP_UP.minYearsToApply) return 0;
  // Retirees and those with no growth expectation get no step-up.
  if (profile.employment.employmentType === 'retired') return 0;
  const stated = profile.employment.expectedIncomeGrowth;
  const base = Number.isFinite(stated) && stated > 0 ? stated : STEP_UP.defaultAnnualStepUp;
  return Math.min(STEP_UP.maxAnnualStepUp, base * STEP_UP.shareOfIncomeGrowthSaved);
}

export type GoalEngineResult = {
  plans: GoalPlan[];
  totalRequiredSIP: number;
  warnings: string[];
};

export function planGoals(
  profile: FinancialProfile,
  derived: DerivedFinancials,
  ctx: AllocationContext,
  availableForGoals: number,
  todayISO: string,
  /** Months before the full contribution can start (debt payoff, EF top-up). */
  startDelayMonths = 0,
): GoalEngineResult {
  const warnings: string[] = [];
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

  // Retirement is a goal even when the user does not list it; without it the
  // plan quietly optimises for the next ten years and ignores the next forty.
  const goals: Goal[] = [...profile.goals];
  if (!goals.some((g) => g.category === 'retirement') && derived.yearsToRetirement > 2) {
    const retirementCorpusToday =
      derived.essentialMonthlyExpenses * 12 * 25 * 0.8; // 25x of 80% of current essential spend
    const targetYear = new Date(todayISO).getFullYear() + Math.round(derived.yearsToRetirement);
    goals.push({
      id: 'auto_retirement',
      name: 'Retirement (added automatically)',
      category: 'retirement',
      requiredAmountToday: Math.round(retirementCorpusToday),
      targetDate: `${targetYear}-04-01`,
      amountAlreadySaved: derived.retirementAssets,
      monthlyAmountCurrentlyInvested: 0,
      priority: 'high',
      considerInflation: true,
    });
    warnings.push(
      `You did not list retirement as a goal, so we added one: ${inr(retirementCorpusToday)} in today's money, being 25 years of 80% of your current essential spending. Adjust it if that assumption is wrong for you.`,
    );
  }

  const sorted = [...goals].sort((a, b) => {
    const p = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (p !== 0) return p;
    return yearsBetween(todayISO, a.targetDate) - yearsBetween(todayISO, b.targetDate);
  });

  /* ---------------------------------------------------------------- */
  /* Pass 1 — cost every goal independently.                           */
  /* ---------------------------------------------------------------- */

  type Costed = {
    goal: Goal;
    years: number;
    investingYears: number;
    delayYears: number;
    bucket: HorizonBucket;
    inflation: number;
    expectedReturn: number;
    futureCost: number;
    projected: number;
    gap: number;
    sipNeeded: number;
    flatSip: number;
    stepUp: number;
    tranches?: Tranche[];
    weights: Record<string, number>;
  };

  const costed: Costed[] = sorted.map((goal) => {
    const years = yearsBetween(todayISO, goal.targetDate);
    const bucket = bucketFor(years);
    const inflation = goal.considerInflation
      ? (goal.customInflationRate ?? GOAL_INFLATION[goal.category] ?? GENERAL_INFLATION)
      : 0;

    // Retirement is a spending stream, not a dated payment: each tranche of the
    // corpus is horizoned by when it is actually drawn, not by the retire date.
    const isRetirement = goal.category === 'retirement';
    const tranches = isRetirement
      ? retirementTranches(years, profile.personal.expectedRetirementAge)
      : undefined;

    const weights = tranches ? retirementWeights(tranches, ctx) : assetClassWeights(bucket, ctx);
    const expectedReturn = blendedReturn(weights);

    const futureCost = fv(goal.requiredAmountToday, inflation, years);
    const projected = fv(goal.amountAlreadySaved, expectedReturn, years);
    const existingSIPValue = sipFutureValue(goal.monthlyAmountCurrentlyInvested, expectedReturn, years);
    const gap = Math.max(0, futureCost - projected - existingSIPValue);

    // Contributions start only after the temporary commitments clear, so the
    // SIP has fewer months to work — which makes it larger, not smaller.
    const delayYears = Math.min(startDelayMonths / 12, Math.max(0, years - 0.25));
    const investingYears = Math.max(0.25, years - delayYears);

    // Contributions rise with income. Modelling them flat for thirty years is
    // what marked almost every goal impossible.
    const stepUp = stepUpRateFor(profile, investingYears);
    const flatSip = gap > 0 ? requiredSIP(gap, expectedReturn, investingYears) : 0;
    const sipNeeded =
      gap > 0 ? requiredStepUpSIP(gap, expectedReturn, investingYears, stepUp) : 0;

    return {
      goal,
      years,
      investingYears,
      delayYears,
      bucket,
      inflation,
      expectedReturn,
      futureCost,
      projected: projected + existingSIPValue,
      gap,
      sipNeeded,
      flatSip,
      stepUp,
      tranches,
      weights,
    };
  });

  /* ---------------------------------------------------------------- */
  /* Pass 2 — fund by priority TIER, splitting within a tier in        */
  /* proportion to need.                                               */
  /*                                                                   */
  /* Funding goals one at a time in strict order is what produces the  */
  /* classic bad output: the first goal swallows the whole surplus and */
  /* a 29-year-old's retirement gets ₹0 — the one goal where time      */
  /* matters most. Within a priority tier, everyone gets a share.      */
  /* ---------------------------------------------------------------- */

  const funding = new Map<string, number>();
  let remaining = availableForGoals;

  for (const tier of ['critical', 'high', 'medium', 'low'] as const) {
    const inTier = costed.filter((c) => c.goal.priority === tier && c.sipNeeded > 0);
    if (inTier.length === 0) continue;

    const tierNeed = inTier.reduce((a, c) => a + c.sipNeeded, 0);
    const tierBudget = Math.min(remaining, tierNeed);
    if (tierBudget <= 0) {
      inTier.forEach((c) => funding.set(c.goal.id, 0));
      continue;
    }

    for (const c of inTier) {
      const share = (c.sipNeeded / tierNeed) * tierBudget;
      funding.set(c.goal.id, share);
    }
    remaining -= tierBudget;
  }

  /* ---------------------------------------------------------------- */
  /* Pass 3 — build the plans.                                         */
  /* ---------------------------------------------------------------- */

  const plans: GoalPlan[] = [];

  for (const c of costed) {
    const { goal, years, investingYears, delayYears, bucket, inflation, expectedReturn, futureCost, projected, gap, sipNeeded, flatSip, stepUp, tranches, weights } = c;
    const shortfall = sipNeeded;
    const funded = Math.round(funding.get(goal.id) ?? 0);

    /* Feasibility, re-banded.
       "Not achievable" applied to 13 of 14 goals meant the label carried no
       information — the genuinely impossible looked identical to the merely
       underfunded. A goal is now only impossible when no plausible amount of
       saving or extra time closes it. */
    let feasibility: GoalPlan['feasibility'];
    if (gap <= 0) {
      feasibility = 'on_track';
    } else if (funded >= shortfall * FEASIBILITY.achievable) {
      feasibility = 'achievable';
    } else if (funded >= shortfall * FEASIBILITY.stretch) {
      feasibility = 'stretch';
    } else {
      const incomeCeiling = derived.plannableMonthlyIncome * FEASIBILITY.impossibleSIPToIncomeRatio;
      const withMoreTime = requiredStepUpSIP(
        gap * Math.pow(1 + inflation, FEASIBILITY.maxTimelineExtensionYears),
        expectedReturn,
        investingYears + FEASIBILITY.maxTimelineExtensionYears,
        stepUp,
      );
      // Impossible only if it stays out of reach even with the full income
      // devoted to it AND ten extra years.
      feasibility =
        sipNeeded > incomeCeiling && withMoreTime > incomeCeiling
          ? 'not_achievable'
          : 'needs_more_saving';
    }

    // Lock-in is still judged against the RETIREMENT DATE, not the spending
    // horizon — the money has to be accessible when drawdown starts, even
    // though its asset mix reflects being spent over decades after that.
    const goalLockInMonths = Math.floor(years * 12);
    const allocation: AllocationSlice[] =
      funded > 0
        ? tranches
          ? buildAllocationFromWeights(
              weights as Record<import('./types.ts').AssetClass, number>,
              years > HORIZON_BUCKETS.shortMaxYears ? 'long' : 'medium',
              funded,
              goalLockInMonths,
              ctx,
            )
          : buildAllocation(bucket, funded, goalLockInMonths, ctx)
        : [];

    let negotiation: string | undefined;
    if (feasibility === 'stretch' || feasibility === 'needs_more_saving' || feasibility === 'not_achievable') {
      negotiation = negotiate(goal, gap, expectedReturn, investingYears, funded, inflation);
    }

    let note: string | undefined;
    if (tranches && tranches.length > 1) {
      const drawdownYears = Math.max(1, RETIREMENT.planToAge - profile.personal.expectedRetirementAge);
      note =
        `Retirement is planned as a ${drawdownYears}-year spending stream to age ${RETIREMENT.planToAge}, not a single date. ` +
        `The portion you will spend in your first years of retirement is held conservatively; the portion you will not touch for decades stays invested for growth. ` +
        `That is why the mix below is not the near-cash portfolio a ${years.toFixed(0)}-year horizon alone would suggest.`;
    }
    if (delayYears > 0.04) {
      note =
        `Contributions start in about ${Math.round(startDelayMonths)} month${Math.round(startDelayMonths) === 1 ? '' : 's'}, once the higher-priority commitments above are cleared, ` +
        `so this SIP is sized over ${investingYears.toFixed(1)} investing years rather than ${years.toFixed(1)}.`;
    }
    if (goal.category === 'house_purchase') {
      note = houseAffordabilityNote(goal, profile, derived, futureCost);
    }
    if (years * 12 <= WATERFALL.nearTermGoalMonths && bucket !== 'short') {
      note = (note ? note + ' ' : '') + 'This goal is less than two years away, so it is held entirely in liquid instruments regardless of your risk profile.';
    }

    const finalSip = stepUp > 0 ? sipNeeded * Math.pow(1 + stepUp, Math.max(0, investingYears - 1)) : sipNeeded;

    plans.push({
      goalId: goal.id,
      name: goal.name,
      category: goal.category,
      yearsToTarget: Math.round(years * 10) / 10,
      bucket,
      inflationRateUsed: inflation,
      futureCost: Math.round(futureCost),
      projectedValueOfExistingSavings: Math.round(projected),
      gap: Math.round(gap),
      expectedReturn: Math.round(expectedReturn * 10000) / 10000,
      requiredMonthlySIP: Math.round(sipNeeded),
      stepUpRate: stepUp,
      finalMonthlySIP: Math.round(finalSip),
      flatEquivalentSIP: Math.round(flatSip),
      currentMonthlySIP: goal.monthlyAmountCurrentlyInvested,
      shortfall: Math.round(Math.max(0, shortfall - funded)),
      feasibility,
      allocation,
      decumulation: tranches?.map((t) => ({
        label: t.label,
        weight: Math.round(t.weight * 1000) / 1000,
        effectiveHorizonYears: t.effectiveHorizonYears,
        bucket: t.bucket,
      })),
      negotiation,
      note,
    });
  }

  return {
    plans,
    totalRequiredSIP: Math.round(plans.reduce((a, p) => a + p.requiredMonthlySIP, 0)),
    warnings,
  };
}

/**
 * When a goal cannot be funded, offer the three real levers: more time, a
 * smaller target, or accepting a partial outcome. Never just fail silently.
 */
function negotiate(
  goal: Goal,
  gap: number,
  expectedReturn: number,
  years: number,
  affordable: number,
  inflation: number,
): string {
  const options: string[] = [];

  if (affordable > 0) {
    // Extra years needed at the affordable SIP.
    let extendedYears = years;
    for (let extra = 0.5; extra <= 15; extra += 0.5) {
      const y = years + extra;
      const inflatedGap = gap * Math.pow(1 + inflation, extra);
      if (sipFutureValue(affordable, expectedReturn, y) >= inflatedGap) {
        extendedYears = y;
        break;
      }
      extendedYears = years + extra;
    }
    const extraYears = Math.round((extendedYears - years) * 10) / 10;
    if (extraYears > 0 && extraYears <= 15) {
      options.push(`give it ${extraYears} more year${extraYears === 1 ? '' : 's'} at ${inr(affordable)} a month`);
    }

    const achievable = sipFutureValue(affordable, expectedReturn, years);
    const shareOfTarget = gap > 0 ? achievable / gap : 1;
    if (shareOfTarget > 0.15) {
      options.push(
        `reduce the target to about ${(shareOfTarget * 100).toFixed(0)}% of what you asked for (${inr(goal.requiredAmountToday * shareOfTarget)} in today's money)`,
      );
    }
  }

  options.push('raise your monthly surplus, by cutting discretionary spending or increasing income');
  options.push('lower the priority of a competing goal so this one gets funded first');

  const affordableText =
    affordable > 0
      ? `We could only allocate ${inr(affordable)} a month to it after higher-priority commitments.`
      : 'After higher-priority commitments there was nothing left to allocate to it.';

  return `This goal needs ${inr(gap)} at the target date. ${affordableText} Your options: ${options.join('; ')}. Choose one — the goal will not fund itself by being left on the list.`;
}

/** Decision 3 — the affordability model runs only when a house is actually a goal. */
function houseAffordabilityNote(
  goal: Goal,
  profile: FinancialProfile,
  derived: DerivedFinancials,
  futureCost: number,
): string {
  const annualIncome = derived.plannableMonthlyIncome * 12;
  const emiHeadroom = Math.max(
    0,
    derived.plannableMonthlyIncome * PROPERTY.maxEmiToIncome - derived.totalMonthlyEMI,
  );

  // Loan supportable by the available EMI headroom.
  const r = PROPERTY.assumedHomeLoanRate / 12;
  const n = PROPERTY.assumedTenureYears * 12;
  const supportableLoan = r > 0 ? (emiHeadroom * (1 - Math.pow(1 + r, -n))) / r : emiHeadroom * n;

  const downPayment = futureCost * PROPERTY.minDownPaymentShare;
  const transactionCost = futureCost * PROPERTY.transactionCostShare;
  const cashNeeded = downPayment + transactionCost;
  const maxSensibleValue = annualIncome * PROPERTY.maxValueToAnnualIncome;

  const parts: string[] = [];
  parts.push(
    `Affordability check: at ${(PROPERTY.assumedHomeLoanRate * 100).toFixed(1)}% over ${PROPERTY.assumedTenureYears} years, your EMI headroom of ${inr(emiHeadroom)} supports a loan of about ${inr(supportableLoan)}.`,
  );
  parts.push(
    `You will also need ${inr(cashNeeded)} in cash — ${inr(downPayment)} down payment plus roughly ${inr(transactionCost)} of stamp duty, registration, brokerage and interiors, which buyers routinely forget.`,
  );

  if (futureCost > maxSensibleValue) {
    parts.push(
      `A property costing ${inr(futureCost)} is ${(futureCost / annualIncome).toFixed(1)}× your annual income. Above ${PROPERTY.maxValueToAnnualIncome}× the loan tends to crowd out every other goal, including retirement. Consider a smaller property or a longer timeline.`,
    );
  } else {
    parts.push(
      `At ${(futureCost / annualIncome).toFixed(1)}× annual income this is within the ${PROPERTY.maxValueToAnnualIncome}× sanity limit.`,
    );
  }

  const ownsProperty = profile.assets.some(
    (a) => a.type === 'property_self_occupied' || a.type === 'property_investment',
  );
  if (ownsProperty) {
    parts.push(
      'You already own property. A second one concentrates a large share of your net worth in a single illiquid, undiversified asset — REITs give the same sector exposure without that concentration.',
    );
  }

  return parts.join(' ');
}
