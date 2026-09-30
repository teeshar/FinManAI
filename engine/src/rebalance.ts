/**
 * Stage 5b — Rebalancing the EXISTING portfolio.
 *
 * Everything before this stage directs NEW money. For a household over 40 the
 * existing corpus is usually many times the monthly contribution, so a plan
 * that only allocates the SIP is advising on a small fraction of their wealth —
 * and can leave someone holding 90% equity at 58 while the plan politely
 * discusses where their next ₹20,000 should go.
 *
 * Three principles, in order:
 *
 *   1. The cheapest rebalancing is free. Redirecting new contributions to the
 *      underweight asset costs nothing and triggers no tax. Always try it first.
 *   2. Selling has a price. Every switch is quoted WITH its tax cost, computed
 *      from the actual holding period and unrealised gain — never as a gross
 *      amount that quietly ignores 12.5% or a slab rate.
 *   3. Some things cannot be sold. Statutory lock-ins and illiquid assets are
 *      constraints, not recommendations. We say so rather than pretending.
 */

import type {
  AssetClass,
  Asset,
  ClassifiedHolding,
  DerivedFinancials,
  DriftLine,
  FinancialProfile,
  HoldingLiquidity,
  RebalanceAction,
  RebalancingPlan,
  TaxRecommendation,
} from './types.ts';
import { CAPS, TAX } from './assumptions/v2026-08.ts';
import {
  assetClassWeights,
  retirementTranches,
  retirementWeights,
} from './allocation.ts';
import type { AllocationContext } from './allocation.ts';
import { bucketFor, fv, yearsBetween } from './goals.ts';
import { GOAL_INFLATION, GENERAL_INFLATION } from './assumptions/v2026-08.ts';
import { marginalRate } from './tax.ts';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const pct = (n: number) => (n * 100).toFixed(1) + '%';

/** Drift beyond this many percentage points is worth acting on. */
const DRIFT_BAND_POINTS = 5;

/** If new contributions close the gap within this many months, never sell. */
const MAX_MONTHS_TO_FIX_WITH_NEW_MONEY = 24;

const ASSET_CLASS_OF: Partial<Record<Asset['type'], AssetClass>> = {
  savings_account: 'debt',
  cash: 'debt',
  fixed_deposit: 'debt',
  recurring_deposit: 'debt',
  epf: 'debt',
  ppf: 'debt',
  nps: 'debt',
  sukanya_samriddhi: 'debt',
  debt_mutual_fund: 'debt',
  bonds: 'debt',
  equity_mutual_fund: 'equity',
  hybrid_mutual_fund: 'equity',
  stocks: 'equity',
  gold: 'gold',
  reit_invit: 'real_assets',
  property_investment: 'real_assets',
  crypto: 'crypto',
};

const LOCKED_TYPES: Asset['type'][] = ['epf', 'ppf', 'nps', 'sukanya_samriddhi'];
const ILLIQUID_TYPES: Asset['type'][] = ['property_investment', 'business_ownership'];
const NEVER_INVESTMENTS: Asset['type'][] = [
  'property_self_occupied',
  'ulip',
  'endowment_policy',
];

function monthsBetween(fromISO: string, toISO: string): number {
  return Math.max(0, Math.round(yearsBetween(fromISO, toISO) * 12));
}

/**
 * Tax due on selling a holding in full, given the holding period and gain.
 * `ltcgHeadroom` is the unused part of the ₹1.25L annual equity exemption; it
 * is consumed by the caller in order of cheapest-first.
 */
function exitTaxFor(
  holding: { type: Asset['type']; unrealisedGain: number; holdingMonths: number },
  slabRate: number,
  ltcgHeadroom: number,
): { tax: number; headroomUsed: number } {
  const gain = Math.max(0, holding.unrealisedGain);
  if (gain <= 0) return { tax: 0, headroomUsed: 0 };
  const cg = TAX.capitalGains;

  switch (holding.type) {
    case 'equity_mutual_fund':
    case 'hybrid_mutual_fund':
    case 'stocks':
    case 'reit_invit': {
      if (holding.holdingMonths >= cg.equityLongTermMonths) {
        const sheltered = Math.min(gain, Math.max(0, ltcgHeadroom));
        const taxable = gain - sheltered;
        return { tax: taxable * cg.equityLTCGRate * (1 + TAX.cess), headroomUsed: sheltered };
      }
      return { tax: gain * cg.equitySTCGRate * (1 + TAX.cess), headroomUsed: 0 };
    }
    case 'gold':
      return holding.holdingMonths >= cg.goldLongTermMonths
        ? { tax: gain * cg.goldLTCGRate * (1 + TAX.cess), headroomUsed: 0 }
        : { tax: gain * slabRate, headroomUsed: 0 };
    case 'crypto':
      return { tax: gain * cg.cryptoFlatRate * (1 + TAX.cess), headroomUsed: 0 };
    case 'property_investment':
      return holding.holdingMonths >= cg.propertyLongTermMonths
        ? { tax: gain * cg.propertyLTCGRate * (1 + TAX.cess), headroomUsed: 0 }
        : { tax: gain * slabRate, headroomUsed: 0 };
    case 'debt_mutual_fund':
    case 'bonds':
      // Bought after 1 Apr 2023: slab rate, no long-term benefit.
      return { tax: gain * slabRate, headroomUsed: 0 };
    default:
      // Deposits and savings: interest is taxed as it accrues, nothing on exit.
      return { tax: 0, headroomUsed: 0 };
  }
}

