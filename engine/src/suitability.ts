/**
 * Stage 8 — Suitability & constraint filter.
 *
 * The last deterministic gate before anything is shown to a user. Every
 * surviving recommendation carries a written rationale referencing the exact
 * profile inputs that justified it — that string IS the SEBI suitability record.
 */

import type {
  AllocationSlice,
  DerivedFinancials,
  FinancialProfile,
  GoalPlan,
  RiskProfile,
  SuitabilityRecord,
} from './types.ts';
import { CAPS, WATERFALL } from './assumptions/v2026-08.ts';
import { CATALOGUE } from './products.ts';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const pct = (n: number) => (n * 100).toFixed(1) + '%';

export type SuitabilityResult = {
  goalPlans: GoalPlan[];
  records: SuitabilityRecord[];
  warnings: string[];
};

export function applySuitability(
  profile: FinancialProfile,
  derived: DerivedFinancials,
  risk: RiskProfile,
  goalPlans: GoalPlan[],
): SuitabilityResult {
  const records: SuitabilityRecord[] = [];
  const warnings: string[] = [];

  /* ---- Profile-level records (written once per plan) ---- */

  records.push({
    subject: 'Risk profile determination',
    verdict: 'passed',
    rationale:
      `Risk capacity scored ${risk.capacityScore}/100 from age (${profile.personal.age}, ${derived.yearsToRetirement} years to retirement), ` +
      `income stability (${profile.employment.employmentType}, ${profile.employment.jobStability}), ` +
      `savings rate (${pct(derived.plannableMonthlyIncome > 0 ? derived.investableSurplus / derived.plannableMonthlyIncome : 0)}), ` +
      `emergency cover (${derived.emergencyFundMonthsCovered.toFixed(1)} of ${derived.emergencyFundTargetMonths} months), ` +
      `dependants (${profile.dependents.length}) and EMI load (${pct(derived.plannableMonthlyIncome > 0 ? derived.totalMonthlyEMI / derived.plannableMonthlyIncome : 0)}). ` +
      `Risk tolerance scored ${risk.toleranceScore}/100 from the §11 questionnaire. ` +
      `The lower of the two (${risk.finalScore}) determines the band "${risk.band.replace(/_/g, ' ')}", capping equity at ${pct(risk.equityCeiling)}.`,
  });

  if (risk.divergenceFlag) {
    records.push({
      subject: 'Capacity / tolerance divergence',
      verdict: 'resized',
      rationale: risk.divergenceNote ?? 'Capacity and tolerance diverge; the lower value was applied.',
    });
  }

  /* ---- Per-goal, per-slice filtering ---- */

  const filtered: GoalPlan[] = goalPlans.map((plan) => {
    const kept: AllocationSlice[] = [];
    const monthsToGoal = Math.floor(plan.yearsToTarget * 12);

    for (const slice of plan.allocation) {
      /* 1. Hard avoid list */
      if (profile.preferences.avoidTypes.includes(slice.assetClass)) {
        records.push({
          subject: `${slice.instrument.label} for "${plan.name}"`,
          verdict: 'rejected',
          rationale: `You listed ${slice.assetClass.replace(/_/g, ' ')} on your avoid list. The allocation was redistributed to debt.`,
        });
        continue;
      }

      /* 2. Lock-in must not exceed the goal horizon */
      if (slice.instrument.lockInMonths > monthsToGoal && plan.category !== 'retirement') {
        records.push({
          subject: `${slice.instrument.label} for "${plan.name}"`,
          verdict: 'rejected',
          rationale:
            `${slice.instrument.label} locks money for ${slice.instrument.lockInMonths} months, but this goal matures in ${monthsToGoal} months. ` +
            `An instrument you cannot exit in time is unsuitable regardless of its return.`,
          });
        continue;
      }

      /* 3. Acceptable lock-in stated by the user (§12) */
      if (
        slice.instrument.lockInMonths > profile.liquidity.acceptableLockInMonths &&
        plan.category !== 'retirement'
      ) {
        records.push({
          subject: `${slice.instrument.label} for "${plan.name}"`,
          verdict: 'rejected',
          rationale: `You stated a maximum acceptable lock-in of ${profile.liquidity.acceptableLockInMonths} months; this instrument locks ${slice.instrument.lockInMonths}.`,
        });
        continue;
      }

      /* 4. Near-term goals may not hold equity or crypto */
      if (
        monthsToGoal <= WATERFALL.nearTermGoalMonths &&
        (slice.assetClass === 'equity' || slice.assetClass === 'crypto')
      ) {
        records.push({
          subject: `${slice.instrument.label} for "${plan.name}"`,
          verdict: 'rejected',
          rationale:
            `This goal is ${monthsToGoal} months away. Equity has historically fallen 30%+ and taken years to recover; money with a deadline inside two years cannot carry that risk. Reallocated to liquid instruments.`,
        });
        continue;
      }

      /* 5. Crypto gates */
      if (slice.assetClass === 'crypto') {
        if (!profile.preferences.cryptoOptIn) {
          records.push({
            subject: 'Crypto allocation',
            verdict: 'rejected',
            rationale: 'You did not opt in to crypto exposure.',
          });
          continue;
        }
        if (slice.percent > CAPS.cryptoMax) {
          records.push({
            subject: 'Crypto allocation',
            verdict: 'resized',
            rationale: `Reduced to the ${pct(CAPS.cryptoMax)} hard cap. Crypto sits outside SEBI regulation, gains are taxed at a flat 30%, and losses cannot be set off against anything.`,
          });
          slice.percent = CAPS.cryptoMax;
        } else {
          records.push({
            subject: 'Crypto allocation',
            verdict: 'passed',
            rationale: `You opted in and your risk band (${risk.band.replace(/_/g, ' ')}) permits a capped speculative sleeve. Sized at ${pct(slice.percent)}, modelled at a 0% expected return — treat it as money you can lose entirely.`,
          });
        }
      }

      /* 6. Eligibility rules */
      if (slice.instrument.id === 'sukanya') {
        const eligible = profile.dependents.some(
          (dep) => dep.relationship === 'child' && dep.gender === 'female' && dep.age < 10,
        );
        if (!eligible) {
          records.push({
            subject: 'Sukanya Samriddhi Yojana',
            verdict: 'rejected',
            rationale: 'Requires a girl child under 10 years old. Not applicable to this profile.',
          });
          continue;
        }
      }
      if (slice.instrument.id === 'scss' && profile.personal.age < 60) {
        records.push({
          subject: 'Senior Citizens Savings Scheme',
          verdict: 'rejected',
          rationale: `Requires age 60 or above; you are ${profile.personal.age}.`,
        });
        continue;
      }
      if (slice.instrument.id === 'vpf' && profile.employment.employmentType !== 'salaried') {
        records.push({
          subject: 'Voluntary Provident Fund',
          verdict: 'rejected',
          rationale: 'VPF requires an active EPF account, which applies to salaried employees only.',
        });
        continue;
      }
      if (slice.instrument.id === 'elss' && profile.tax.selectedRegime === 'new') {
        records.push({
          subject: 'ELSS',
          verdict: 'rejected',
          rationale: 'ELSS earns its 3-year lock-in through the 80C deduction, which does not exist on the new regime. A plain index fund does the same job with no lock-in.',
        });
        continue;
      }

      kept.push(slice);
    }

    /* Renormalise the surviving slices back to the goal's monthly amount. */
    const total = kept.reduce((a, s) => a + s.percent, 0);
    if (total > 0 && Math.abs(total - 1) > 0.001) {
      const goalMonthly = plan.allocation.reduce((a, s) => a + s.monthlyAmount, 0);
      for (const s of kept) {
        s.percent = Math.round((s.percent / total) * 10000) / 10000;
        s.monthlyAmount = Math.round(goalMonthly * s.percent);
      }
    }

    /* Equity ceiling ENFORCEMENT after filtering.
       Dropping an ineligible slice and renormalising can push equity back above
       the band ceiling — so we re-cap it here and move the excess into debt,
       rather than merely noting the breach. */
    let equityShare = kept.filter((s) => s.assetClass === 'equity').reduce((a, s) => a + s.percent, 0);

    if (equityShare > risk.equityCeiling + 0.005) {
      const goalMonthly = kept.reduce((a, s) => a + s.monthlyAmount, 0);
      const excess = equityShare - risk.equityCeiling;
      const scale = risk.equityCeiling / equityShare;

      for (const s of kept) {
        if (s.assetClass === 'equity') s.percent = Math.round(s.percent * scale * 10000) / 10000;
      }

      const debtSlices = kept.filter((s) => s.assetClass === 'debt');
      if (debtSlices.length > 0) {
        const debtTotal = debtSlices.reduce((a, s) => a + s.percent, 0);
        for (const s of debtSlices) {
          s.percent = Math.round((s.percent + excess * (s.percent / debtTotal)) * 10000) / 10000;
        }
      } else {
        kept.push({
          assetClass: 'debt',
          sleeve: CATALOGUE.debt_short.sleeve,
          percent: Math.round(excess * 10000) / 10000,
          monthlyAmount: 0,
          instrument: CATALOGUE.debt_short,
          rationale: 'Holds the portion of the allocation that had to be moved out of equity to respect your risk ceiling.',
        });
      }

      for (const s of kept) s.monthlyAmount = Math.round(goalMonthly * s.percent);
      equityShare = kept.filter((s) => s.assetClass === 'equity').reduce((a, s) => a + s.percent, 0);

      records.push({
        subject: `Equity exposure for "${plan.name}"`,
        verdict: 'resized',
        rationale:
          `After removing instruments that failed eligibility or lock-in checks, equity would have re-weighted to ${pct(equityShare + excess)}, above your ${pct(risk.equityCeiling)} ceiling. ` +
          `Equity was scaled back to ${pct(equityShare)} and the ${pct(excess)} difference moved into debt.`,
      });
    } else if (kept.length > 0) {
      records.push({
        subject: `Allocation for "${plan.name}"`,
        verdict: 'passed',
        rationale:
          `${plan.yearsToTarget} years to target places this in the ${plan.bucket} bucket. ` +
          `Equity at ${pct(equityShare)} is within your ${pct(risk.equityCeiling)} ceiling. ` +
          `Blended expected return ${pct(plan.expectedReturn)}, inflation assumption ${pct(plan.inflationRateUsed)}, ` +
          `giving a required contribution of ${inr(plan.requiredMonthlySIP)} a month.`,
      });
    }

    return { ...plan, allocation: kept };
  });

  /* ---- Liquidity cross-check ---- */

  if (profile.liquidity.amountImmediatelyAccessible > derived.liquidAssets) {
    warnings.push(
      `You said you need ${inr(profile.liquidity.amountImmediatelyAccessible)} immediately accessible, but only ${inr(derived.liquidAssets)} is currently liquid. The emergency-fund action above addresses part of this; the rest should not be invested at all.`,
    );
  }

  if (profile.liquidity.largeExpensesWithin3Years > 0) {
    records.push({
      subject: 'Known large expense within three years',
      verdict: 'passed',
      rationale: `You flagged ${inr(profile.liquidity.largeExpensesWithin3Years)} of large expenses within three years. That amount is held in the short bucket (liquid and short-duration instruments only) and excluded from equity.`,
    });
  }

  /* ---- Consent check ---- */

  if (!profile.consent.generatePersonalisedRecommendations || !profile.consent.riskDisclosuresAccepted) {
    warnings.push(
      'Consent for personalised recommendations or risk disclosures has not been recorded. Under SEBI rules the plan cannot be released to the client until both are captured.',
    );
  }

  return { goalPlans: filtered, records, warnings };
}

export const _catalogue = CATALOGUE;
