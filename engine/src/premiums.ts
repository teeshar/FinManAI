/**
 * Insurance premium estimates.
 *
 * These replace the placeholder formulas that previously lived in three
 * separate files. Every figure below traces to published Indian market rates
 * for 2026 rather than to a shape that felt about right — because these numbers
 * are subtracted from a household's surplus before anything is invested, so
 * getting them wrong distorts the whole plan.
 *
 * Sources (recorded here so they can be re-checked when they age):
 *   - Term: ₹1 crore cover to age 60, non-smoker, published premium tables 2026
 *   - Health: ₹10 lakh cover, tier-1 city, indicative retail premiums 2026
 *   - Super top-up: ₹50L cover with a ₹10L deductible, ₹3,000–4,000 a year
 *
 * These are ESTIMATES for planning. Every output that uses them says so, and
 * tells the reader to get an actual quote before acting.
 */

export const PREMIUM_SOURCE_DATE = '2026-08';

/* ------------------------------------------------------------------ */
/* Term life                                                           */
/* ------------------------------------------------------------------ */

/** Annual premium for ₹1 crore of cover to age 60, non-smoker. */
const TERM_ANNUAL_PER_CRORE: { age: number; male: number; female: number }[] = [
  { age: 25, male: 7_100, female: 5_500 },
  { age: 30, male: 9_500, female: 7_200 },
  { age: 35, male: 13_500, female: 10_200 },
  { age: 40, male: 20_500, female: 15_500 },
  { age: 45, male: 32_000, female: 24_500 },
  { age: 50, male: 52_000, female: 40_000 },
];

export const TERM_LOADING = {
  /** Published range is 40–60%. We take the middle. */
  smoker: 0.50,
  /**
   * Cover does not price linearly: a ₹50L policy costs about ₹1,160 per lakh
   * while ₹1 crore costs about ₹950 per lakh. Small covers are proportionally
   * dearer, which is itself an argument for buying enough.
   */
  smallCoverUplift: 1.22,
  smallCoverThreshold: 7_500_000,
  /** Above age 50 the published table runs out; premiums accelerate sharply. */
  perYearAbove50: 0.09,
} as const;

export type PersonForPremium = {
  age: number;
  gender?: 'male' | 'female' | 'other';
  smoker?: boolean;
};

function interpolate(
  table: { age: number; male: number; female: number }[],
  age: number,
  key: 'male' | 'female',
): number {
  const first = table[0];
  const last = table[table.length - 1];

  if (age <= first.age) return first[key];

  if (age >= last.age) {
    // Extrapolate beyond the published table, compounding rather than linear —
    // mortality cost rises faster than proportionally at older ages.
    return last[key] * Math.pow(1 + TERM_LOADING.perYearAbove50, age - last.age);
  }

  for (let i = 0; i < table.length - 1; i++) {
    const lo = table[i];
    const hi = table[i + 1];
    if (age >= lo.age && age <= hi.age) {
      const t = (age - lo.age) / (hi.age - lo.age);
      return lo[key] + (hi[key] - lo[key]) * t;
    }
  }
  return last[key];
}

/**
 * Monthly premium for a given amount of term cover.
 *
 * Where gender is not recorded we use the male table, which is the dearer of
 * the two — a plan should not under-provision for a cost the household will
 * actually face.
 */