function classify(
  profile: FinancialProfile,
  derived: DerivedFinancials,
  todayISO: string,
  slabRate: number,
  ltcgHeadroom: number,
): ClassifiedHolding[] {
  // The emergency fund is not part of the investment portfolio. Ring-fence it
  // out of the liquid holdings before anything is measured.
  let emergencyToShield = Math.min(derived.liquidAssets, derived.emergencyFundTarget);

  return profile.assets.map((a) => {
    const assetClass = ASSET_CLASS_OF[a.type] ?? 'debt';
    const holdingMonths = monthsBetween(a.investmentDate, todayISO);
    const unrealisedGain = a.currentValue - a.amountInvested;

    let liquidity: HoldingLiquidity = 'liquid';
    let exclusionReason: string | undefined;
    let effectiveValue = a.currentValue;

    if (NEVER_INVESTMENTS.includes(a.type)) {
      liquidity = 'excluded';
      exclusionReason =
        a.type === 'property_self_occupied'
          ? 'Your home is where you live, not part of the investment portfolio.'
          : 'Investment-linked insurance is handled separately in the action plan, not rebalanced.';
    } else if (ILLIQUID_TYPES.includes(a.type)) {
      liquidity = 'illiquid';
      exclusionReason =
        'Cannot be sold in part, quickly, or cheaply — treated as a constraint rather than something to rebalance.';
    } else if (LOCKED_TYPES.includes(a.type) || a.lockInMonthsRemaining > 0) {
      liquidity = 'locked';
      exclusionReason =
        a.lockInMonthsRemaining > 0
          ? `Locked for another ${a.lockInMonthsRemaining} months.`
          : 'Statutory lock-in — counts towards your allocation but cannot be sold.';
    } else if (
      ['savings_account', 'cash', 'fixed_deposit', 'recurring_deposit'].includes(a.type) &&
      emergencyToShield > 0
    ) {
      const shielded = Math.min(effectiveValue, emergencyToShield);
      emergencyToShield -= shielded;
      effectiveValue -= shielded;
      if (effectiveValue <= 0) {
        liquidity = 'excluded';
        exclusionReason = 'Held as your emergency fund — deliberately not invested.';
      } else {
        exclusionReason = `${inr(shielded)} of this is ring-fenced as your emergency fund.`;
      }
    }

    const { tax } = exitTaxFor({ type: a.type, unrealisedGain, holdingMonths }, slabRate, ltcgHeadroom);

    return {
      assetId: a.id,
      label: a.label ?? a.type.replace(/_/g, ' '),
      type: a.type,
      assetClass,
      currentValue: liquidity === 'excluded' ? a.currentValue : effectiveValue,
      investedAmount: a.amountInvested,
      unrealisedGain,
      holdingMonths,
      liquidity,
      taxOnFullExit: Math.round(tax),
      exclusionReason,
    };
  });
}

/**
 * The target mix for the existing corpus: each goal's target weights, blended
 * by that goal's share of total future corpus required. A portfolio funds
 * goals, so it should look like the goals it funds.
 */
