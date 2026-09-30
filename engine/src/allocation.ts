/**
 * Stage 5 — Asset allocation per horizon bucket.
 *
 * Allocation is decided PER GOAL, not for the person as a whole, then
 * aggregated. The same person can correctly hold 0% equity for a car next year
 * and 75% equity for retirement.
 */

import type {
  AllocationSlice,
  AssetClass,
  DerivedFinancials,
  FinancialProfile,
  HorizonBucket,
  RiskBand,
  RiskProfile,
} from './types.ts';
import {
  ASSET_CLASS_RETURN,
  BASE_ALLOCATION,
  CAPS,
  HORIZON_BUCKETS,
  RETIREMENT,
} from './assumptions/v2026-08.ts';
import { CATALOGUE, selectInstruments } from './products.ts';
import { bandRank } from './risk.ts';

export type AllocationContext = {
  profile: FinancialProfile;
  derived: DerivedFinancials;
  risk: RiskProfile;
  onOldRegime: boolean;
  eightyCGap: number;
};

/**
 * Asset-class weights for a bucket, after the risk-band ceiling, the user's
 * avoid list, the crypto opt-in gate, and renormalisation.
 */
export function assetClassWeights(
  bucket: HorizonBucket,
  ctx: AllocationContext,
): Record<AssetClass, number> {
  const base = { ...BASE_ALLOCATION[bucket] };
  const { risk, profile } = ctx;

  /* 1. Equity ceiling from the risk band. Overflow goes to debt. */
  if (base.equity > risk.equityCeiling) {
    const overflow = base.equity - risk.equityCeiling;
    base.equity = risk.equityCeiling;
    base.debt += overflow;
  }

  /* 2. Crypto — opt-in AND risk band gate (Decision 4). */
  if (
    profile.preferences.cryptoOptIn &&
    bandRank(risk.band) >= bandRank(CAPS.cryptoMinRiskBand as RiskBand) &&
    bucket === 'long' &&
    !profile.preferences.avoidTypes.includes('crypto')
  ) {
    const cryptoShare = Math.min(
      CAPS.cryptoMax,
      // Never fund speculation out of the goal's required core.
      Math.max(0, base.equity - 0.4) * 0.15,
    );
    if (cryptoShare > 0.005) {
      base.crypto = cryptoShare;
      base.equity -= cryptoShare;
    }
  }

  /* 3. Real assets only in the long bucket, capped. */
  base.real_assets = bucket === 'long' ? Math.min(base.real_assets, CAPS.realAssetsMax) : 0;

  /* 4. Gold band. */
  base.gold = Math.min(Math.max(base.gold, bucket === 'short' ? 0 : CAPS.goldMin), CAPS.goldMax);

  /* 5. Honour the user's hard avoid list — redistribute to debt. */
  for (const avoided of profile.preferences.avoidTypes) {
    if (base[avoided] > 0 && avoided !== 'debt') {
      base.debt += base[avoided];
      base[avoided] = 0;
    }
  }

  /* 6. Renormalise. */
  const total = (Object.values(base) as number[]).reduce((a, b) => a + b, 0);
  if (total > 0) {
    (Object.keys(base) as AssetClass[]).forEach((k) => {
      base[k] = base[k] / total;
    });
  }

  return base;
}

/* ------------------------------------------------------------------ */
/* Retirement — allocation across a spending stream, not a single date  */
/* ------------------------------------------------------------------ */

export type Tranche = {
  label: string;
  weight: number;
  effectiveHorizonYears: number;
  bucket: HorizonBucket;
  /** The money spent earliest in retirement, de-risked for sequence risk. */
  isNearTranche: boolean;
};

/**
 * Carve the retirement corpus by WHEN each rupee is spent.
 *
 * The effective horizon for a tranche is years-to-retirement plus years from
 * the retirement date until that money is drawn. Modelling the retirement date
 * itself as the horizon is what put a 57-year-old's entire corpus into
 * short-duration debt — money he will not touch until he is 75.
 */
export function retirementTranches(
  yearsToRetirement: number,
  retirementAge: number,
): Tranche[] {
  const duration = Math.max(1, RETIREMENT.planToAge - retirementAge);

  return RETIREMENT.tranches
    .map((t) => {
      const to = Math.min(t.toYear, duration);
      const from = Math.min(t.fromYear, duration);
      const width = Math.max(0, to - from);
      const midpoint = from + width / 2;
      return {
        label: t.label,
        weight: width / duration,
        effectiveHorizonYears: Math.round((yearsToRetirement + midpoint) * 10) / 10,
        bucket: bucketForYears(yearsToRetirement + midpoint),
        isNearTranche: t.fromYear === 0,
      };
    })
    .filter((t) => t.weight > 0.001);
}

function bucketForYears(years: number): HorizonBucket {
  if (years <= HORIZON_BUCKETS.shortMaxYears) return 'short';
  if (years <= HORIZON_BUCKETS.mediumMaxYears) return 'medium';
  return 'long';
}

