/**
 * A first guess at what a household spends.
 *
 * This exists to change the question the Spending step asks. "What do you spend
 * on groceries?" is a recall task, and people are bad at it — the step's own
 * intro says most households underestimate by 20-30%. "Is ₹14,000 about right?"
 * is a recognition task, which is both easier and more accurate, because a
 * number you disagree with is a number you correct.
 *
 * ── What this is not ──────────────────────────────────────────────────
 *
 * These are **proportional heuristics, not survey data.** They are shares of
 * take-home pay adjusted for city tier and household size, of the kind a
 * planner would sketch on paper before seeing a bank statement. They are NOT
 * drawn from the MoSPI Household Consumption Expenditure Survey or any other
 * published source, and they are not accurate for any individual household.
 *
 * That is why they live in `app/` and not in `engine/src/assumptions/`. Nothing
 * here reaches a plan calculation. An assumption is a figure a recommendation
 * depends on; this is a prompt to help someone remember their own life. If
 * these numbers were ever wired into the engine they would need real
 * provenance, a version stamp and a golden-file review, exactly like the tax
 * slabs and the premium tables do.
 *
 * ── Why the guess must never become the answer ────────────────────────
 *
 * Suitability rests on client-provided information. A figure the client merely
 * failed to disagree with is not client-provided, and a `suitabilityRationale`
 * that cites one is citing us back to ourselves. So every estimate carries
 * provenance, and the interface is built so that accepting one is a deliberate
 * act rather than the path of least resistance.
 *
 * Reviewed: 2026-08. Re-check when the step's completion rate is measured —
 * a baseline that is systematically low is worse than an empty box, because it
 * anchors people downward and an overstated surplus produces a plan nobody can
 * follow.
 */

export type CityTier = 'metro' | 'tier2' | 'tier3';

export type SpendingBasis = {
  monthlyTakeHome: number;
  cityTier: CityTier;
  familyMembers: number;
  dependentMembers: number;
};

/** The provenance of a single figure. Order matters: later beats earlier. */
export type Provenance = 'estimated' | 'accepted' | 'entered';

export type ExpenseKey =
  | 'rentOrHome'
  | 'foodAndGroceries'
  | 'utilities'
  | 'transportation'
  | 'education'
  | 'healthcare'
  | 'insurancePremiums'
  | 'lifestyleAndEntertainment'
  | 'subscriptions'
  | 'dependentRelated'
  | 'otherRecurring'
  | 'annualIrregular';

/**
 * Share of take-home pay, before adjustments.
 *
 * `loadBearing` marks the categories large enough that a wrong one moves the
 * whole plan. Those cannot be accepted in bulk — see `BULK_ACCEPTABLE` below.
 */
type Category = {
  key: ExpenseKey;
  share: number;
  /** Scales with people in the household rather than with income. */
  perHead?: boolean;
  /** Rent is where city tier bites hardest. */
  tierSensitive?: boolean;
  loadBearing?: boolean;
};

const CATEGORIES: Category[] = [
  { key: 'rentOrHome', share: 0.26, tierSensitive: true, loadBearing: true },
  { key: 'foodAndGroceries', share: 0.16, perHead: true, loadBearing: true },
  { key: 'utilities', share: 0.045, perHead: true },
  { key: 'transportation', share: 0.07 },
  { key: 'lifestyleAndEntertainment', share: 0.075 },
  { key: 'healthcare', share: 0.02, perHead: true },
  { key: 'insurancePremiums', share: 0.025 },
  { key: 'subscriptions', share: 0.012 },
  { key: 'otherRecurring', share: 0.03 },
];

/**
 * Tier multiplier on rent.
 *
 * Housing is the category where a metro and a tier-3 town genuinely differ by a
 * factor rather than a few percent; food and utilities differ far less, so they
 * are left flat rather than given a fake precision.
 */
const RENT_TIER: Record<CityTier, number> = { metro: 1, tier2: 0.62, tier3: 0.42 };

