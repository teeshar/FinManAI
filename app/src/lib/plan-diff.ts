/**
 * What changed between two plans, and why.
 *
 * Phase 6 calls this the most valuable screen in the product once a client has
 * three plans, and the reason is worth stating: a single plan is a document,
 * but two plans side by side are the plan *responding to their life*. Someone
 * who sees their retirement gap close by ₹4 lakh because they took the pay rise
 * seriously has learned something no static report teaches.
 *
 * Three rules shape what this produces:
 *
 *   1. **Attribute the change.** "Your SIP went up ₹3,000" is a fact. "Your SIP
 *      went up ₹3,000 because your income rose and the surplus followed it" is
 *      the advice. Where the cause is knowable — a new profile version, a new
 *      assumptions version, a different advisory mode — it is named.
 *   2. **Suppress noise.** A ₹40 move in a ₹90,000 figure is arithmetic, not
 *      news. Every numeric comparison carries a materiality floor.
 *   3. **Direction is not sentiment.** A larger required SIP is not "worse" —
 *      it may be a bigger goal, deliberately chosen. This module reports
 *      direction and leaves the judgement to the prose beside it.
 *
 * Pure: two plans in, a diff out. No I/O, so it is testable the way the engine
 * is testable.
 */

import type { RecommendationPlan } from '../../../engine/src/types.ts';

export type ChangeDirection = 'up' | 'down' | 'same';

export type FieldChange = {
  label: string;
  before: number;
  after: number;
  delta: number;
  direction: ChangeDirection;
  /** Rendering hint, so the view does not have to guess at a unit. */
  unit: 'inr' | 'percent' | 'months' | 'years' | 'count';
  /** Plain-language note. Empty when the number speaks for itself. */
  note?: string;
};

export type GoalChange = {
  goalId: string;
  name: string;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
  feasibilityBefore?: string;
  feasibilityAfter?: string;
  changes: FieldChange[];
};

export type ListChange = { added: string[]; removed: string[]; reordered: boolean };

export type PlanDiff = {
  /** Why these two plans differ at all, in the order a reader should hear it. */
  causes: string[];
  headline: string;
  cashflow: FieldChange[];
  protection: FieldChange[];
  risk: FieldChange[];
  riskBandChange: { before: string; after: string } | null;
  goals: GoalChange[];
  actions: ListChange;
  allocation: FieldChange[];
  /** True when neither plan may show allocation, so its absence is not a change. */
  allocationWithheld: boolean;
  stress: FieldChange[];
  unchanged: boolean;
};

/**
 * Below this a rupee difference is rounding, not a change worth a line on the
 * screen. ₹100/month is under a fiftieth of a typical plannable surplus and
 * well inside the noise floor of the inputs people give us.
 */
const MONEY_FLOOR = 100;
/** Half a percentage point. Allocation slices below this shift on rounding alone. */
const PERCENT_FLOOR = 0.005;

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

function change(
  label: string,
  before: number,
  after: number,
  unit: FieldChange['unit'],
  floor: number,
  note?: string,
): FieldChange | null {
  const delta = after - before;
  if (Math.abs(delta) < floor) return null;
  return {
    label,
    before,
    after,
    delta,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same',
    unit,
    note,
  };
}

const compact = (xs: (FieldChange | null)[]): FieldChange[] => xs.filter((x): x is FieldChange => x !== null);

/**
 * Why do these two plans differ?
 *
 * Ordered by how much it should change the reader's reaction. "You told us
 * something new" is a different event from "the tax rules changed" is a
 * different event from "we are now allowed to show you more", and conflating
 * them produces the sentence every client mistrusts: *your plan has been
 * updated*, with no reason attached.
 */
function attributeCauses(
  before: RecommendationPlan,
  after: RecommendationPlan,
  meta: DiffMeta,
): string[] {
  const causes: string[] = [];

  if (meta.profileVersionBefore !== meta.profileVersionAfter) {
    causes.push(
      `You updated your profile — this compares version ${meta.profileVersionBefore} with version ${meta.profileVersionAfter}.`,
    );
  }
  if (before.assumptionsVersion !== after.assumptionsVersion) {
    causes.push(
      `The rates and rules changed. The earlier plan used the ${before.assumptionsVersion} assumptions; this one uses ${after.assumptionsVersion}. ` +
        `Tax slabs, small-savings rates and inflation assumptions all live in that dated set, so figures can move without you changing anything.`,
    );
  }
  if (before.engineVersion !== after.engineVersion) {
    causes.push(
      `The planning engine changed from ${before.engineVersion} to ${after.engineVersion}.`,
    );
  }
  if (before.advisoryMode !== after.advisoryMode) {
    causes.push(
      after.advisoryMode === 'advisory'
        ? 'We are now able to show investment recommendations, so this plan includes an allocation the earlier one withheld.'
        : 'This plan is diagnostic only, so the allocation shown in the earlier plan is withheld here.',
    );
  }
  if (causes.length === 0) {
    causes.push(
      'Nothing in your profile or in our assumptions changed between these two plans — they were generated from the same inputs.',
    );
  }
  return causes;
}

