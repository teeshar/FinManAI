/**
 * Human-readable plan renderer.
 *
 * This is NOT the product UI. It exists so the numbers and the reasoning can be
 * read and argued with before any interface is built. If a plan reads wrong
 * here, it will read wrong on a screen.
 *
 * Run: node --experimental-strip-types tests/report.ts [personaKey] > report.md
 */

import { generatePlan, healthScore } from '../src/engine.ts';
import { ALL_PERSONAS } from '../fixtures/personas.ts';
import type { RecommendationPlan } from '../src/types.ts';

const TODAY = '2026-08-18';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const pct = (n: number) => (n * 100).toFixed(1) + '%';
const title = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const BAND_MARK: Record<string, string> = {
  critical: '🔴',
  poor: '🟠',
  fair: '🟡',
  good: '🟢',
  excellent: '🟢',
};

function render(label: string, p: RecommendationPlan): string {
  const L: string[] = [];
  const d = p.derived;

  L.push(`## ${label}`);
  L.push('');
  L.push(
    `*Plan ${p.profileId} · engine ${p.engineVersion} · assumptions ${p.assumptionsVersion} · ${p.planningMode} mode · generated ${p.generatedAt}*`,
  );
  L.push('');

  /* ---- Money in, money out ---- */
  L.push('### Where the money goes');
  L.push('');
  L.push('| | Monthly |');
  L.push('|---|---:|');
  L.push(`| Gross income | ${inr(d.grossMonthlyIncome)} |`);
  if (d.variableIncomeHaircutApplied > 0)
    L.push(`| Less: bonus haircut (50%, not planned on) | −${inr(d.variableIncomeHaircutApplied)} |`);
  L.push(`| **Income we plan on** | **${inr(d.plannableMonthlyIncome)}** |`);
  L.push(`| Essential expenses | −${inr(d.essentialMonthlyExpenses)} |`);
  L.push(`| Discretionary | −${inr(d.discretionaryMonthlyExpenses)} |`);
  L.push(`| Irregular (annualised) | −${inr(d.irregularMonthlyProvision)} |`);
  L.push(`| EMIs | −${inr(d.totalMonthlyEMI)} |`);
  L.push(`| **Investable surplus** | **${inr(d.investableSurplus)}** |`);
  L.push('');
  L.push(
    `Net worth ${inr(d.netWorth)} — ${inr(d.totalAssets)} of assets against ${inr(d.totalLiabilities)} of debt. ` +
      `${d.yearsToRetirement} years to retirement.`,
  );
  L.push('');

  /* ---- Diagnostics ---- */
  L.push(`### Financial health — ${healthScore(p.diagnostics)}/100`);
  L.push('');
  L.push('| | Metric | Value | Benchmark |');
  L.push('|---|---|---|---|');
  for (const x of p.diagnostics) {
    const v =
      x.unit === 'ratio'
        ? pct(x.value)
        : x.unit === 'months'
          ? `${x.value.toFixed(1)} months`
          : x.unit === 'multiple'
            ? `${x.value.toFixed(2)}×`
            : inr(x.value);
    L.push(`| ${BAND_MARK[x.band]} | ${x.label} | ${v} | ${x.benchmark} |`);
  }
  L.push('');
  for (const x of p.diagnostics) {
    if (x.band === 'critical' || x.band === 'poor') L.push(`> **${x.label}.** ${x.comment}`);
  }
  L.push('');

  /* ---- Risk ---- */
  const r = p.riskProfile;
  L.push('### Risk profile');
  L.push('');
  L.push(
    `**${title(r.band)}** — capacity ${r.capacityScore}/100, tolerance ${r.toleranceScore}/100, ` +
      `final ${r.finalScore}/100 (the lower of the two). Equity is capped at ${pct(r.equityCeiling)}.`,
  );
  L.push('');
  if (r.divergenceNote) {
    L.push(`> ${r.divergenceNote}`);
    L.push('');
  }
  L.push('| Capacity factor | Weight | Score |');
  L.push('|---|---:|---:|');
  for (const f of r.capacityBreakdown)
    L.push(`| ${f.factor} | ${(f.weight * 100).toFixed(0)}% | ${f.score} |`);
  L.push('');

  /* ---- Action plan ---- */
  L.push('### What to do, in order');
  L.push('');
  for (const a of p.actionPlan) {
    const amt =
      a.monthlyAmountLater !== undefined
        ? a.monthlyAmount > 0
          ? ` — **${inr(a.monthlyAmount)}/month now → ${inr(a.monthlyAmountLater)}/month from month ${a.startsInMonths}**`
          : ` — **${inr(a.monthlyAmountLater)}/month, starting in ${a.startsInMonths} months**`
        : a.monthlyAmount > 0
          ? ` — **${inr(a.monthlyAmount)}/month**`
          : a.oneTimeAmount > 0
            ? ` — **${inr(a.oneTimeAmount)} one-time**`
            : '';
    L.push(`**${a.rank}. ${a.title}**${amt}  `);
    L.push(`${a.reason}`);
    L.push('');
  }

  /* ---- Goals ---- */
  if (p.goalPlans.length > 0) {
    L.push('### Goals');
    L.push('');
    L.push('| Goal | Years | Bucket | Cost then | Gap | Start SIP | Step-up | Status |');
    L.push('|---|---:|---|---:|---:|---:|---|---|');
    for (const g of p.goalPlans) {
      const step = g.stepUpRate > 0 ? `+${(g.stepUpRate * 100).toFixed(0)}%/yr` : 'flat';
      L.push(
        `| ${g.name} | ${g.yearsToTarget} | ${g.bucket} | ${inr(g.futureCost)} | ${inr(g.gap)} | ${inr(g.requiredMonthlySIP)} | ${step} | ${title(g.feasibility)} |`,
      );
    }
    L.push('');

    for (const g of p.goalPlans) {
      L.push(`#### ${g.name}`);
      L.push('');
      L.push(
        `${g.yearsToTarget} years away. Cost today grows at ${pct(g.inflationRateUsed)} to **${inr(g.futureCost)}**. ` +
          `What you have already saved and are already investing should reach ${inr(g.projectedValueOfExistingSavings)}, ` +
          `leaving a gap of **${inr(g.gap)}**. At a blended expected return of ${pct(g.expectedReturn)} that needs ` +
          `**${inr(g.requiredMonthlySIP)} a month**` +
          (g.stepUpRate > 0
            ? `, increased by ${(g.stepUpRate * 100).toFixed(0)}% each year as your income grows — reaching ${inr(g.finalMonthlySIP)} in the final year. ` +
              `Held flat instead, it would take ${inr(g.flatEquivalentSIP)} a month from day one.`
            : '.'),
      );
      L.push('');

      if (g.decumulation && g.decumulation.length > 0) {
        L.push('*How the retirement corpus is horizoned — each tranche by when it is actually spent:*');
        L.push('');
        L.push('| Portion of corpus | Share | Effective horizon | Bucket |');
        L.push('|---|---:|---:|---|');
        for (const t of g.decumulation) {
          L.push(`| Spent in the ${t.label} | ${pct(t.weight)} | ${t.effectiveHorizonYears} yrs | ${t.bucket} |`);
        }
        L.push('');
      }
      if (g.negotiation) {
        L.push(`> ⚠️ ${g.negotiation}`);
        L.push('');
      }
      if (g.note) {
        L.push(`> 🏠 ${g.note}`);
        L.push('');
      }
      if (g.allocation.length > 0) {
        L.push('| Allocation | % | Monthly | Why |');
        L.push('|---|---:|---:|---|');
        for (const s of g.allocation) {
          L.push(`| ${s.instrument.label} | ${pct(s.percent)} | ${inr(s.monthlyAmount)} | ${s.rationale} |`);
        }
        L.push('');
      }
    }
  }

  /* ---- Portfolio view ---- */
  if (p.aggregateAllocation.length > 0) {
    L.push('### Combined monthly investment');
    L.push('');
    L.push('| Instrument category | Asset class | % | Monthly | Tax treatment |');
    L.push('|---|---|---:|---:|---|');
    for (const s of p.aggregateAllocation) {
      L.push(
        `| ${s.instrument.label} | ${title(s.assetClass)} | ${pct(s.percent)} | ${inr(s.monthlyAmount)} | ${s.instrument.taxNote} |`,
      );
    }
    const total = p.aggregateAllocation.reduce((a, s) => a + s.monthlyAmount, 0);
    L.push(`| **Total** | | **100%** | **${inr(total)}** | |`);
    L.push('');

    const byClass = new Map<string, number>();
    for (const s of p.aggregateAllocation)
      byClass.set(s.assetClass, (byClass.get(s.assetClass) ?? 0) + s.percent);
    L.push(
      'Asset-class split: ' +
        [...byClass.entries()].map(([k, v]) => `${title(k)} ${pct(v)}`).join(' · '),
    );
    L.push('');
  }

  /* ---- Rebalancing ---- */
  const rb = p.rebalancing;
  L.push('### Your existing portfolio');
  L.push('');
  L.push(rb.summary);
  L.push('');
  if (rb.portfolioValue > 0) {
    L.push('| Asset class | Held now | Now | Target | Drift | Action |');
    L.push('|---|---:|---:|---:|---:|---|');
    for (const d of rb.drift) {
      const sign = d.driftPoints > 0 ? '+' : '';
      L.push(
        `| ${title(d.assetClass)} | ${inr(d.currentValue)} | ${pct(d.currentPercent)} | ${pct(d.targetPercent)} | ${sign}${d.driftPoints.toFixed(1)} pts | ${title(d.action)} ${d.action === 'hold' ? '' : inr(d.amount)} |`,
      );
    }
    L.push('');
    if (rb.excludedValue > 0) {
      L.push(`*${inr(rb.excludedValue)} is excluded from rebalancing:* ` +
        rb.holdings.filter((h) => h.liquidity === 'excluded').map((h) => `${h.label} — ${h.exclusionReason}`).join(' '));
      L.push('');
    }
    const locked = rb.holdings.filter((h) => h.liquidity === 'locked' || h.liquidity === 'illiquid');
    if (locked.length > 0) {
      L.push('*Counted in your allocation but not sellable:* ' +
        locked.map((h) => `${h.label} (${inr(h.currentValue)}) — ${h.exclusionReason}`).join(' '));
      L.push('');
    }
    for (const a of rb.actions) {
      const cost = a.taxCost > 0 ? ` — tax cost ${inr(a.taxCost)}` : a.amount > 0 ? ' — no tax' : '';
      L.push(`**${a.rank}. ${a.title}**${cost}  `);
      L.push(a.reason);
      L.push('');
    }
    if (rb.estimatedTaxToRebalanceNow > 0) {
      L.push(`Total tax to correct the drift now: **${inr(rb.estimatedTaxToRebalanceNow)}**. Unused LTCG exemption this year: ${inr(rb.taxFreeHeadroom)}.`);
      L.push('');
    }
  }

  /* ---- Tax ---- */
  const t = p.taxRecommendation;
  L.push('### Tax');
  L.push('');
  L.push(
    `Old regime ${inr(t.oldRegimeTax)} · New regime ${inr(t.newRegimeTax)} → **use the ${t.recommendedRegime} regime**, saving ${inr(t.annualSaving)} a year.`,
  );
  L.push('');
  for (const n of t.notes) L.push(`- ${n}`);
  L.push('');

  /* ---- Stress tests ---- */
  const SEV: Record<string, string> = { comfortable: '🟢', manageable: '🟡', painful: '🟠', catastrophic: '🔴' };
  L.push('### If things go wrong');
  L.push('');
  for (const t of p.stressTests) {
    L.push(`**${SEV[t.severity]} ${t.title}**  `);
    L.push(`*${t.scenario}*  `);
    L.push(`${t.headline} ${t.whatBreaks}`);
    L.push('');
    L.push(`> **What to do:** ${t.mitigation}`);
    L.push('');
  }

  /* ---- Life cover by earner ---- */
  if (d.termCoverByEarner.length > 1) {
    L.push('### Life cover, per earner');
    L.push('');
    L.push('| Earner | Age | Income | Cover needed | Held | Gap | Est. premium |');
    L.push('|---|---:|---:|---:|---:|---:|---:|');
    for (const e of d.termCoverByEarner) {
      L.push(`| ${e.name} | ${e.age} | ${inr(e.annualIncome)} | ${inr(e.requiredCover)} | ${inr(e.existingCover)} | ${inr(e.gap)} | ${inr(e.estimatedMonthlyPremium)}/mo |`);
    }
    L.push('');
    L.push('*Cover is sized per earner, not on pooled household income: if one of you dies the survivor keeps their own income but loses the other\'s entirely, so a single policy against the combined figure would leave a gap.*');
    L.push('');
  }

  /* ---- Suitability ---- */
  L.push('### Suitability record (the SEBI audit trail)');
  L.push('');
  for (const s of p.suitability) {
    const icon = s.verdict === 'passed' ? '✅' : s.verdict === 'resized' ? '🔧' : '❌';
    L.push(`- ${icon} **${s.subject}** — ${s.rationale}`);
  }
  L.push('');

  if (p.warnings.length > 0) {
    L.push('### Warnings');
    L.push('');
    for (const w of p.warnings) L.push(`- ${w}`);
    L.push('');
  }

  return L.join('\n');
}

/* ------------------------------------------------------------------ */

const only = process.argv[2];
const personas = only ? ALL_PERSONAS.filter((p) => p.key === only) : ALL_PERSONAS;

const out: string[] = [
  '# FinManAI engine — persona output',
  '',
  `Generated ${TODAY} · engine 1.0.0 · assumptions 2026-08`,
  '',
  'Every number below is produced by deterministic TypeScript. No language model was involved.',
  'The LLM layer (Phase 4) will only turn this into prose — it cannot change a figure.',
  '',
  '---',
  '',
];

for (const persona of personas) {
  out.push(render(persona.label, generatePlan(persona.profile, { today: TODAY })));
  out.push('');
  out.push('---');
  out.push('');
}

console.log(out.join('\n'));
