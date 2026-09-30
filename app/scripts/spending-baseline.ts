/**
 * Calibrate the Spending step's opening sketch against the nine test households.
 *
 *   npm run check:spending
 *
 * The sketch in `spending-baseline.ts` is a set of proportional heuristics, and
 * the only honest way to keep them honest is to look at what they produce for
 * households whose real spending we know. This prints the comparison and fails
 * on the two errors that matter:
 *
 *   too high — the sketch opens by telling somebody they are already in deficit,
 *              which is both alarming and usually wrong;
 *   too low  — the sketch anchors a surplus that does not exist, which is the
 *              more dangerous direction, because an overstated surplus produces
 *              a plan nobody can follow.
 *
 * The per-persona gap is printed but deliberately NOT asserted. Nine fixtures
 * are far too few to tune against, and a model fitted to them would be a model
 * fitted to nine people rather than to Indian households. Read the column; do
 * not optimise it.
 */
import { estimateSpending, type SpendingBasis } from '../src/lib/spending-baseline.ts';
import { ALL_PERSONAS } from '../../engine/fixtures/personas.ts';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
let failures = 0;

console.log(
  'persona'.padEnd(19),
  'take-home'.padStart(12),
  'sketch/mo'.padStart(12),
  'of income'.padStart(10),
  'actual/mo'.padStart(12),
  'gap'.padStart(10),
);

for (const { key, profile } of ALL_PERSONAS) {
  const basis: SpendingBasis = {
    monthlyTakeHome: profile.income.monthlyTakeHome,
    cityTier: profile.personal.cityTier as SpendingBasis['cityTier'],
    familyMembers: profile.personal.familyMembers,
    dependentMembers: profile.personal.dependentMembers,
  };
  if (basis.monthlyTakeHome <= 0) {
    console.log(key.padEnd(19), 'no take-home — portrait not offered');
    continue;
  }

  const e = estimateSpending(basis);
  const monthly = Object.entries(e)
    .filter(([k]) => k !== 'annualIrregular')
    .reduce((s, [, v]) => s + v, 0) + Math.round(e.annualIrregular / 12);

  const actual = Object.entries(profile.expenses)
    .filter(([k]) => k !== 'annualIrregular')
    .reduce((s, [, v]) => s + (v as number), 0) +
    Math.round((profile.expenses.annualIrregular as number) / 12);

  const share = monthly / basis.monthlyTakeHome;
  const gap = actual > 0 ? (monthly - actual) / actual : 0;

  console.log(
    key.padEnd(19),
    inr(basis.monthlyTakeHome).padStart(12),
    inr(monthly).padStart(12),
    (share * 100).toFixed(0).padStart(9) + '%',
    inr(actual).padStart(12),
    (gap >= 0 ? '+' : '') + (gap * 100).toFixed(0).padStart(9) + '%',
  );

  // The sketch must never open by telling somebody they are already in deficit.
  if (share > 0.95) {
    console.log(`   ✗ ${key}: sketch is ${(share * 100).toFixed(0)}% of income — opens in deficit`);
    failures++;
  }
  // Nor may it be so low that it anchors a fantasy surplus.
  if (share < 0.35) {
    console.log(`   ✗ ${key}: sketch is only ${(share * 100).toFixed(0)}% of income — anchors too low`);
    failures++;
  }
}

console.log('\n' + (failures === 0 ? '✓ every sketch lands in a plausible band' : `✗ ${failures} problem(s)`));
process.exit(failures === 0 ? 0 : 1);