/**
 * Higher earners spend a smaller share of income. A flat percentage model puts
 * an implausible ₹1.2 lakh of groceries in front of somebody on ₹6 lakh a month
 * and destroys the credibility of every other row on the screen.
 */
function incomeDamping(monthlyTakeHome: number): number {
  if (monthlyTakeHome <= 40_000) return 1.12;
  if (monthlyTakeHome <= 80_000) return 1;
  if (monthlyTakeHome <= 150_000) return 0.88;
  if (monthlyTakeHome <= 300_000) return 0.74;
  return 0.6;
}

/** Round to something a person would actually say out loud. */
function humanRound(n: number): number {
  if (n <= 0) return 0;
  if (n < 1_000) return Math.round(n / 100) * 100;
  if (n < 20_000) return Math.round(n / 500) * 500;
  return Math.round(n / 1_000) * 1_000;
}

/**
 * Categories that may be confirmed together in one deliberate act.
 *
 * Rent and food are excluded: between them they are roughly 40% of a household's
 * outgoings, and a plan built on an unexamined guess at either is not built on
 * the client's information in any meaningful sense. Education and family support
 * are excluded for a different reason — they are zero for most households and
 * large for some, so a default of zero is a fact about the model rather than
 * about the person, and it has to be asserted rather than assumed.
 */
export const BULK_ACCEPTABLE: ExpenseKey[] = CATEGORIES.filter(
  (c) => !c.loadBearing,
).map((c) => c.key);

export type Estimate = { key: ExpenseKey; amount: number };

/**
 * The opening sketch. Categories with no defensible default are left at zero
 * and asked for plainly rather than guessed at.
 */
export function estimateSpending(basis: SpendingBasis): Record<ExpenseKey, number> {
  const { monthlyTakeHome, cityTier, familyMembers } = basis;
  const damp = incomeDamping(monthlyTakeHome);

  // Per-head categories scale sublinearly: a household of four does not eat
  // four times what one person eats.
  const headScale = 1 + 0.28 * Math.max(0, familyMembers - 1);

  const out = {} as Record<ExpenseKey, number>;
  for (const c of CATEGORIES) {
    let amount = monthlyTakeHome * c.share * damp;
    if (c.tierSensitive) amount *= RENT_TIER[cityTier];
    if (c.perHead) amount *= headScale;
    out[c.key] = humanRound(amount);
  }

  // Zero by default, and asked for rather than guessed:
  //   education      — nil unless there are children in school
  //   dependentRelated — a personal arrangement, not a function of income
  out.education = 0;
  out.dependentRelated = 0;

  // Irregular spending is annual, and roughly a month of the monthly total.
  const monthlyTotal = Object.entries(out)
    .filter(([k]) => k !== 'annualIrregular')
    .reduce((sum, [, v]) => sum + v, 0);
  out.annualIrregular = humanRound(monthlyTotal * 1.1);

  return out;
}

/** Categories whose estimate is load-bearing enough to need explicit attention. */
export const LOAD_BEARING: ExpenseKey[] = CATEGORIES.filter((c) => c.loadBearing).map(
  (c) => c.key,
);

/**
 * Can a basis be formed at all? Someone who jumped straight to step 3 by URL,
 * or who is editing an old profile whose earlier steps are not in the draft,
 * gets the plain form instead of a portrait built on nothing.
 */
export function readBasis(draft: Record<number, unknown>): SpendingBasis | null {
  const one = draft[1] as { personal?: Record<string, unknown> } | undefined;
  const two = draft[2] as { income?: Record<string, unknown> } | undefined;

  const p = one?.personal;
  const takeHome = two?.income?.monthlyTakeHome;

  if (!p || typeof takeHome !== 'number' || takeHome <= 0) return null;
  if (typeof p.cityTier !== 'string' || typeof p.familyMembers !== 'number') return null;

  return {
    monthlyTakeHome: takeHome,
    cityTier: p.cityTier as CityTier,
    familyMembers: p.familyMembers,
    dependentMembers: typeof p.dependentMembers === 'number' ? p.dependentMembers : 0,
  };
}
