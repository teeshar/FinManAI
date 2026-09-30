/**
 * Stage 9 — The LLM narrative layer.
 *
 * The model receives the finished plan and writes PROSE ONLY. It cannot
 * introduce a number, a product or a claim that the engine did not produce.
 *
 * Enforcement is not "we asked it nicely in the prompt". Every numeral in the
 * generated text is extracted and checked against the set of values the engine
 * actually produced. If a single figure is not traceable, the narrative is
 * rejected and the deterministic fallback is used instead.
 *
 * SEBI requires advisers using AI to disclose the extent of that use and holds
 * the adviser accountable regardless of the tool. A model that can invent
 * "expected returns of 15%" is a compliance incident waiting to happen.
 */

import type { RecommendationPlan } from './types.ts';
import * as A from './assumptions/v2026-08.ts';

/* ------------------------------------------------------------------ */
/* The prompt                                                          */
/* ------------------------------------------------------------------ */

export const SYSTEM_PROMPT = `You are the explanation layer of a SEBI-compliant financial planning engine in India.

You will receive a completed financial plan as JSON. Your ONLY job is to explain it in clear, warm, plain language that an ordinary Indian household can act on.

ABSOLUTE RULES — violating any of these causes your output to be discarded:
1. Do NOT introduce any number that is not present in the JSON. Not a return figure, not a rupee amount, not a percentage, not a year. If you want to say it, find it in the JSON first.
2. Do NOT name any specific mutual fund scheme, AMC, stock, bank or insurer. The engine deliberately recommends categories, not products.
3. Do NOT contradict, re-rank or "improve" the engine's recommendations. If you think the plan is wrong, say nothing — do not silently correct it.
4. Do NOT promise, guarantee or imply certainty about any future return.
5. Do NOT give tax, legal or medical advice beyond restating what is in the JSON.

WHAT TO DO:
- Lead with the single most important thing the person should do this month, taken from actionPlan[0].
- Explain WHY the order of the action plan is what it is. The sequencing is the advice.
- Where riskProfile.divergenceNote exists, explain it kindly and without condescension.
- Where a goal is 'stretch', 'needs_more_saving' or 'not_achievable', be honest and present the negotiation options as real choices, not failures.
- Where rebalancing.needsRebalancing is true, say so plainly: for an established portfolio this usually matters more than where the next contribution goes. Always mention that redirecting new contributions is the free option before any selling.
- Keep it under 500 words. Use short paragraphs. No bullet-point walls.
- Write in second person ("you"), never "the client".
- End with one sentence noting this plan should be reviewed if income, family or goals change.

Tone: a competent, unhurried adviser who respects the reader's intelligence and is not trying to sell anything.`;

export function buildUserPrompt(plan: RecommendationPlan): string {
  // Send only what the narrative needs. No PII, no raw profile.
  // The per-earner cover breakdown carries real names. Redact before the
  // profile ever reaches a third-party model — the narrative does not need
  // to know who anyone is to explain the numbers.
  const derived = {
    ...plan.derived,
    termCoverByEarner: plan.derived.termCoverByEarner.map((e, i) => ({
      ...e,
      name: i === 0 ? 'the primary earner' : `earner ${i + 1}`,
    })),
  };

  const payload = {
    derived,
    diagnostics: plan.diagnostics.map((d) => ({ label: d.label, value: d.value, unit: d.unit, band: d.band, comment: d.comment })),
    riskProfile: {
      band: plan.riskProfile.band,
      capacityScore: plan.riskProfile.capacityScore,
      toleranceScore: plan.riskProfile.toleranceScore,
      finalScore: plan.riskProfile.finalScore,
      equityCeiling: plan.riskProfile.equityCeiling,
      divergenceNote: plan.riskProfile.divergenceNote,
    },
    actionPlan: plan.actionPlan,
    goalPlans: plan.goalPlans.map((g) => ({
      name: g.name,
      yearsToTarget: g.yearsToTarget,
      futureCost: g.futureCost,
      gap: g.gap,
      requiredMonthlySIP: g.requiredMonthlySIP,
      feasibility: g.feasibility,
      negotiation: g.negotiation,
      note: g.note,
    })),
    aggregateAllocation: plan.aggregateAllocation.map((s) => ({
      instrument: s.instrument.label,
      assetClass: s.assetClass,
      percent: s.percent,
      monthlyAmount: s.monthlyAmount,
    })),
    taxRecommendation: plan.taxRecommendation,
    rebalancing: {
      portfolioValue: plan.rebalancing.portfolioValue,
      needsRebalancing: plan.rebalancing.needsRebalancing,
      maxDriftPoints: plan.rebalancing.maxDriftPoints,
      summary: plan.rebalancing.summary,
      actions: plan.rebalancing.actions,
    },
    warnings: plan.warnings,
  };
  return `Explain this plan.\n\n${JSON.stringify(payload, null, 2)}`;
}