function portfolioTargetWeights(
  profile: FinancialProfile,
  ctx: AllocationContext,
  todayISO: string,
): Record<AssetClass, number> {
  const blended: Record<AssetClass, number> = {
    equity: 0,
    debt: 0,
    gold: 0,
    real_assets: 0,
    crypto: 0,
  };

  const entries = profile.goals
    .map((goal) => {
      const years = yearsBetween(todayISO, goal.targetDate);
      const inflation = goal.considerInflation
        ? (goal.customInflationRate ?? GOAL_INFLATION[goal.category] ?? GENERAL_INFLATION)
        : 0;
      const corpus = fv(goal.requiredAmountToday, inflation, years);
      const weights =
        goal.category === 'retirement'
          ? retirementWeights(
              retirementTranches(years, profile.personal.expectedRetirementAge),
              ctx,
            )
          : assetClassWeights(bucketFor(years), ctx);
      return { corpus, weights };
    })
    .filter((e) => e.corpus > 0);

  if (entries.length === 0) {
    // No goals recorded: fall back to the long-horizon mix for their risk band.
    return assetClassWeights('long', ctx);
  }

  const totalCorpus = entries.reduce((a, e) => a + e.corpus, 0);
  for (const e of entries) {
    const share = e.corpus / totalCorpus;
    for (const k of Object.keys(blended) as AssetClass[]) blended[k] += e.weights[k] * share;
  }
  return blended;
}

