/**
 * Return-assumption sensitivity.
 *
 * Every SIP figure in the product hangs off the expected returns in
 * assumptions/v2026-08.ts. Those numbers are a judgement call, and the right
 * way to make a judgement call is to see what it costs.
 *
 * This re-runs every persona across a range of equity return assumptions and
 * reports how the required contributions move. Debt, gold and real-asset
 * returns are held constant so the equity assumption is isolated.
 *
 * Run: node --experimental-strip-types tests/sensitivity.ts
 */

import { generatePlan } from '../src/engine.ts';
import { ALL_PERSONAS } from '../fixtures/personas.ts';
import { ASSET_CLASS_RETURN } from '../src/assumptions/v2026-08.ts';

const TODAY = '2026-08-18';
const SCENARIOS = [0.09, 0.10, 0.113, 0.12, 0.13];
const BASELINE = ASSET_CLASS_RETURN.equity;

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

type Row = { persona: string; goal: string; years: number; sips: number[]; feas: string[] };
const rows: Row[] = [];

for (const persona of ALL_PERSONAS) {
  const perGoal = new Map<string, { years: number; sips: number[]; feas: string[] }>();

  for (const equityReturn of SCENARIOS) {
    // The assumptions object is deliberately mutable here and nowhere else.
    // This is a analysis harness, not production code.
    (ASSET_CLASS_RETURN as Record<string, number>).equity = equityReturn;
    const plan = generatePlan(persona.profile, { today: TODAY });

    for (const g of plan.goalPlans) {
      if (!perGoal.has(g.name))
        perGoal.set(g.name, { years: g.yearsToTarget, sips: [], feas: [] });
      perGoal.get(g.name)!.sips.push(g.requiredMonthlySIP);
      perGoal.get(g.name)!.feas.push(g.feasibility);
    }
  }

  for (const [goal, v] of perGoal) {
    rows.push({ persona: persona.key, goal, years: v.years, sips: v.sips, feas: v.feas });
  }
}

// Restore, so nothing downstream inherits a mutated assumption.
(ASSET_CLASS_RETURN as Record<string, number>).equity = BASELINE;

const header = SCENARIOS.map((s) => `${(s * 100).toFixed(1)}%`);

console.log('\n\x1b[1mRequired starting SIP vs equity return assumption\x1b[0m');
console.log(`Baseline is ${(BASELINE * 100).toFixed(1)}%. Debt, gold and real assets held constant.\n`);

const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
const padL = (s: string, n: number) => s.padStart(n);

console.log(
  pad('persona', 16) + pad('goal', 30) + padL('yrs', 5) + header.map((h) => padL(h, 12)).join('') + '   swing',
);
console.log('─'.repeat(16 + 30 + 5 + 12 * SCENARIOS.length + 10));

for (const r of rows) {
  const base = r.sips[SCENARIOS.indexOf(BASELINE)] ?? r.sips[2];
  const lo = r.sips[0];
  const hi = r.sips[r.sips.length - 1];
  const swing = base > 0 ? ((lo - hi) / base) * 100 : 0;
  console.log(
    pad(r.persona, 16) +
      pad(r.goal, 30) +
      padL(String(r.years), 5) +
      r.sips.map((s) => padL(inr(s), 12)).join('') +
      padL(`${swing.toFixed(0)}%`, 9),
  );
}

console.log('\n\x1b[1mWhat this means\x1b[0m');
console.log(
  'The "swing" column is how much the required contribution falls between the 9% and 13%\n' +
    'assumptions, as a share of the baseline. Long-horizon goals swing hardest, because the\n' +
    'assumption compounds for longer — which is exactly where being wrong is most expensive.\n',
);

const longGoals = rows.filter((r) => r.years > 15);
if (longGoals.length > 0) {
  const avg =
    longGoals.reduce((a, r) => {
      const base = r.sips[SCENARIOS.indexOf(BASELINE)] ?? r.sips[2];
      return a + (base > 0 ? ((r.sips[0] - r.sips[r.sips.length - 1]) / base) * 100 : 0);
    }, 0) / longGoals.length;
  console.log(
    `On goals longer than 15 years, moving the equity assumption from 9% to 13% changes the\n` +
      `required contribution by an average of ${avg.toFixed(0)}% of the baseline.\n` +
      `Choosing 13% and being wrong means under-saving by roughly that much for decades.\n` +
      `Choosing 9% and being wrong means over-saving — recoverable, and the error most\n` +
      `planners would rather make.\n`,
  );
}

/* Feasibility flips — where the assumption changes the ADVICE, not just the number. */
const flips = rows.filter((r) => new Set(r.feas).size > 1);
if (flips.length > 0) {
  console.log('\x1b[1mGoals whose verdict changes with the assumption\x1b[0m');
  for (const f of flips) {
    console.log(`  ${f.persona} — ${f.goal}: ${f.feas.map((x, i) => `${header[i]}→${x}`).join('  ')}`);
  }
  console.log(
    '\nThese are the ones to worry about. For every goal above, the equity assumption alone\n' +
      "decides whether we tell someone their goal is reachable. That is not a modelling detail.\n",
  );
} else {
  console.log('No goal changes its feasibility verdict across the tested range.\n');
}
