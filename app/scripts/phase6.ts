/**
 * Phase 6 checks — the logic that keeps advice current.
 *
 * Everything here is pure, so it runs with nothing installed and no database,
 * in the same style as the engine and core suites. The parts that genuinely
 * need HTTP (reviews, notes, approvals, rate limiting end to end) are asserted
 * by `smoke.ts` instead.
 *
 * The diff tests matter most. A comparison view that under-reports a change is
 * worse than none at all: it tells someone their plan did not move when it did,
 * and they act on that. So the assertions here are about what must be CAUGHT,
 * not just about the module not throwing.
 *
 * Run: node --experimental-strip-types scripts/phase6.ts
 */

import { generatePlan } from '../../engine/src/engine.ts';
import { rohan, household } from '../../engine/fixtures/personas.ts';
import {
  reprofileStatus,
  isMateriallyOverdue,
  detectMaterialChanges,
  REPROFILE_INTERVAL_DAYS,
  REPROFILE_GRACE_DAYS,
} from '../../core/src/profile-store.ts';
import { diffPlans } from '../src/lib/plan-diff.ts';
import { depositBand, DEPOSIT_BANDS } from '../src/lib/adviser-service.ts';
import type { FinancialProfile } from '../../engine/src/types.ts';

const TODAY = '2026-08-18';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`\x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`\x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
  console.log('─'.repeat(70));
}

/** Days before `to`, as an ISO timestamp. */
const daysBefore = (to: string, days: number) =>
  new Date(new Date(to).getTime() - days * 86_400_000).toISOString();

/* ================================================================== */
section('The review clock');

const now = '2027-08-18T00:00:00.000Z';

const fresh = reprofileStatus(daysBefore(now, 10), now);
check('A ten-day-old profile is current', fresh.state === 'current', fresh.state);

const soon = reprofileStatus(daysBefore(now, REPROFILE_INTERVAL_DAYS - 20), now);
check('Twenty days before the anniversary is due_soon', soon.state === 'due_soon', soon.state);
check('…and it says how many days are left', soon.message.includes('20 days'), soon.message);

const boundary = reprofileStatus(daysBefore(now, REPROFILE_INTERVAL_DAYS - 30), now);
check(
  'The warning window opens exactly 30 days out',
  boundary.state === 'due_soon',
  boundary.state,
);

const dayBeforeWindow = reprofileStatus(daysBefore(now, REPROFILE_INTERVAL_DAYS - 31), now);
check(
  'Thirty-one days out is still current',
  dayBeforeWindow.state === 'current',
  dayBeforeWindow.state,
);

const justOverdue = reprofileStatus(daysBefore(now, REPROFILE_INTERVAL_DAYS), now);
check('Day 365 is overdue', justOverdue.state === 'overdue', justOverdue.state);

check(
  'Being one day overdue does NOT demote the plan to historical',
  !isMateriallyOverdue(justOverdue),
  'a client mid-way through acting on a plan should not lose it overnight',
);

const wellOverdue = reprofileStatus(
  daysBefore(now, REPROFILE_INTERVAL_DAYS + REPROFILE_GRACE_DAYS),
  now,
);
check(
  `Past the ${REPROFILE_GRACE_DAYS}-day grace period the plan IS historical`,
  isMateriallyOverdue(wellOverdue),
);

const dayInsideGrace = reprofileStatus(
  daysBefore(now, REPROFILE_INTERVAL_DAYS + REPROFILE_GRACE_DAYS - 1),
  now,
);
check(
  'One day inside the grace period, it is not yet historical',
  !isMateriallyOverdue(dayInsideGrace),
);

check(
  'An overdue message tells the client what it means, not just that it happened',
  justOverdue.message.includes('cannot be relied on'),
  justOverdue.message,
);

/* ================================================================== */
section('Material change detection');

const noChange = detectMaterialChanges(
  rohan as unknown as Record<string, unknown>,
  rohan as unknown as Record<string, unknown>,
);
check('An identical profile reports no material change', noChange.length === 0);

const raised: FinancialProfile = {
  ...rohan,
  income: { ...rohan.income, monthlyTakeHome: Math.round(rohan.income.monthlyTakeHome * 1.25) },
};
const incomeMoved = detectMaterialChanges(
  rohan as unknown as Record<string, unknown>,
  raised as unknown as Record<string, unknown>,
);
check('A 25% pay rise is material', incomeMoved.some((c) => c.includes('Monthly income')), incomeMoved.join('; '));

const nudged: FinancialProfile = {
  ...rohan,
  income: { ...rohan.income, monthlyTakeHome: Math.round(rohan.income.monthlyTakeHome * 1.05) },
};
check(
  'A 5% pay rise is not',
  detectMaterialChanges(
    rohan as unknown as Record<string, unknown>,
    nudged as unknown as Record<string, unknown>,
  ).length === 0,
);

