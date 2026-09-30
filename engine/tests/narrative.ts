/**
 * Tests for the narrative guard.
 *
 * The question these answer: if the language model hallucinates a number,
 * does the system actually stop it — or does it just say it will?
 *
 * Run: node --experimental-strip-types tests/narrative.ts
 */

import { generatePlan } from '../src/engine.ts';
import { rohan } from '../fixtures/personas.ts';
import { generateNarrative, validateNarrative, fallbackNarrative } from '../src/narrative.ts';
import type { LLMClient } from '../src/narrative.ts';

const TODAY = '2026-08-18';
const plan = generatePlan(rohan, { today: TODAY });

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    pass++;
    console.log(`\x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    console.log(`\x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('\n\x1b[1mNarrative guard\x1b[0m');
console.log('─'.repeat(72));

/* 1. A model that invents a return figure must be caught. */
const hallucinating: LLMClient = async () =>
  'Your portfolio should comfortably return 15.7% a year, which means your retirement corpus will reach ₹18,40,00,000 by 2055. We recommend the HDFC Flexi Cap Fund.';

const r1 = await generateNarrative(plan, hallucinating);
check('Hallucinated return figure is rejected', r1.source === 'fallback', r1.rejectionReason);
check(
  'Rejection names the invented corpus figure and the named fund house',
  (r1.rejectionReason ?? '').includes('18,40,00,000') && (r1.rejectionReason ?? '').includes('HDFC'),
  r1.rejectionReason,
);

/* 1b. Claim-level guards catch language that numeric checking cannot.
   A hallucinated "15.7% return" can coincide with a real 15.7% allocation
   slice — same digits, different meaning — so phrasing is policed separately. */
const claimCases: { name: string; text: string }[] = [
  { name: 'guaranteed returns', text: 'This portfolio offers guaranteed returns over the long run.' },
  { name: 'certain future outcome', text: 'Your corpus will definitely reach the target you set.' },
  { name: 'denies risk', text: 'This approach is a safe bet with no risk to your capital.' },
  { name: 'names a fund house', text: 'Consider the Parag Parikh flexi cap option for this sleeve.' },
];
for (const c of claimCases) {
  const res = await generateNarrative(plan, async () => c.text);
  check(`Claim guard catches: ${c.name}`, res.source === 'fallback', res.rejectionReason);
}

/* 2. A narrative built only from plan figures must pass. */
const surplus = plan.derived.investableSurplus;
const income = plan.derived.plannableMonthlyIncome;
const faithful: LLMClient = async () =>
  `Of your monthly income of ${income}, about ${surplus} is free after expenses and EMIs. ` +
  `Your risk band caps equity at ${plan.riskProfile.equityCeiling * 100}%. Start with the credit card.`;

const r2 = await generateNarrative(plan, faithful);
check('Faithful narrative passes validation', r2.source === 'llm', r2.rejectionReason);

/* 3. Rupee figures written with Indian comma grouping must be recognised. */
const grouped: LLMClient = async () =>
  `You have ₹${surplus.toLocaleString('en-IN')} free each month, and your emergency fund target is ₹${plan.derived.emergencyFundTarget.toLocaleString('en-IN')}.`;
const r3 = await generateNarrative(plan, grouped);
check('Indian-format rupee figures are recognised', r3.source === 'llm', r3.rejectionReason);

/* 4. Rounded restatements ("about ₹26,000") must be allowed. */
const rounded: LLMClient = async () =>
  `That leaves roughly ₹${(Math.round(surplus / 1000) * 1000).toLocaleString('en-IN')} a month to invest.`;
const r4 = await generateNarrative(plan, rounded);
check('Sensible rounding is allowed', r4.source === 'llm', r4.rejectionReason);

/* 5. Lakh/crore phrasing must be allowed. */
const inLakh: LLMClient = async () =>
  `Your emergency fund target is about ${(plan.derived.emergencyFundTarget / 100000).toFixed(2)} lakh.`;
const r5 = await generateNarrative(plan, inLakh);
check('Lakh/crore phrasing is allowed', r5.source === 'llm', r5.rejectionReason);

/* 6. A subtly wrong figure — one digit off — must still be caught. */
const subtle: LLMClient = async () => `You have ₹${(surplus + 1111).toLocaleString('en-IN')} free each month.`;
const r6 = await generateNarrative(plan, subtle);
check('A subtly altered figure is still caught', r6.source === 'fallback', r6.rejectionReason);

/* 7. A failing LLM call must not break the product. */
const broken: LLMClient = async () => {
  throw new Error('502 upstream');
};
const r7 = await generateNarrative(plan, broken);
check('LLM outage falls back cleanly', r7.source === 'fallback' && r7.text.length > 200);

/* 8. No client configured at all. */
const r8 = await generateNarrative(plan);
check('Works with no LLM configured', r8.source === 'fallback' && r8.text.length > 200);

/* 9. The fallback itself must pass its own validator — it quotes plan figures. */
const selfCheck = validateNarrative(fallbackNarrative(plan), plan);
check('Fallback narrative passes the validator', selfCheck.ok, selfCheck.offending.join(', '));

/* 10. Every prompt is hashed for the audit trail. */
check('Prompt hash recorded for audit', typeof r1.promptHash === 'string' && r1.promptHash.length === 16);

/* 11. No PII leaves the system in the prompt. */
const { buildUserPrompt } = await import('../src/narrative.ts');
const promptText = buildUserPrompt(plan);
check(
  'Prompt contains no name, city or profile identifiers',
  !promptText.includes(rohan.personal.fullName) && !promptText.includes(rohan.personal.city),
);

console.log('─'.repeat(72));
console.log(`${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