/**
 * The two verdicts that mean "this goal fits". Everything else needs a decision
 * from the household, which is exactly the transition worth a headline.
 */
const COMFORTABLE = new Set(['on_track', 'achievable']);

function headlineFor(cashflow: FieldChange[], goals: GoalChange[], riskBand: PlanDiff['riskBandChange']): string {
  const surplus = cashflow.find((c) => c.label === 'Free to invest');
  const newlyPossible = goals.filter(
    (g) => g.feasibilityBefore && g.feasibilityAfter &&
      !COMFORTABLE.has(g.feasibilityBefore) && COMFORTABLE.has(g.feasibilityAfter),
  );
  const newlyStrained = goals.filter(
    (g) => g.feasibilityBefore && g.feasibilityAfter &&
      COMFORTABLE.has(g.feasibilityBefore) && !COMFORTABLE.has(g.feasibilityAfter),
  );

  const parts: string[] = [];
  if (surplus) {
    parts.push(
      surplus.direction === 'up'
        ? `You have ${inr(Math.abs(surplus.delta))} a month more to work with.`
        : `You have ${inr(Math.abs(surplus.delta))} a month less to work with.`,
    );
  }
  if (newlyPossible.length > 0) {
    parts.push(
      `${newlyPossible.map((g) => g.name).join(', ')} ${newlyPossible.length === 1 ? 'is' : 'are'} now within reach.`,
    );
  }
  if (newlyStrained.length > 0) {
    parts.push(
      `${newlyStrained.map((g) => g.name).join(', ')} no longer fits on the current plan and needs a decision.`,
    );
  }
  if (riskBand) {
    parts.push(`Your risk profile moved from ${riskBand.before} to ${riskBand.after}.`);
  }
  if (parts.length === 0) return 'The headline figures are unchanged between these two plans.';
  return parts.join(' ');
}

export type DiffMeta = {
  profileVersionBefore: number;
  profileVersionAfter: number;
};