const newChild: FinancialProfile = {
  ...rohan,
  dependents: [
    ...rohan.dependents,
    {
      id: 'new-dependent',
      relationship: 'child',
      age: 0,
      monthlyRequirement: 8000,
      monthlyEducationExpense: 0,
      monthlyMedicalExpense: 1000,
      expectedFutureRequirement: 0,
      yearsOfDependency: 22,
    },
  ],
};
check(
  'A new dependant is material',
  detectMaterialChanges(
    rohan as unknown as Record<string, unknown>,
    newChild as unknown as Record<string, unknown>,
  ).some((c) => c.includes('dependents')),
);

/* ================================================================== */
section('Plan comparison — what must be caught');

const basePlan = generatePlan(rohan, { today: TODAY, advisoryMode: 'advisory' });
const raisedPlan = generatePlan(raised, { today: TODAY, advisoryMode: 'advisory' });

const same = diffPlans(basePlan, basePlan, { profileVersionBefore: 1, profileVersionAfter: 1 });
check('A plan compared with itself reports nothing changed', same.unchanged);
check(
  '…and says so honestly rather than showing an empty page',
  same.causes.some((c) => c.includes('Nothing in your profile')),
  same.causes.join(' '),
);

const raiseDiff = diffPlans(basePlan, raisedPlan, {
  profileVersionBefore: 1,
  profileVersionAfter: 2,
});
check('A 25% pay rise produces a diff', !raiseDiff.unchanged);
check(
  'The cause is attributed to the profile change',
  raiseDiff.causes.some((c) => c.includes('version 1 with version 2')),
  raiseDiff.causes.join(' '),
);
check(
  'The surplus movement is reported',
  raiseDiff.cashflow.some((c) => c.label === 'Free to invest'),
  raiseDiff.cashflow.map((c) => c.label).join(', '),
);
check(
  'A larger income moves the surplus up',
  raiseDiff.cashflow.find((c) => c.label === 'Free to invest')?.direction === 'up',
);
check(
  'The headline is a sentence about the money, not a field list',
  raiseDiff.headline.includes('a month more to work with'),
  raiseDiff.headline,
);

// Materiality floor: a change too small to matter must not generate a line.
const trivial: FinancialProfile = {
  ...rohan,
  income: { ...rohan.income, monthlyTakeHome: rohan.income.monthlyTakeHome + 20 },
};
const trivialDiff = diffPlans(
  basePlan,
  generatePlan(trivial, { today: TODAY, advisoryMode: 'advisory' }),
  { profileVersionBefore: 1, profileVersionAfter: 2 },
);
check(
  'A ₹20 change is suppressed as noise, not reported as news',
  trivialDiff.cashflow.length === 0,
  trivialDiff.cashflow.map((c) => `${c.label} ${c.delta}`).join(', '),
);

// The regulatory gate must not be reported as a change in advice.
const diagnosticPlan = generatePlan(rohan, { today: TODAY, advisoryMode: 'diagnostic_only' });
const modeDiff = diffPlans(diagnosticPlan, basePlan, {
  profileVersionBefore: 1,
  profileVersionAfter: 1,
});
check('Withheld allocation is flagged, not diffed', modeDiff.allocationWithheld);
check(
  '…and produces no allocation rows',
  modeDiff.allocation.length === 0,
  `${modeDiff.allocation.length} rows`,
);
check(
  '…with the mode change named as the cause',
  modeDiff.causes.some((c) => c.includes('now able to show investment recommendations')),
  modeDiff.causes.join(' '),
);

// Goals are matched on id, so a rename is not a delete plus an add.
const renamed: FinancialProfile = {
  ...rohan,
  goals: rohan.goals.map((g, i) => (i === 0 ? { ...g, name: `${g.name} (renamed)` } : g)),
};
const renameDiff = diffPlans(
  basePlan,
  generatePlan(renamed, { today: TODAY, advisoryMode: 'advisory' }),
  { profileVersionBefore: 1, profileVersionAfter: 2 },
);
check(
  'A renamed goal is not reported as one goal removed and another added',
  !renameDiff.goals.some((g) => g.status === 'added' || g.status === 'removed'),
  renameDiff.goals.map((g) => `${g.name}:${g.status}`).join(', '),
);

// A dropped goal must be reported. Silently losing one is the worst failure here.
const fewerGoals: FinancialProfile = { ...rohan, goals: rohan.goals.slice(1) };
const dropDiff = diffPlans(
  basePlan,
  generatePlan(fewerGoals, { today: TODAY, advisoryMode: 'advisory' }),
  { profileVersionBefore: 1, profileVersionAfter: 2 },
);
check(
  'A removed goal is reported',
  dropDiff.goals.some((g) => g.status === 'removed'),
  dropDiff.goals.map((g) => `${g.name}:${g.status}`).join(', '),
);