/* ------------------------------------------------------------------ */
/* The validator — this is the actual safety mechanism                 */
/* ------------------------------------------------------------------ */

/**
 * Validation is UNIT-AWARE. An earlier version flattened every figure into one
 * allowed set, which let a hallucinated "15.7%" through simply because some
 * unrelated rupee amount happened to be ₹15.7 lakh. A rupee figure, a
 * percentage and a lakh figure are now checked against different sets.
 */
export type AllowedSets = {
  rupee: Set<string>;
  percent: Set<string>;
  lakh: Set<string>;
  crore: Set<string>;
  bare: Set<string>;
};

const variants = (n: number): string[] =>
  Number.isFinite(n)
    ? [String(n), String(Math.round(n)), String(Math.round(n * 10) / 10), String(Math.round(n * 100) / 100)]
    : [];

export function allowedNumbers(plan: RecommendationPlan): AllowedSets {
  const numeric = new Set<number>();
  /** Numbers the engine itself wrote into prose (rates, sub-amounts in reasons). */
  const fromProse = new Set<number>();

  const walk = (obj: unknown) => {
    if (typeof obj === 'number' && Number.isFinite(obj)) numeric.add(obj);
    else if (typeof obj === 'string') {
      for (const m of obj.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
        const v = Number(m.replace(/,/g, ''));
        if (Number.isFinite(v)) fromProse.add(v);
      }
    } else if (Array.isArray(obj)) obj.forEach(walk);
    else if (obj && typeof obj === 'object') Object.values(obj).forEach(walk);
  };
  walk(plan);

  // Assumption constants are legitimate to quote (inflation, tax rates, caps).
  for (const block of [
    A.EXPECTED_RETURNS,
    A.ASSET_CLASS_RETURN,
    A.GOAL_INFLATION,
    A.TAX,
    A.SMALL_SAVINGS,
    A.CAPS,
    A.WATERFALL,
    A.BENCHMARKS,
    A.PROPERTY,
  ]) {
    walk(block);
  }
  numeric.add(A.GENERAL_INFLATION);

  // Totals a narrative would naturally quote but which exist only as a sum.
  const allocTotal = plan.aggregateAllocation.reduce((a, s) => a + s.monthlyAmount, 0);
  numeric.add(allocTotal);
  numeric.add(plan.aggregateAllocation.length);
  numeric.add(plan.goalPlans.reduce((a, g) => a + g.requiredMonthlySIP, 0));

  const rupee = new Set<string>();
  const percent = new Set<string>();
  const lakh = new Set<string>();
  const crore = new Set<string>();

  const addRupee = (n: number) => {
    for (const v of variants(n)) rupee.add(v);
    for (const v of variants(Math.abs(n))) rupee.add(v);
    if (Math.abs(n) >= 1000) {
      for (const v of variants(Math.round(n / 100) * 100)) rupee.add(v);
      for (const v of variants(Math.round(n / 1000) * 1000)) rupee.add(v);
    }
    if (Math.abs(n) >= 100_000) for (const v of variants(n / 100_000)) lakh.add(v);
    if (Math.abs(n) >= 10_000_000) for (const v of variants(n / 10_000_000)) crore.add(v);
  };

  for (const n of numeric) {
    addRupee(n);
    // A ratio in the plan may legitimately be quoted as a percentage.
    if (Math.abs(n) <= 1) for (const v of variants(n * 100)) percent.add(v);
    // A value already expressed as a percentage (e.g. a score out of 100).
    for (const v of variants(n)) percent.add(v);
  }
  for (const n of fromProse) {
    addRupee(n);
    for (const v of variants(n)) percent.add(v);
  }

  // Small integers used for ordinary counting, months, list numbering.
  const bare = new Set<string>([...rupee, ...percent]);
  for (let i = 0; i <= 31; i++) bare.add(String(i));
  bare.add('100');
  for (let i = 0; i <= 31; i++) percent.add(String(i));
  percent.add('100');

  return { rupee, percent, lakh, crore, bare };
}

export type ValidationResult = {
  ok: boolean;
  offending: string[];
  checked: number;
  claimViolations?: string[];
};