export function termPremiumMonthly(cover: number, person: PersonForPremium): number {
  if (cover <= 0) return 0;

  const key = person.gender === 'female' ? 'female' : 'male';
  const annualPerCrore = interpolate(TERM_ANNUAL_PER_CRORE, person.age, key);

  let annual = (cover / 10_000_000) * annualPerCrore;
  if (cover < TERM_LOADING.smallCoverThreshold) annual *= TERM_LOADING.smallCoverUplift;
  if (person.smoker) annual *= 1 + TERM_LOADING.smoker;

  return Math.round(annual / 12);
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

/** Annual premium for ₹10 lakh individual cover, tier-1 city. */
const HEALTH_ANNUAL_PER_10L: { age: number; premium: number }[] = [
  { age: 25, premium: 8_500 },
  { age: 30, premium: 11_000 },
  { age: 35, premium: 13_000 },
  { age: 40, premium: 16_000 },
  { age: 45, premium: 21_000 },
  { age: 50, premium: 28_000 },
  { age: 55, premium: 36_000 },
  { age: 60, premium: 48_000 },
  { age: 65, premium: 62_000 },
];

export const HEALTH_ADJUSTMENT = {
  /** Metro rates are the published baseline; smaller cities cost less. */
  cityTier: { metro: 1.0, tier2: 0.85, tier3: 0.75 },
  /**
   * A floater is far cheaper than separate policies — published figures show
   * three individual ₹10L policies at ₹22–28k against a ₹10L floater at
   * ₹12–16k. Multipliers apply to the ELDEST adult's individual premium,
   * because that is what actually drives floater pricing.
   */
  floater: { twoAdults: 1.3, plusOneChild: 1.4, plusTwoOrMoreChildren: 1.5 },
  /**
   * Cover does not price linearly either: doubling the sum insured costs far
   * less than double, which is why a base policy plus a super top-up beats a
   * single large base policy.
   */
  coverExponent: 0.6,
  perYearAbove65: 0.08,
} as const;

/** ₹50L of super top-up above a ₹10L deductible, per year. */
export const SUPER_TOPUP = {
  cover: 5_000_000,
  deductible: 1_000_000,
  annualPremium: 3_500,
} as const;

function healthBaseAnnual(age: number): number {
  const first = HEALTH_ANNUAL_PER_10L[0];
  const last = HEALTH_ANNUAL_PER_10L[HEALTH_ANNUAL_PER_10L.length - 1];

  if (age <= first.age) return first.premium;
  if (age >= last.age) {
    return last.premium * Math.pow(1 + HEALTH_ADJUSTMENT.perYearAbove65, age - last.age);
  }

  for (let i = 0; i < HEALTH_ANNUAL_PER_10L.length - 1; i++) {
    const lo = HEALTH_ANNUAL_PER_10L[i];
    const hi = HEALTH_ANNUAL_PER_10L[i + 1];
    if (age >= lo.age && age <= hi.age) {
      const t = (age - lo.age) / (hi.age - lo.age);
      return lo.premium + (hi.premium - lo.premium) * t;
    }
  }
  return last.premium;
}

export type HealthPremiumInput = {
  cover: number;
  eldestAdultAge: number;
  cityTier: 'metro' | 'tier2' | 'tier3';
  adults: number;
  children: number;
};

export function healthPremiumMonthly(input: HealthPremiumInput): number {
  if (input.cover <= 0) return 0;

  let annual = healthBaseAnnual(input.eldestAdultAge);

  // Sub-linear scaling with sum insured.
  annual *= Math.pow(input.cover / 1_000_000, HEALTH_ADJUSTMENT.coverExponent);

  annual *= HEALTH_ADJUSTMENT.cityTier[input.cityTier];

  if (input.adults >= 2) {
    annual *=
      input.children >= 2
        ? HEALTH_ADJUSTMENT.floater.plusTwoOrMoreChildren
        : input.children === 1
          ? HEALTH_ADJUSTMENT.floater.plusOneChild
          : HEALTH_ADJUSTMENT.floater.twoAdults;
  } else if (input.children >= 1) {
    annual *= HEALTH_ADJUSTMENT.floater.twoAdults;
  }

  return Math.round(annual / 12);
}

/**
 * Parents are almost always cheaper covered on a SEPARATE policy than added to
 * a family floater, because a floater prices off the eldest member — adding a
 * 65-year-old parent re-prices cover for the whole family at their age.
 */
export function parentHealthPremiumMonthly(cover: number, eldestParentAge: number): number {
  return healthPremiumMonthly({
    cover,
    eldestAdultAge: eldestParentAge,
    cityTier: 'metro',
    adults: 1,
    children: 0,
  });
}

/**
 * The disclosure that must accompany every premium figure we produce.
 * These are planning estimates, not quotes, and the difference matters.
 */
export const PREMIUM_DISCLAIMER =
  `Premium figures are planning estimates based on published Indian market rates as at ${PREMIUM_SOURCE_DATE}. ` +
  `Your actual premium depends on your age at purchase, medical history, occupation, smoking status and the insurer. ` +
  `Get a real quote before you act on these numbers — they will move, and for term cover they only ever move upwards with age.`;