// A second persona, to be sure none of this is fitted to one household.
const houseA = generatePlan(household, { today: TODAY, advisoryMode: 'advisory' });
const houseB = generatePlan(
  {
    ...household,
    expenses: { ...household.expenses, rentOrHome: Math.round(household.expenses.rentOrHome * 1.4) },
  },
  { today: TODAY, advisoryMode: 'advisory' },
);
const houseDiff = diffPlans(houseA, houseB, { profileVersionBefore: 3, profileVersionAfter: 4 });
check(
  'A 40% rent rise shows up as spending up and surplus down',
  houseDiff.cashflow.find((c) => c.label === 'Total spending')?.direction === 'up' &&
    houseDiff.cashflow.find((c) => c.label === 'Free to invest')?.direction === 'down',
  houseDiff.cashflow.map((c) => `${c.label} ${c.direction}`).join(', '),
);

// The diff must not invent figures — every before/after has to exist in a plan.
const allNumbersReal = raiseDiff.cashflow.every(
  (c) => Number.isFinite(c.before) && Number.isFinite(c.after) && c.delta === c.after - c.before,
);
check('Every reported delta is exactly after − before', allNumbersReal);

/* ================================================================== */
section('Adviser deposit bands');

check('Up to 150 clients sits in the first band', depositBand(150).deposit === '₹1,00,000');
check('The 151st client moves the band', depositBand(151).deposit === '₹2,00,000');
check('Above 1,000 clients is the top band', depositBand(1500).deposit === '₹10,00,000');
check(
  'The warning fires BEFORE the threshold, not after',
  depositBand(140).warning !== null && depositBand(100).warning === null,
  `140: ${depositBand(140).warning ? 'warned' : 'silent'}, 100: ${depositBand(100).warning ? 'warned' : 'silent'}`,
);
check(
  'The warning names the next deposit amount',
  depositBand(145).warning?.includes('₹2,00,000') === true,
  depositBand(145).warning ?? 'none',
);
check(
  'The top band has no next threshold to warn about',
  depositBand(5000).warning === null && depositBand(5000).nextDeposit === null,
);
check(
  'The bands are ordered and exhaustive',
  DEPOSIT_BANDS[DEPOSIT_BANDS.length - 1].upTo === Infinity &&
    DEPOSIT_BANDS.every((b, i) => i === 0 || b.upTo > DEPOSIT_BANDS[i - 1].upTo),
);

/* ================================================================== */
section('Google sign-in');

// Configured from the environment, so set it up for the duration of the check.
const savedId = process.env.GOOGLE_CLIENT_ID;
const savedSecret = process.env.GOOGLE_CLIENT_SECRET;
const savedUrl = process.env.APP_URL;
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.APP_URL = 'http://localhost:3000';

const oauth = await import('../src/lib/oauth-google.ts');
const cfg = oauth.googleConfig()!;

check('Config assembles from the environment', !!cfg);
check(
  'The redirect URI is derived from APP_URL, not hardcoded',
  cfg.redirectUri === 'http://localhost:3000/api/auth/google/callback',
  cfg.redirectUri,
);

const first = oauth.beginAuth(cfg);
const authUrl = new URL(first.url);
check('Sends the browser to accounts.google.com', authUrl.host === 'accounts.google.com');
check('Requests the openid scope', (authUrl.searchParams.get('scope') ?? '').includes('openid'));
check('Carries a state parameter', (authUrl.searchParams.get('state') ?? '').length > 30);
check('Carries a nonce', (authUrl.searchParams.get('nonce') ?? '').length > 30);
check('state and nonce are independent values', first.state !== first.nonce);
check(
  'Forces the account chooser rather than reusing a session',
  authUrl.searchParams.get('prompt') === 'select_account',
  'on a shared machine, signing in as whoever was last here is a bad default',
);

const second = oauth.beginAuth(cfg);
check('Every attempt mints fresh values', first.state !== second.state && first.nonce !== second.nonce);

check('A matching state is accepted', oauth.stateMatches(oauth.hashPending(first.state), oauth.hashPending(first.state)));
check(
  'A state from a different attempt is rejected',
  !oauth.stateMatches(oauth.hashPending(first.state), oauth.hashPending(second.state)),
  'this is what stops an attacker feeding their own code into someone else\'s browser',
);
check(
  'A truncated state is rejected',
  !oauth.stateMatches(oauth.hashPending(first.state), oauth.hashPending(first.state).slice(0, -2)),
);
check('The cookie stores a hash, never the state itself', oauth.hashPending(first.state) !== first.state);

delete process.env.GOOGLE_CLIENT_ID;
check(
  'An unconfigured deployment reports Google as unavailable',
  !oauth.googleEnabled(),
  'so the button hides rather than leading somewhere broken',
);

process.env.GOOGLE_CLIENT_ID = savedId;
process.env.GOOGLE_CLIENT_SECRET = savedSecret;
process.env.APP_URL = savedUrl;

/* ================================================================== */
console.log('\n' + '─'.repeat(70));
if (fail === 0) {
  console.log(`\x1b[32m${pass} passed, 0 failed\x1b[0m`);
} else {
  console.log(`\x1b[31m${pass} passed, ${fail} failed\x1b[0m`);
  for (const f of failures) console.log(`  ${f}`);
}
process.exit(fail === 0 ? 0 : 1);