/**
 * Numeric checking alone is not enough. A hallucinated "15.7% annual return"
 * can coincide with a legitimate 15.7% allocation slice — the digits match, the
 * meaning does not. These patterns catch the claims that actually cause harm,
 * regardless of whether the number happens to appear somewhere in the plan.
 */
const FORBIDDEN_CLAIMS: { pattern: RegExp; why: string; exempt?: RegExp }[] = [
  {
    pattern: /\b(guarantee|guaranteed|assured returns?|risk[- ]free returns?)\b/i,
    why: 'implies a guaranteed return',
    /* Paying off a 42% credit card genuinely IS a guaranteed return, and so is
       a sovereign-backed deposit. Those statements are true and useful; the
       guard exists to stop guarantees being claimed for MARKET investments. */
    exempt: /\b(pay(?:ing)? (?:it )?off|prepay|credit card|loan|debt|EMI|PPF|EPF|fixed deposit|SCSS|Sukanya|sovereign|government[- ]backed)\b/i,
  },
  { pattern: /\bwill (?:definitely |certainly )?(?:reach|grow to|become|give you|earn|double|triple)\b/i, why: 'states a future outcome as certain' },
  { pattern: /\byou (?:will|are going to) (?:make|earn|get) (?:a |an )?(?:profit|return)\b/i, why: 'promises a profit' },
  { pattern: /\b(?:HDFC|ICICI|SBI|Axis|Kotak|Nippon|Mirae|Parag Parikh|Quant|Motilal|DSP|UTI|Franklin|Aditya Birla|Tata|Canara|Edelweiss|Bandhan)\b/i, why: 'names a specific fund house or product' },
  { pattern: /\b(?:buy|sell|invest in) (?:the )?[A-Z][a-zA-Z]+ (?:Fund|Scheme|Plan|Stock|Share)\b/, why: 'recommends a named scheme' },
  { pattern: /\bexpected (?:annual )?returns? of \d/i, why: 'asserts a specific expected return outside the engine\'s framing' },
  { pattern: /\bcannot lose\b|\bno risk\b|\bzero risk\b|\bsafe bet\b/i, why: 'denies investment risk' },
];

export function checkClaims(text: string): string[] {
  const found: string[] = [];
  // Sentence-scoped, so an exemption in one sentence cannot excuse a violation
  // in another.
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);

  for (const { pattern, why, exempt } of FORBIDDEN_CLAIMS) {
    for (const sentence of sentences) {
      const m = sentence.match(pattern);
      if (!m) continue;
      if (exempt && exempt.test(sentence)) continue;
      found.push(`"${m[0].trim()}" — ${why}`);
      break;
    }
  }
  return found;
}

const TOKEN_RE =
  /(₹\s?|Rs\.?\s?|INR\s?)?(\d[\d,]*(?:\.\d+)?)\s*(%|per ?cents?|percent|lakhs?|crores?)?/gi;