export function planRebalancing(
  profile: FinancialProfile,
  derived: DerivedFinancials,
  ctx: AllocationContext,
  tax: TaxRecommendation,
  monthlyNewMoney: number,
  todayISO: string,
): RebalancingPlan {
  const slabRate = marginalRate(profile, derived, tax.recommendedRegime);
  const taxFreeHeadroom = tax.ltcgExemptionUnused;

  const holdings = classify(profile, derived, todayISO, slabRate, taxFreeHeadroom);

  // Locked holdings count towards the allocation — they are real exposure — but
  // cannot be sold. Excluded ones are not part of the portfolio at all.
  const counted = holdings.filter((h) => h.liquidity !== 'excluded');
  const portfolioValue = counted.reduce((a, h) => a + h.currentValue, 0);
  const excludedValue = holdings
    .filter((h) => h.liquidity === 'excluded')
    .reduce((a, h) => a + h.currentValue, 0);

  const empty: Record<AssetClass, number> = { equity: 0, debt: 0, gold: 0, real_assets: 0, crypto: 0 };

  if (portfolioValue <= 0) {
    return {
      portfolioValue: 0,
      excludedValue: Math.round(excludedValue),
      holdings,
      current: { ...empty },
      target: { ...empty },
      drift: [],
      maxDriftPoints: 0,
      needsRebalancing: false,
      taxFreeHeadroom,
      estimatedTaxToRebalanceNow: 0,
      monthsToCloseWithNewMoney: 0,
      actions: [],
      summary:
        'You have no existing investment portfolio to rebalance yet — everything in this plan is about where new money goes. That is the easy case: you get to build it right from the start.',
    };
  }

  const currentValueByClass = { ...empty };
  for (const h of counted) currentValueByClass[h.assetClass] += h.currentValue;

  const current = { ...empty };
  for (const k of Object.keys(current) as AssetClass[])
    current[k] = currentValueByClass[k] / portfolioValue;

  const target = portfolioTargetWeights(profile, ctx, todayISO);

  const drift: DriftLine[] = (Object.keys(empty) as AssetClass[])
    .map((assetClass) => {
      const currentPercent = current[assetClass];
      const targetPercent = target[assetClass];
      const targetValue = targetPercent * portfolioValue;
      const driftPoints = (currentPercent - targetPercent) * 100;
      return {
        assetClass,
        currentValue: Math.round(currentValueByClass[assetClass]),
        currentPercent: Math.round(currentPercent * 10000) / 10000,
        targetPercent: Math.round(targetPercent * 10000) / 10000,
        targetValue: Math.round(targetValue),
        driftPoints: Math.round(driftPoints * 10) / 10,
        action:
          driftPoints > DRIFT_BAND_POINTS
            ? ('reduce' as const)
            : driftPoints < -DRIFT_BAND_POINTS
              ? ('increase' as const)
              : ('hold' as const),
        amount: Math.round(Math.abs(currentValueByClass[assetClass] - targetValue)),
      };
    })
    .filter((d) => d.currentValue > 0 || d.targetPercent > 0.01)
    .sort((a, b) => Math.abs(b.driftPoints) - Math.abs(a.driftPoints));

  const maxDriftPoints = drift.length ? Math.max(...drift.map((d) => Math.abs(d.driftPoints))) : 0;
  const needsRebalancing = maxDriftPoints > DRIFT_BAND_POINTS;

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  const actions: RebalanceAction[] = [];
  let rank = 1;
  // Local, not module-level: the engine must stay pure, and a shared counter
  // would leak tax from one household's plan into the next one's.
  let totalTaxAccumulated = 0;
  const underweight = drift.filter((d) => d.action === 'increase');
  const overweight = drift.filter((d) => d.action === 'reduce');
  const gapToClose = underweight.reduce((a, d) => a + d.amount, 0);
  const monthsToCloseWithNewMoney =
    monthlyNewMoney > 0 ? Math.ceil(gapToClose / monthlyNewMoney) : Infinity;

  if (!needsRebalancing) {
    actions.push({
      rank: rank++,
      kind: 'hold',
      title: 'No rebalancing needed — leave the portfolio alone',
      amount: 0,
      taxCost: 0,
      reason: `Your largest drift from target is ${maxDriftPoints.toFixed(1)} percentage points, inside the ${DRIFT_BAND_POINTS}-point band we act on. Trading to correct a gap this small costs more in tax and charges than the improvement is worth.`,
    });
  } else {
    /* Lever 1 — free. Redirect new contributions. */
    if (monthlyNewMoney > 0 && Number.isFinite(monthsToCloseWithNewMoney)) {
      const willFixAlone = monthsToCloseWithNewMoney <= MAX_MONTHS_TO_FIX_WITH_NEW_MONEY;
      actions.push({
        rank: rank++,
        kind: 'redirect_contributions',
        title: `Direct your ${inr(monthlyNewMoney)} monthly investment towards ${underweight.map((d) => d.assetClass.replace(/_/g, ' ')).join(' and ')}`,
        amount: monthlyNewMoney,
        taxCost: 0,
        reason: willFixAlone
          ? `This closes the ${inr(gapToClose)} gap in about ${monthsToCloseWithNewMoney} months without selling anything — so it costs you nothing in tax, exit loads or brokerage. This is always the first move, and here it is the only one you need.`
          : `New money alone would take about ${monthsToCloseWithNewMoney} months to close the ${inr(gapToClose)} gap — too slow on its own, but every rupee it fixes is a rupee you do not have to sell and pay tax on. Do this first, then consider the switches below.`,
      });

      if (willFixAlone) {
        return finish();
      }
    }

    /* Lever 2 — sell, cheapest first, using the LTCG exemption. */
    let headroom = taxFreeHeadroom;
    let totalTax = 0;

    for (const over of overweight) {
      // Cheapest tax per rupee sold, not smallest absolute gain: selling ₹1 of
      // a holding that has doubled costs far more than ₹1 of one that has not.
      const gainRatio = (h: ClassifiedHolding) =>
        h.currentValue > 0 ? Math.max(0, h.unrealisedGain) / h.currentValue : 0;
      const sellable = counted
        .filter((h) => h.assetClass === over.assetClass && h.liquidity === 'liquid')
        .sort((a, b) => gainRatio(a) - gainRatio(b));

      let remaining = over.amount;

      for (const h of sellable) {
        if (remaining <= 0) break;
        const slice = Math.min(remaining, h.currentValue);
        const gainShare = h.currentValue > 0 ? (h.unrealisedGain * slice) / h.currentValue : 0;
        const { tax: sliceTax, headroomUsed } = exitTaxFor(
          { type: h.type, unrealisedGain: gainShare, holdingMonths: h.holdingMonths },
          slabRate,
          headroom,
        );
        headroom = Math.max(0, headroom - headroomUsed);
        totalTax += sliceTax;
        remaining -= slice;

        actions.push({
          rank: rank++,
          kind: 'switch',
          title: `Move ${inr(slice)} out of ${h.label}`,
          amount: Math.round(slice),
          taxCost: Math.round(sliceTax),
          reason:
            `${over.assetClass.replace(/_/g, ' ')} is ${over.driftPoints.toFixed(1)} points above target — ${pct(over.currentPercent)} against ${pct(over.targetPercent)}. ` +
            (sliceTax === 0
              ? headroomUsed > 0
                ? `Selling this slice realises ${inr(gainShare)} of gains, which fits inside your unused ₹1.25 lakh annual LTCG exemption — so the switch is tax-free. Doing it before 31 March is worth real money.`
                : `No tax is due on this switch.`
              : `Selling realises ${inr(gainShare)} of gains and costs about ${inr(sliceTax)} in tax. Worth it to correct a ${over.driftPoints.toFixed(1)}-point drift, but spread it across two financial years if you can — that uses two years of the ₹1.25 lakh exemption instead of one.`),
        });
      }

      if (remaining > 1000) {
        const lockedInClass = counted.filter(
          (h) => h.assetClass === over.assetClass && h.liquidity !== 'liquid',
        );
        if (lockedInClass.length > 0) {
          actions.push({
            rank: rank++,
            kind: 'flag_locked',
            title: `${inr(remaining)} of the ${over.assetClass.replace(/_/g, ' ')} overweight cannot be sold`,
            amount: Math.round(remaining),
            taxCost: 0,
            reason: `It sits in ${lockedInClass.map((h) => h.label).join(', ')}, which are locked. Correct the balance by directing new money elsewhere rather than trying to exit these.`,
          });
        }
      }
    }

    totalTaxAccumulated = totalTax;
  }

  /* Illiquid concentration is a risk worth naming even when nothing can be done. */
  const illiquidValue = holdings
    .filter((h) => h.liquidity === 'illiquid')
    .reduce((a, h) => a + h.currentValue, 0);
  if (illiquidValue > 0 && derived.totalAssets > 0) {
    const share = illiquidValue / derived.totalAssets;
    if (share > 0.4) {
      actions.push({
        rank: rank++,
        kind: 'flag_illiquid',
        title: `${pct(share)} of your assets are illiquid`,
        amount: Math.round(illiquidValue),
        taxCost: 0,
        reason: `${inr(illiquidValue)} sits in property or business ownership, which cannot be sold in part, quickly or cheaply. That is a concentration risk no allocation table will show you. It does not need fixing today, but it should stop you adding more of the same.`,
      });
    }
  }

  return finish();

  function finish(): RebalancingPlan {
    return {
      portfolioValue: Math.round(portfolioValue),
      excludedValue: Math.round(excludedValue),
      holdings,
      current,
      target,
      drift,
      maxDriftPoints: Math.round(maxDriftPoints * 10) / 10,
      needsRebalancing,
      taxFreeHeadroom,
      estimatedTaxToRebalanceNow: Math.round(totalTaxAccumulated),
      monthsToCloseWithNewMoney: Number.isFinite(monthsToCloseWithNewMoney)
        ? monthsToCloseWithNewMoney
        : 0,
      actions,
      summary: buildSummary(),
    };
  }

  function buildSummary(): string {
    if (!needsRebalancing) {
      return `Your existing ${inr(portfolioValue)} portfolio is close enough to target — the largest gap is ${maxDriftPoints.toFixed(1)} percentage points. Leave it alone and put your attention on the new-money plan above.`;
    }

    const worst = drift[0];
    const direction = worst.driftPoints > 0 ? 'more' : 'less';
    const head =
      `Your existing ${inr(portfolioValue)} portfolio holds ${pct(worst.currentPercent)} in ${worst.assetClass.replace(/_/g, ' ')} against a target of ${pct(worst.targetPercent)} — ` +
      `${Math.abs(worst.driftPoints).toFixed(1)} percentage points ${direction} than the plan calls for, or about ${inr(worst.amount)}.`;

    // Is the overweight actually sellable? If it sits in locked or illiquid
    // holdings, saying "reduce it" would be advice the client cannot follow.
    const overweightIsSellable =
      worst.driftPoints <= 0 ||
      counted.some((h) => h.assetClass === worst.assetClass && h.liquidity === 'liquid');

    if (!overweightIsSellable) {
      return (
        `${head} That overweight sits in holdings you cannot sell — locked or illiquid — so this is a constraint to plan around, not a trade to place. ` +
        `Correct it by directing new money elsewhere, and treat it as a reason not to add more of the same.`
      );
    }

    // The honest framing depends on whether new contributions fix it on their
    // own. Telling someone with a small corpus that it "matters more than your
    // next contribution" is simply untrue.
    const fixesItself =
      monthlyNewMoney > 0 &&
      Number.isFinite(monthsToCloseWithNewMoney) &&
      monthsToCloseWithNewMoney <= MAX_MONTHS_TO_FIX_WITH_NEW_MONEY;

    if (fixesItself) {
      return (
        `${head} The good news is that you do not need to sell anything: directing your ${inr(monthlyNewMoney)} monthly investment towards the underweight assets closes the gap in about ${monthsToCloseWithNewMoney} months, at no tax cost.`
      );
    }

    const ratio = portfolioValue / Math.max(1, monthlyNewMoney);
    return (
      `${head} ` +
      (ratio > 60
        ? `This matters more than where your next contribution goes: the corpus is ${ratio.toFixed(0)}× your monthly investment, so correcting it moves far more money than any decision about the SIP.`
        : `New contributions alone would take about ${monthsToCloseWithNewMoney} months to fix, so a partial switch is worth considering alongside them.`)
    );
  }
}

export const _rebalanceInternals = { exitTaxFor, DRIFT_BAND_POINTS, CAPS };
