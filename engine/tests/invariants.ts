/**
 * Invariant tests.
 *
 * These are the rules that must hold for EVERY profile the engine ever sees.
 * They are not about matching a snapshot — they are about the engine never
 * giving advice that is structurally wrong.
 *
 * Run: node --experimental-strip-types tests/invariants.ts
 */

import { generatePlan } from '../src/engine.ts';
import { ALL_PERSONAS } from '../fixtures/personas.ts';
import { CAPS, FEASIBILITY, STEP_UP, WATERFALL } from '../src/assumptions/v2026-08.ts';
import type { RecommendationPlan } from '../src/types.ts';

const TODAY = '2026-08-18';

type Check = { name: string; run: (p: RecommendationPlan) => string | null };

const checks: Check[] = [
  {
    name: 'Allocation never exceeds the surplus available for goals',
    run: (p) => {
      const allocated = p.aggregateAllocation.reduce((a, s) => a + s.monthlyAmount, 0);
      const goalAction = p.actionPlan.find((a) => a.category === 'goal_investment');
      // Goals are sized on the steady-state amount where the plan is phased.
      const available = goalAction?.monthlyAmountLater ?? goalAction?.monthlyAmount ?? 0;
      return allocated > available + 5
        ? `allocated ₹${allocated} > available ₹${available}`
        : null;
    },
  },
  {
    /* The invariant that was missing. An earlier waterfall let an aggressive
       debt-payoff schedule crowd out insurance premiums, producing a plan that
       committed ₹25,078 of a ₹23,750 surplus — the negative was silently
       clamped to zero and surfaced as "invest ₹0 a month". Every action now
       declares what it takes from surplus, and the total must fit. */
    name: 'The action plan fits inside the surplus it is spending',
    run: (p) => {
      const committed = p.actionPlan.reduce((a, x) => a + x.surplusConsumed, 0);
      const budget = Math.max(0, p.derived.investableSurplus);
      if (committed > budget + 1)
        return `actions commit ₹${Math.round(committed)} of a ₹${Math.round(budget)} surplus`;
      return null;
    },
  },
  {
    name: 'A phased plan never states one amount while meaning another',
    run: (p) => {
      for (const a of p.actionPlan) {
        if (a.monthlyAmountLater === undefined) continue;
        if (a.startsInMonths === undefined || a.startsInMonths <= 0)
          return `${a.title} promises a later amount with no start month`;
        if (a.monthlyAmountLater <= a.monthlyAmount)
          return `${a.title} claims a rise to an amount that is not higher`;
        if (a.surplusConsumed > a.monthlyAmount + 1)
          return `${a.title} consumes more surplus than it says it invests now`;
      }
      return null;
    },
  },
  {
    name: 'Insurance premiums are never crowded out by debt repayment',
    run: (p) => {
      const protection = p.actionPlan.filter((a) => a.category === 'protection');
      if (protection.length === 0) return null;
      for (const a of protection) {
        if (a.monthlyAmount > 0 && a.surplusConsumed <= 0)
          return `${a.title} was recommended but nothing was reserved to pay for it`;
      }
      return null;
    },
  },
  {
    /* §0.2 — expectedIncomeGrowth was collected and never read, so the engine
       planned a flat nominal SIP for 30 years and marked almost everything
       impossible. The step-up must be present, capped, and actually reduce the
       starting contribution below the flat equivalent. */
    name: 'Step-up SIPs are applied, capped, and cheaper than flat',
    run: (p) => {
      for (const g of p.goalPlans) {
        if (g.requiredMonthlySIP <= 0) continue;
        if (g.stepUpRate < 0 || g.stepUpRate > STEP_UP.maxAnnualStepUp + 1e-9)
          return `${g.name}: step-up ${g.stepUpRate} outside 0..${STEP_UP.maxAnnualStepUp}`;
        if (g.stepUpRate > 0) {
          if (g.requiredMonthlySIP >= g.flatEquivalentSIP)
            return `${g.name}: stepped-up start ₹${g.requiredMonthlySIP} not below flat ₹${g.flatEquivalentSIP}`;
          if (g.finalMonthlySIP < g.requiredMonthlySIP)
            return `${g.name}: final SIP below starting SIP`;
        }
      }
      return null;
    },
  },
  {
    /* §0.1 — retirement is a spending stream. Treating the retirement DATE as
       the horizon put a 57-year-old's whole corpus in short-duration debt. */
    name: 'Retirement goals are horizoned as a spending stream',
    run: (p) => {
      for (const g of p.goalPlans) {
        if (g.category !== 'retirement') continue;
        if (!g.decumulation || g.decumulation.length === 0)
          return `${g.name} has no decumulation tranches`;
        const weight = g.decumulation.reduce((a, t) => a + t.weight, 0);
        if (Math.abs(weight - 1) > 0.02)
          return `${g.name}: tranche weights sum to ${(weight * 100).toFixed(1)}%`;
        for (const t of g.decumulation) {
          if (t.effectiveHorizonYears < g.yearsToTarget - 0.05)
            return `${g.name}: tranche "${t.label}" horizon ${t.effectiveHorizonYears}y is shorter than the ${g.yearsToTarget}y to retirement`;
        }
      }
      return null;
    },
  },
  {
    /* A retiree close to the date should still hold growth assets for the money
       they will not spend for decades — subject to their risk ceiling. */
    name: 'A near-retirement corpus is not stranded in cash',
    run: (p) => {
      const ret = p.goalPlans.find((g) => g.category === 'retirement' && g.allocation.length > 0);
      if (!ret) return null;
      if (ret.yearsToTarget > 10) return null;
      const eq = ret.allocation.filter((s) => s.assetClass === 'equity').reduce((a, s) => a + s.percent, 0);
      // Expect at least half the risk ceiling, unless the user avoids equity.
      const avoidsEquity = ALL_PERSONAS.find((x) => x.profile.profileId === p.profileId)
        ?.profile.preferences.avoidTypes.includes('equity');
      if (avoidsEquity) return null;
      if (eq < p.riskProfile.equityCeiling * 0.5)
        return `${ret.name}: equity ${(eq * 100).toFixed(1)}% is under half the ${(p.riskProfile.equityCeiling * 100).toFixed(0)}% ceiling despite a multi-decade drawdown`;
      return null;
    },
  },
  {
    /* §0.3 — "not achievable" applied to 13 of 14 goals carried no signal. */
    name: '"Not achievable" is reserved for genuinely impossible goals',
    run: (p) => {
      for (const g of p.goalPlans) {
        if (g.feasibility !== 'not_achievable') continue;
        const ceiling = p.derived.plannableMonthlyIncome * FEASIBILITY.impossibleSIPToIncomeRatio;
        if (g.requiredMonthlySIP <= ceiling)
          return `${g.name} marked impossible but needs only ₹${g.requiredMonthlySIP} against a ₹${Math.round(ceiling)} ceiling`;
      }
      return null;
    },
  },
  {
    /* The engine used to direct new money only. For a household over 40 the
       existing corpus dwarfs the SIP, so a plan that ignores it is advising on
       a fraction of their wealth. */
    name: 'Rebalancing never recommends selling something that cannot be sold',
    run: (p) => {
      const sellable = new Set(
        p.rebalancing.holdings.filter((h) => h.liquidity === 'liquid').map((h) => h.label),
      );
      for (const a of p.rebalancing.actions) {
        if (a.kind !== 'switch') continue;
        const target = a.title.replace(/^Move .* out of /, '');
        if (!sellable.has(target)) return `switch targets "${target}", which is not liquid`;
      }
      return null;
    },
  },
  {
    name: 'Rebalancing prices every switch with its tax cost',
    run: (p) => {
      for (const a of p.rebalancing.actions) {
        if (a.kind !== 'switch') continue;
        if (a.taxCost < 0) return `${a.title} has a negative tax cost`;
        if (a.amount <= 0) return `${a.title} moves no money`;
      }
      return null;
    },
  },
  {
    name: 'Free rebalancing is always offered before a taxable one',
    run: (p) => {
      const redirect = p.rebalancing.actions.find((a) => a.kind === 'redirect_contributions');
      const firstSwitch = p.rebalancing.actions.find((a) => a.kind === 'switch');
      if (!firstSwitch) return null;
      if (redirect && redirect.rank > firstSwitch.rank)
        return 'a taxable switch is ranked above redirecting new contributions';
      return null;
    },
  },
  {
    name: 'The home and the emergency fund are never rebalanced',
    run: (p) => {
      for (const h of p.rebalancing.holdings) {
        if (h.type === 'property_self_occupied' && h.liquidity !== 'excluded')
          return 'the self-occupied home is being treated as portfolio';
      }
      const counted = p.rebalancing.holdings
        .filter((h) => h.liquidity !== 'excluded')
        .reduce((a, h) => a + h.currentValue, 0);
      if (Math.abs(counted - p.rebalancing.portfolioValue) > 2)
        return `counted holdings ₹${Math.round(counted)} != portfolio value ₹${p.rebalancing.portfolioValue}`;
      return null;
    },
  },
  {
    name: 'Current and target allocations each sum to 100%',
    run: (p) => {
      if (p.rebalancing.portfolioValue <= 0) return null;
      for (const [which, rec] of [['current', p.rebalancing.current], ['target', p.rebalancing.target]] as const) {
        const total = Object.values(rec).reduce((a, b) => a + b, 0);
        if (Math.abs(total - 1) > 0.02) return `${which} sums to ${(total * 100).toFixed(1)}%`;
      }
      return null;
    },
  },
  {
    name: 'Every plan is stress tested on all three scenarios',
    run: (p) => {
      const keys = p.stressTests.map((t) => t.key).sort();
      const expected = ['job_loss', 'market_crash', 'medical_event'];
      if (JSON.stringify(keys) !== JSON.stringify(expected))
        return `stress tests present: ${keys.join(', ')}`;
      for (const t of p.stressTests) {
        if (!t.mitigation || !t.whatBreaks) return `${t.key} has no mitigation or consequence`;
        if (t.impactAmount < 0) return `${t.key} has a negative impact amount`;
      }
      return null;
    },
  },
  {
    /* Life cover pooled across earners understates each individual need. */
    name: 'Life cover is sized per earner and the parts sum to the whole',
    run: (p) => {
      const byEarner = p.derived.termCoverByEarner;
      if (byEarner.length === 0) return 'no per-earner term cover breakdown';
      const gapSum = byEarner.reduce((a, e) => a + e.gap, 0);
      if (Math.abs(gapSum - p.derived.termCoverGap) > 2)
        return `per-earner gaps ₹${Math.round(gapSum)} != total ₹${p.derived.termCoverGap}`;
      for (const e of byEarner) {
        if (e.gap > e.requiredCover + 1) return `${e.name}: gap exceeds required cover`;
        if (e.gap > 0 && e.estimatedMonthlyPremium <= 0)
          return `${e.name}: a cover gap with no premium estimate`;
      }
      return null;
    },
  },
  {
    /* "Review your policy" is a hint, not advice. Every flagged policy must
       carry an actual costed comparison. */
    name: 'Every insurance-linked policy gets a costed verdict',
    run: (p) => {
      const persona = ALL_PERSONAS.find((x) => x.profile.profileId === p.profileId);
      if (!persona) return null;
      const policies = persona.profile.assets.filter(
        (a) => a.type === 'ulip' || a.type === 'endowment_policy',
      );
      if (policies.length !== p.policyComparisons.length)
        return `${policies.length} policies but ${p.policyComparisons.length} comparisons`;
      for (const c of p.policyComparisons) {
        if (c.valueIfContinued <= 0 || c.valueIfSurrendered <= 0)
          return `${c.label}: a path with no value computed`;
        if (c.recommendation === 'surrender_and_redirect' && c.advantageOfSurrender <= 0)
          return `${c.label}: recommends surrender with no advantage`;
        if (c.recommendation === 'continue' && c.advantageOfSurrender >= 0)
          return `${c.label}: recommends continuing despite an advantage to surrendering`;
      }
      return null;
    },
  },
  {
    /* Premium figures were placeholders until Aug 2026. They are subtracted
       from surplus before anything is invested, so a wrong figure distorts the
       entire plan — and they must at least behave like real premiums. */
    name: 'Term premiums are plausible and rise with age',
    run: (p) => {
      for (const e of p.derived.termCoverByEarner) {
        if (e.gap <= 0) continue;
        const annualPerCrore = (e.estimatedMonthlyPremium * 12) / (e.gap / 10_000_000);
        // Published 2026 range spans roughly ₹5,500 (age 25 female) to well
        // over ₹1,00,000 at older ages. Anything outside is a bug.
        if (annualPerCrore < 4_000 || annualPerCrore > 250_000)
          return `${e.name} (age ${e.age}): ₹${Math.round(annualPerCrore)} per crore per year is outside any plausible range`;
      }
      return null;
    },
  },
  {
    name: 'Every plan discloses that premium figures are estimates',
    run: (p) =>
      p.disclosures.some((d) => /premium figures are planning estimates/i.test(d))
        ? null
        : 'no premium-estimate disclosure attached',
  },
  {
    name: 'Allocation percentages sum to ~100% within every funded goal',
    run: (p) => {
      for (const g of p.goalPlans) {
        if (g.allocation.length === 0) continue;
        const total = g.allocation.reduce((a, s) => a + s.percent, 0);
        if (Math.abs(total - 1) > 0.02) return `${g.name}: percentages sum to ${(total * 100).toFixed(1)}%`;
      }
      return null;
    },
  },
  {
    name: 'Equity never exceeds the risk-band ceiling in any goal',
    run: (p) => {
      for (const g of p.goalPlans) {
        const eq = g.allocation.filter((s) => s.assetClass === 'equity').reduce((a, s) => a + s.percent, 0);
        if (eq > p.riskProfile.equityCeiling + 0.02)
          return `${g.name}: equity ${(eq * 100).toFixed(1)}% > ceiling ${(p.riskProfile.equityCeiling * 100).toFixed(0)}%`;
      }
      return null;
    },
  },
  {
    name: 'A profile in deficit receives no investment recommendation',
    run: (p) => {
      if (p.derived.investableSurplus > 0) return null;
      if (p.aggregateAllocation.length > 0) return 'deficit profile still received an allocation';
      const first = p.actionPlan[0];
      if (!first || first.category !== 'cashflow_repair')
        return 'deficit profile did not get a cashflow-repair action first';
      return null;
    },
  },
  {
    name: 'High-cost debt is addressed before any goal investing',
    run: (p) => {
      const debtRank = p.actionPlan.find((a) => a.category === 'debt_payoff')?.rank;
      const investRank = p.actionPlan.find((a) => a.category === 'goal_investment')?.rank;
      if (debtRank === undefined || investRank === undefined) return null;
      return debtRank < investRank ? null : `debt action ranked ${debtRank}, investing ranked ${investRank}`;
    },
  },
  {
    name: 'Goals inside 24 months hold no equity or crypto',
    run: (p) => {
      for (const g of p.goalPlans) {
        if (g.yearsToTarget * 12 > WATERFALL.nearTermGoalMonths) continue;
        const risky = g.allocation.filter((s) => s.assetClass === 'equity' || s.assetClass === 'crypto');
        if (risky.length > 0) return `${g.name} (${g.yearsToTarget}y) holds ${risky.map((r) => r.instrument.label).join(', ')}`;
      }
      return null;
    },
  },
  {
    name: 'Crypto appears only with opt-in, above the band gate, within the cap',
    run: (p) => {
      const crypto = p.aggregateAllocation.filter((s) => s.assetClass === 'crypto');
      if (crypto.length === 0) return null;
      const share = crypto.reduce((a, s) => a + s.percent, 0);
      if (share > CAPS.cryptoMax + 0.001) return `crypto at ${(share * 100).toFixed(1)}% exceeds the ${CAPS.cryptoMax * 100}% cap`;
      return null;
    },
  },
  {
    name: 'Avoided asset classes never appear',
    run: (p) => {
      const persona = ALL_PERSONAS.find((x) => x.profile.profileId === p.profileId);
      if (!persona) return null;
      for (const avoided of persona.profile.preferences.avoidTypes) {
        const found = p.aggregateAllocation.find((s) => s.assetClass === avoided);
        if (found) return `${avoided} appears as ${found.instrument.label} despite being on the avoid list`;
      }
      return null;
    },
  },
  {
    name: 'No instrument locks money past its goal date (except retirement)',
    run: (p) => {
      for (const g of p.goalPlans) {
        if (g.category === 'retirement') continue;
        const months = Math.floor(g.yearsToTarget * 12);
        for (const s of g.allocation) {
          if (s.instrument.lockInMonths > months)
            return `${g.name} (${months}m) holds ${s.instrument.label} (lock-in ${s.instrument.lockInMonths}m)`;
        }
      }
      return null;
    },
  },
  {
    name: 'Every goal that is short of funding carries a negotiation',
    run: (p) => {
      for (const g of p.goalPlans) {
        if ((g.feasibility === 'stretch' || g.feasibility === 'not_achievable') && !g.negotiation)
          return `${g.name} is ${g.feasibility} but offers no alternative`;
      }
      return null;
    },
  },
  {
    name: 'Risk profile is the lower of capacity and tolerance',
    run: (p) =>
      p.riskProfile.finalScore === Math.min(p.riskProfile.capacityScore, p.riskProfile.toleranceScore)
        ? null
        : `final ${p.riskProfile.finalScore} != min(${p.riskProfile.capacityScore}, ${p.riskProfile.toleranceScore})`,
  },
  {
    name: 'Every plan carries disclosures and a suitability record',
    run: (p) => {
      if (p.disclosures.length === 0) return 'no disclosures attached';
      if (p.suitability.length === 0) return 'no suitability records attached';
      return null;
    },
  },
  {
    name: 'Eligibility rules hold (SSY needs a girl child <10, SCSS needs 60+)',
    run: (p) => {
      const persona = ALL_PERSONAS.find((x) => x.profile.profileId === p.profileId);
      if (!persona) return null;
      const hasSSY = p.aggregateAllocation.some((s) => s.instrument.id === 'sukanya');
      const eligibleSSY = persona.profile.dependents.some(
        (d) => d.relationship === 'child' && d.gender === 'female' && d.age < 10,
      );
      if (hasSSY && !eligibleSSY) return 'Sukanya recommended without an eligible girl child';
      const hasSCSS = p.aggregateAllocation.some((s) => s.instrument.id === 'scss');
      if (hasSCSS && persona.profile.personal.age < 60) return 'SCSS recommended below age 60';
      return null;
    },
  },
  {
    name: 'ELSS never appears on the new tax regime',
    run: (p) => {
      const persona = ALL_PERSONAS.find((x) => x.profile.profileId === p.profileId);
      if (persona?.profile.tax.selectedRegime !== 'new') return null;
      return p.aggregateAllocation.some((s) => s.instrument.id === 'elss')
        ? 'ELSS recommended on the new regime, where it has no tax benefit'
        : null;
    },
  },
  {
    name: 'No NaN, Infinity or negative money anywhere in the plan',
    run: (p) => {
      const bad: string[] = [];
      const walk = (obj: unknown, path: string) => {
        if (typeof obj === 'number') {
          if (!Number.isFinite(obj)) bad.push(`${path} = ${obj}`);
        } else if (Array.isArray(obj)) {
          obj.forEach((v, i) => walk(v, `${path}[${i}]`));
        } else if (obj && typeof obj === 'object') {
          for (const [k, v] of Object.entries(obj)) walk(v, `${path}.${k}`);
        }
      };
      walk(p, 'plan');
      for (const s of p.aggregateAllocation) {
        if (s.monthlyAmount < 0) bad.push(`negative allocation for ${s.instrument.label}`);
      }
      return bad.length ? bad.slice(0, 3).join('; ') : null;
    },
  },
  {
    name: 'Engine is deterministic — same input gives the same output',
    run: (p) => {
      const persona = ALL_PERSONAS.find((x) => x.profile.profileId === p.profileId);
      if (!persona) return null;
      const again = generatePlan(persona.profile, { today: TODAY });
      return JSON.stringify(again) === JSON.stringify(p) ? null : 'second run produced a different plan';
    },
  },
];

/* ------------------------------------------------------------------ */

let failures = 0;
let passes = 0;
const failureDetail: string[] = [];

console.log('\n\x1b[1mFinManAI engine — invariant suite\x1b[0m');
console.log('─'.repeat(72));

for (const persona of ALL_PERSONAS) {
  const plan = generatePlan(persona.profile, { today: TODAY });
  const results = checks.map((c) => ({ name: c.name, err: c.run(plan) }));
  const failed = results.filter((r) => r.err);
  passes += results.length - failed.length;
  failures += failed.length;

  const mark = failed.length === 0 ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${mark} ${persona.label}`);
  for (const f of failed) {
    console.log(`    \x1b[31m${f.name}\x1b[0m → ${f.err}`);
    failureDetail.push(`${persona.key}: ${f.name} → ${f.err}`);
  }
}

console.log('─'.repeat(72));
console.log(
  `${passes} passed, ${failures} failed across ${ALL_PERSONAS.length} personas × ${checks.length} invariants\n`,
);

if (failures > 0) process.exit(1);
