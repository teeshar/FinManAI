/**
 * Insurance-linked policy comparison: surrender vs continue.
 *
 * Flagging a ULIP as "worth reviewing" is not advice — it is a hint that
 * something might be wrong, handed back to the person least equipped to work
 * it out. This module does the arithmetic instead.
 *
 * The comparison is deliberately fair to the policy:
 *   - Surrendering loses the life cover, so the alternative must BUY term
 *     insurance for the same sum assured and pay for it out of the same money.
 *   - Only the premium left AFTER that replacement cover is invested.
 *   - The surrender value, not the fund value, is what you actually receive.
 *
 * Where the answer is close, we say it is close rather than manufacturing a
 * recommendation.
 */

import type {
  Asset,
  DerivedFinancials,
  FinancialProfile,
  PolicyComparison,
} from './types.ts';
import { POLICY } from './assumptions/v2026-08.ts';
import { termPremiumMonthly } from './premiums.ts';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

const POLICY_TYPES: Asset['type'][] = ['ulip', 'endowment_policy'];

function fv(principal: number, rate: number, years: number): number {
  return principal * Math.pow(1 + rate, years);
}

function annuityFV(monthly: number, annualRate: number, years: number): number {
  const n = Math.max(0, Math.round(years * 12));
  const r = Math.pow(1 + annualRate, 1 / 12) - 1;
  if (n === 0) return 0;
  if (r <= 0) return monthly * n;
  return monthly * ((Math.pow(1 + r, n) - 1) / r) * (1 + r);
}


export function comparePolicies(
  profile: FinancialProfile,
  derived: DerivedFinancials,
): PolicyComparison[] {
  return profile.assets
    .filter((a) => POLICY_TYPES.includes(a.type))
    .map((a) => {
      const monthlyPremium = a.monthlyContribution;
      const annualPremium = monthlyPremium * 12;
      // Insurers pay a surrender value below the fund value; where it is not
      // supplied we assume the fund value, which FAVOURS continuing.
      const surrenderValue = a.surrenderValue ?? a.currentValue;
      // A ULIP's cover is typically 10× annual premium where not stated.
      const sumAssured = a.sumAssured ?? annualPremium * 10;
      const remainingYears = a.remainingPremiumYears ?? Math.max(1, Math.round(a.lockInMonthsRemaining / 12) + 5);

      /* Path A — keep paying. */
      const valueIfContinued =
        fv(a.currentValue, POLICY.assumedPolicyReturn, remainingYears) +
        annuityFV(monthlyPremium, POLICY.assumedPolicyReturn, remainingYears);

      /* Path B — surrender, replace the cover, invest the difference. */
      const replacementTermPremiumMonthly = termPremiumMonthly(sumAssured, {
        age: profile.personal.age,
        gender: profile.personal.gender,
        smoker: profile.personal.smoker,
      });
      const investableAfterCover = Math.max(0, monthlyPremium - replacementTermPremiumMonthly);
      const valueIfSurrendered =
        fv(surrenderValue, POLICY.alternativeReturn, remainingYears) +
        annuityFV(investableAfterCover, POLICY.alternativeReturn, remainingYears);

      const advantage = valueIfSurrendered - valueIfContinued;
      const relative = valueIfContinued > 0 ? advantage / valueIfContinued : 0;

      let recommendation: PolicyComparison['recommendation'];
      if (relative > POLICY.indifferenceBand) recommendation = 'surrender_and_redirect';
      else if (relative < -POLICY.indifferenceBand) recommendation = 'continue';
      else recommendation = 'too_close_to_call';

      const locked = a.lockInMonthsRemaining > 0;

      const reasoning =
        recommendation === 'surrender_and_redirect'
          ? `Continuing this policy for another ${remainingYears} years at ${(POLICY.assumedPolicyReturn * 100).toFixed(0)}% — a realistic net return after its charges — gets you to about ${inr(valueIfContinued)}. ` +
            `Surrendering for ${inr(surrenderValue)}, buying ${inr(sumAssured)} of pure term cover for about ${inr(replacementTermPremiumMonthly)} a month, and investing the remaining ${inr(investableAfterCover)} in a diversified index fund gets you to about ${inr(valueIfSurrendered)} — ` +
            `roughly ${inr(advantage)} more, with the same life cover in place throughout. ` +
            (locked
              ? `Note the policy is still locked for ${a.lockInMonthsRemaining} months, so this is a decision for when the lock-in ends, not today. `
              : '') +
            `Before acting, get the actual surrender value in writing from the insurer — ours is an estimate, and it is the one number that can change the answer.`
          : recommendation === 'continue'
            ? `Unusually, the arithmetic favours keeping this one: continuing reaches about ${inr(valueIfContinued)} against ${inr(valueIfSurrendered)} for surrendering and reinvesting. ` +
              `That is normally because you are far enough in that the early charges are already paid and the remaining years are comparatively efficient. Keep paying.`
            : `The two paths are within ${(POLICY.indifferenceBand * 100).toFixed(0)}% of each other — about ${inr(valueIfContinued)} continuing against ${inr(valueIfSurrendered)} surrendering and reinvesting. ` +
              `That is too close to justify the disruption and the paperwork. Keep it, but do not buy another one.`;

      return {
        assetId: a.id,
        label: a.label ?? a.type.replace(/_/g, ' '),
        surrenderValue: Math.round(surrenderValue),
        annualPremium: Math.round(annualPremium),
        sumAssured: Math.round(sumAssured),
        remainingYears,
        valueIfContinued: Math.round(valueIfContinued),
        valueIfSurrendered: Math.round(valueIfSurrendered),
        replacementTermPremiumMonthly,
        advantageOfSurrender: Math.round(advantage),
        recommendation,
        reasoning,
      };
    });
}