/** Asset-class weights for a retirement goal: tranche-weighted blend. */
export function retirementWeights(
  tranches: Tranche[],
  ctx: AllocationContext,
): Record<AssetClass, number> {
  const blended: Record<AssetClass, number> = {
    equity: 0,
    debt: 0,
    gold: 0,
    real_assets: 0,
    crypto: 0,
  };

  for (const t of tranches) {
    const w = assetClassWeights(t.bucket, ctx);
    // Sequence-of-returns risk: the money being spent in the first years of
    // retirement is de-risked beyond what its horizon alone would imply,
    // because a crash while you are drawing down does damage that does not
    // recover.
    if (t.isNearTranche) {
      const excess = Math.max(0, w.equity - RETIREMENT.nearTrancheEquityCap);
      w.equity -= excess;
      w.debt += excess;
    }
    for (const k of Object.keys(blended) as AssetClass[]) blended[k] += w[k] * t.weight;
  }

  const total = (Object.values(blended) as number[]).reduce((a, b) => a + b, 0);
  if (total > 0) for (const k of Object.keys(blended) as AssetClass[]) blended[k] /= total;
  return blended;
}

/** Expand an explicit weight vector into instrument slices. */
export function buildAllocationFromWeights(
  weights: Record<AssetClass, number>,
  instrumentBucket: HorizonBucket,
  monthlyAmount: number,
  goalLockInMonths: number,
  ctx: AllocationContext,
): AllocationSlice[] {
  const band = ctx.risk.band;
  const caps = {
    midCapShare: CAPS.midCapShareOfEquity[band],
    smallCapShare: CAPS.smallCapShareOfEquity[band],
    internationalShare: CAPS.internationalShareOfEquity,
  };

  const slices: AllocationSlice[] = [];

  for (const assetClass of Object.keys(weights) as AssetClass[]) {
    const w = weights[assetClass];
    if (w <= 0.001) continue;

    const splits = selectInstruments(
      assetClass,
      instrumentBucket,
      band,
      ctx.profile,
      ctx.derived,
      caps,
      goalLockInMonths,
      ctx.onOldRegime,
      ctx.eightyCGap,
    );

    for (const s of splits) {
      const instrument = CATALOGUE[s.instrumentId];
      if (!instrument) continue;
      const percent = w * s.share;
      if (percent <= 0.001) continue;
      slices.push({
        assetClass,
        sleeve: instrument.sleeve,
        percent: Math.round(percent * 10000) / 10000,
        monthlyAmount: Math.round(monthlyAmount * percent),
        instrument,
        rationale: s.rationale,
      });
    }
  }

  return slices.sort((a, b) => b.percent - a.percent);
}

/** Blended expected return implied by a weight vector. */
export function blendedReturn(weights: Record<AssetClass, number>): number {
  return (Object.keys(weights) as AssetClass[]).reduce(
    (acc, k) => acc + weights[k] * ASSET_CLASS_RETURN[k],
    0,
  );
}

/**
 * Expand asset-class weights into concrete instrument-category slices.
 */
export function buildAllocation(
  bucket: HorizonBucket,
  monthlyAmount: number,
  goalLockInMonths: number,
  ctx: AllocationContext,
): AllocationSlice[] {
  const weights = assetClassWeights(bucket, ctx);
  const band = ctx.risk.band;

  const caps = {
    midCapShare: CAPS.midCapShareOfEquity[band],
    smallCapShare: CAPS.smallCapShareOfEquity[band],
    internationalShare: CAPS.internationalShareOfEquity,
  };

  const slices: AllocationSlice[] = [];

  for (const assetClass of Object.keys(weights) as AssetClass[]) {
    const w = weights[assetClass];
    if (w <= 0.001) continue;

    const splits = selectInstruments(
      assetClass,
      bucket,
      band,
      ctx.profile,
      ctx.derived,
      caps,
      goalLockInMonths,
      ctx.onOldRegime,
      ctx.eightyCGap,
    );

    for (const s of splits) {
      const instrument = CATALOGUE[s.instrumentId];
      if (!instrument) continue;
      const percent = w * s.share;
      if (percent <= 0.001) continue;
      slices.push({
        assetClass,
        sleeve: instrument.sleeve,
        percent: Math.round(percent * 10000) / 10000,
        monthlyAmount: Math.round(monthlyAmount * percent),
        instrument,
        rationale: s.rationale,
      });
    }
  }

  // Largest first — the top three lines are what the user will actually read.
  return slices.sort((a, b) => b.percent - a.percent);
}

/** Merge per-goal slices into one portfolio-level view. */
export function aggregateAllocation(all: AllocationSlice[]): AllocationSlice[] {
  const byInstrument = new Map<string, AllocationSlice>();
  const totalMonthly = all.reduce((a, s) => a + s.monthlyAmount, 0);

  for (const s of all) {
    const existing = byInstrument.get(s.instrument.id);
    if (existing) {
      existing.monthlyAmount += s.monthlyAmount;
    } else {
      byInstrument.set(s.instrument.id, { ...s });
    }
  }

  const merged = [...byInstrument.values()];
  for (const m of merged) {
    m.percent = totalMonthly > 0 ? Math.round((m.monthlyAmount / totalMonthly) * 10000) / 10000 : 0;
  }
  return merged.sort((a, b) => b.monthlyAmount - a.monthlyAmount);
}