export function diffPlans(
  before: RecommendationPlan,
  after: RecommendationPlan,
  meta: DiffMeta,
): PlanDiff {
  const b = before.derived;
  const a = after.derived;

  const cashflow = compact([
    change('Monthly income', b.plannableMonthlyIncome, a.plannableMonthlyIncome, 'inr', MONEY_FLOOR),
    change('Total spending', b.totalMonthlyExpenses, a.totalMonthlyExpenses, 'inr', MONEY_FLOOR),
    change('EMIs', b.totalMonthlyEMI, a.totalMonthlyEMI, 'inr', MONEY_FLOOR),
    change('Free to invest', b.investableSurplus, a.investableSurplus, 'inr', MONEY_FLOOR),
    change('Net worth', b.netWorth, a.netWorth, 'inr', MONEY_FLOOR),
    change('High-cost debt', b.highCostDebt, a.highCostDebt, 'inr', MONEY_FLOOR,
      a.highCostDebt === 0 && b.highCostDebt > 0 ? 'Cleared. This is the single most valuable thing on the list.' : undefined),
  ]);

  const protection = compact([
    change('Emergency fund', b.emergencyFundCurrent, a.emergencyFundCurrent, 'inr', MONEY_FLOOR),
    change('Months of cover', b.emergencyFundMonthsCovered, a.emergencyFundMonthsCovered, 'months', 0.2),
    change('Life cover gap', b.termCoverGap, a.termCoverGap, 'inr', MONEY_FLOOR,
      a.termCoverGap === 0 && b.termCoverGap > 0 ? 'Closed. Your dependants are covered.' : undefined),
    change('Health cover gap', b.healthCoverGap, a.healthCoverGap, 'inr', MONEY_FLOOR),
  ]);

  const risk = compact([
    change('Capacity score', before.riskProfile.capacityScore, after.riskProfile.capacityScore, 'count', 1),
    change('Tolerance score', before.riskProfile.toleranceScore, after.riskProfile.toleranceScore, 'count', 1),
    change('Equity ceiling', before.riskProfile.equityCeiling, after.riskProfile.equityCeiling, 'percent', PERCENT_FLOOR),
  ]);

  const riskBandChange =
    before.riskProfile.band !== after.riskProfile.band
      ? { before: before.riskProfile.band, after: after.riskProfile.band }
      : null;

  /* Goals — matched on goalId, so a renamed goal is still the same goal. */
  const goalsBefore = new Map(before.goalPlans.map((g) => [g.goalId, g]));
  const goalsAfter = new Map(after.goalPlans.map((g) => [g.goalId, g]));
  const goals: GoalChange[] = [];

  for (const [id, g] of goalsAfter) {
    const prior = goalsBefore.get(id);
    if (!prior) {
      goals.push({ goalId: id, name: g.name, status: 'added', feasibilityAfter: g.feasibility, changes: [] });
      continue;
    }
    const changes = compact([
      change('Cost by then', prior.futureCost, g.futureCost, 'inr', MONEY_FLOOR),
      change('Shortfall', prior.gap, g.gap, 'inr', MONEY_FLOOR),
      change('Monthly contribution needed', prior.requiredMonthlySIP, g.requiredMonthlySIP, 'inr', MONEY_FLOOR),
      change('Years away', prior.yearsToTarget, g.yearsToTarget, 'years', 0.5),
    ]);
    const feasibilityMoved = prior.feasibility !== g.feasibility;
    goals.push({
      goalId: id,
      name: g.name,
      status: changes.length > 0 || feasibilityMoved ? 'changed' : 'unchanged',
      feasibilityBefore: prior.feasibility,
      feasibilityAfter: g.feasibility,
      changes,
    });
  }
  for (const [id, g] of goalsBefore) {
    if (!goalsAfter.has(id)) {
      goals.push({ goalId: id, name: g.name, status: 'removed', feasibilityBefore: g.feasibility, changes: [] });
    }
  }

  /* Actions — the sequencing IS the advice, so a reorder is itself news. */
  const titlesBefore = before.actionPlan.map((x) => x.title);
  const titlesAfter = after.actionPlan.map((x) => x.title);
  const actions: ListChange = {
    added: titlesAfter.filter((t) => !titlesBefore.includes(t)),
    removed: titlesBefore.filter((t) => !titlesAfter.includes(t)),
    reordered:
      titlesBefore.filter((t) => titlesAfter.includes(t)).join('|') !==
      titlesAfter.filter((t) => titlesBefore.includes(t)).join('|'),
  };

  /*
   * Allocation. When either plan was diagnostic-only its allocation table was
   * never shown, so reporting it as "removed" would present a regulatory gate
   * as a change in advice. Flag it instead and let the view say so.
   */
  const allocationWithheld =
    before.advisoryMode !== 'advisory' || after.advisoryMode !== 'advisory';

  const allocBefore = new Map(before.aggregateAllocation.map((s) => [s.instrument.id, s]));
  const allocAfter = new Map(after.aggregateAllocation.map((s) => [s.instrument.id, s]));
  const allocation: FieldChange[] = allocationWithheld
    ? []
    : compact(
        [...new Set([...allocBefore.keys(), ...allocAfter.keys()])].map((id) => {
          const x = allocAfter.get(id);
          const y = allocBefore.get(id);
          return change(
            (x ?? y)!.instrument.label,
            y?.percent ?? 0,
            x?.percent ?? 0,
            'percent',
            PERCENT_FLOOR,
            !y ? 'New in this plan.' : !x ? 'No longer recommended.' : undefined,
          );
        }),
      );

  /* Stress — matched on key so a reworded title does not read as a new test. */
  const stressBefore = new Map(before.stressTests.map((t) => [t.key, t]));
  const stress = compact(
    after.stressTests.map((t) => {
      const prior = stressBefore.get(t.key);
      if (!prior) return null;
      return change(t.title, prior.survivesMonths ?? 0, t.survivesMonths ?? 0, 'months', 0.2);
    }),
  );

  const causes = attributeCauses(before, after, meta);
  const headline = headlineFor(cashflow, goals, riskBandChange);

  return {
    causes,
    headline,
    cashflow,
    protection,
    risk,
    riskBandChange,
    goals,
    actions,
    allocation,
    allocationWithheld,
    stress,
    unchanged:
      cashflow.length === 0 && protection.length === 0 && risk.length === 0 &&
      riskBandChange === null && allocation.length === 0 && stress.length === 0 &&
      goals.every((g) => g.status === 'unchanged') &&
      actions.added.length === 0 && actions.removed.length === 0 && !actions.reordered,
  };
}