/** Extract every numeral from the narrative and verify it traces to the plan. */
export function validateNarrative(text: string, plan: RecommendationPlan): ValidationResult {
  const sets = allowedNumbers(plan);
  const offending: string[] = [];
  let checked = 0;

  for (const match of text.matchAll(TOKEN_RE)) {
    const [, currency, digits, suffixRaw] = match;
    const n = Number(digits.replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    checked++;

    const suffix = (suffixRaw ?? '').toLowerCase();
    let set: Set<string>;
    if (suffix.startsWith('%') || suffix.startsWith('per')) set = sets.percent;
    else if (suffix.startsWith('lakh')) set = sets.lakh;
    else if (suffix.startsWith('crore')) set = sets.crore;
    else if (currency) set = sets.rupee;
    else set = sets.bare;

    if (!variants(n).some((c) => set.has(c))) offending.push(digits + (suffixRaw ? suffixRaw : ''));
  }

  const claimViolations = checkClaims(text);

  return {
    ok: offending.length === 0 && claimViolations.length === 0,
    offending: [...new Set(offending)],
    checked,
    claimViolations,
  };
}

/* ------------------------------------------------------------------ */
/* Deterministic fallback                                              */
/* ------------------------------------------------------------------ */

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const pct = (n: number) => (n * 100).toFixed(1) + '%';

/**
 * Template narrative. Used when there is no API key, when the model is
 * unavailable, and — critically — whenever validation fails. The product must
 * never be unable to produce an explanation.
 */
export function fallbackNarrative(plan: RecommendationPlan): string {
  const p: string[] = [];
  const first = plan.actionPlan[0];
  const d = plan.derived;

  if (plan.actionPlan.some((a) => a.category === 'cashflow_repair')) {
    p.push(
      `Before anything else: your spending currently exceeds your income. ${first?.reason ?? ''} Until that gap closes, we are not going to recommend any investment, because none would help.`,
    );
    return p.join('\n\n');
  }

  p.push(
    `Of your ${inr(d.plannableMonthlyIncome)} monthly income, ${inr(d.investableSurplus)} is genuinely free after essential spending, lifestyle costs and EMIs. What follows is about where that money should go, and in what order.`,
  );

  if (first) {
    p.push(`**Start here: ${first.title.toLowerCase()}.** ${first.reason}`);
  }

  const protection = plan.actionPlan.filter((a) => a.category === 'protection');
  if (protection.length > 0) {
    p.push(
      `Insurance comes before investing, and that ordering is deliberate. ${protection.map((a) => a.title).join('; ')}. An uninsured earner's portfolio is one hospitalisation or one accident away from being liquidated at the worst possible time.`,
    );
  }

  const r = plan.riskProfile;
  p.push(
    `Your risk profile works out to ${r.band.replace(/_/g, ' ')}, which caps equity at ${pct(r.equityCeiling)}. That comes from two separate scores: what your finances can absorb (${r.capacityScore} out of 100) and what you say you are comfortable with (${r.toleranceScore} out of 100). We use the lower of the two.`,
  );
  if (r.divergenceNote) p.push(r.divergenceNote);

  const hard = plan.goalPlans.filter((g) => g.feasibility === 'stretch' || g.feasibility === 'not_achievable');
  if (hard.length > 0) {
    p.push(
      `Some of your goals do not currently fit the money available: ${hard.map((g) => g.name).join(', ')}. That is not a failure — it is information. Each one below lists the real options: more time, a smaller target, more surplus, or a lower priority elsewhere.`,
    );
  }

  if (plan.aggregateAllocation.length > 0) {
    const total = plan.aggregateAllocation.reduce((a, s) => a + s.monthlyAmount, 0);
    const top = plan.aggregateAllocation[0];
    p.push(
      `The investment plan itself comes to ${inr(total)} a month, spread across ${plan.aggregateAllocation.length} categories, with the largest single line being ${top.instrument.label} at ${pct(top.percent)}. Each goal has its own mix, because money you need in three years and money you need in thirty should not be invested the same way.`,
    );
  }

  const t = plan.taxRecommendation;
  p.push(
    `On tax, the ${t.recommendedRegime} regime works out cheaper for you by ${inr(t.annualSaving)} a year.`,
  );

  p.push(
    'Review this plan if your income, family situation or goals change materially — and in any case at least once a year.',
  );

  return p.join('\n\n');
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

export type LLMClient = (system: string, user: string) => Promise<string>;

export type NarrativeResult = {
  text: string;
  source: 'llm' | 'fallback';
  validation?: ValidationResult;
  rejectionReason?: string;
  /** Stored for the audit trail — SEBI requires AI use to be disclosable. */
  promptHash: string;
};

async function hash(s: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

export async function generateNarrative(
  plan: RecommendationPlan,
  client?: LLMClient,
): Promise<NarrativeResult> {
  const user = buildUserPrompt(plan);
  const promptHash = await hash(SYSTEM_PROMPT + user);

  if (!client) {
    return { text: fallbackNarrative(plan), source: 'fallback', promptHash, rejectionReason: 'no LLM client configured' };
  }

  let raw: string;
  try {
    raw = await client(SYSTEM_PROMPT, user);
  } catch (err) {
    return {
      text: fallbackNarrative(plan),
      source: 'fallback',
      promptHash,
      rejectionReason: `LLM call failed: ${(err as Error).message}`,
    };
  }

  const validation = validateNarrative(raw, plan);
  if (!validation.ok) {
    const reasons: string[] = [];
    if (validation.offending.length > 0)
      reasons.push(
        `${validation.offending.length} figure(s) not traceable to the plan: ${validation.offending.join(', ')}`,
      );
    if (validation.claimViolations?.length)
      reasons.push(`prohibited claim(s): ${validation.claimViolations.join('; ')}`);
    return {
      text: fallbackNarrative(plan),
      source: 'fallback',
      validation,
      promptHash,
      rejectionReason: `narrative rejected — ${reasons.join(' | ')}`,
    };
  }

  return { text: raw, source: 'llm', validation, promptHash };
}
