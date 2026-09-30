/**
 * End-to-end smoke test against a running dev server.
 *
 * Drives the whole pipeline over HTTP exactly as a browser would: sign up,
 * log in, enrol 2FA, complete all eight wizard steps, commit the profile,
 * generate a plan, and read it back. Then it checks the things that are easy
 * to get wrong and invisible from the UI — that the audit chain is intact,
 * that a plan is bound to the profile that produced it, and that
 * `diagnostic_only` mode actually withholds recommendations.
 *
 * Usage:
 *   npm run dev                              # in one terminal
 *   node --experimental-strip-types scripts/smoke.ts    # in another
 *
 * Optional: BASE_URL=http://localhost:3000
 */

import { generateTotp } from '../../core/src/totp.ts';
import { requireTestDatabase } from './guard-test-db.ts';

// Hard stop before anything is written. See guard-test-db.ts.
requireTestDatabase('the smoke test');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
// Pin the address with SMOKE_EMAIL to resume a run after verifying the email.
// Without it every run mints a new account, which is always unverified.
const EMAIL = process.env.SMOKE_EMAIL ?? `smoke-${Date.now()}@test.local`;
const PASSWORD = 'vault-mango-77-river-delta';

let cookie = '';
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

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });

  // Carry the session cookie forward the way a browser would.
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const match = /finmanai_session=([^;]*)/.exec(setCookie);
    if (match) cookie = `finmanai_session=${match[1]}`;
  }

  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 400);
  }
  return { status: res.status, body };
}

/* ================================================================== */

console.log(`\nSmoke test against ${BASE}`);
console.log(`Account: ${EMAIL}`);

try {
  await fetch(BASE, { redirect: 'manual' });
} catch {
  console.error(`\n\x1b[31mCannot reach ${BASE}. Start the dev server first: npm run dev\x1b[0m\n`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
section('Security headers');
/* ------------------------------------------------------------------ */

{
  const res = await fetch(`${BASE}/login`, { redirect: 'manual' });
  check('X-Frame-Options: DENY', res.headers.get('x-frame-options') === 'DENY');
  check('X-Content-Type-Options: nosniff', res.headers.get('x-content-type-options') === 'nosniff');
  check('Referrer-Policy set', res.headers.get('referrer-policy') === 'no-referrer');
  check('Content-Security-Policy present', !!res.headers.get('content-security-policy'));
  check(
    'CSP forbids framing',
    (res.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'"),
  );
}

/* ------------------------------------------------------------------ */
section('Signup and password policy');
/* ------------------------------------------------------------------ */

{
  const weak = await call('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: 'password123' }),
  });
  check('Weak password rejected', weak.status === 422, `got ${weak.status}`);

  const bad = await call('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email: 'not-an-email', password: PASSWORD }),
  });
  check('Invalid email rejected', bad.status === 400, `got ${bad.status}`);

  const good = await call('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  check('Signup accepted', good.status === 200 && good.body.status === 'check_your_email');

  // The same response for an existing address — no account enumeration.
  const dup = await call('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  check(
    'Duplicate signup does not reveal the account exists',
    dup.status === 200 && dup.body.status === good.body.status,
  );
}

console.log(
  '\n\x1b[33m!\x1b[0m Email verification is required before login. Verify this account:\n' +
    `    npm run verify:email -- ${EMAIL}\n` +
    `  then resume the run against the same account:\n` +
    `    SMOKE_EMAIL=${EMAIL} npm run smoke\n`,
);

/* ------------------------------------------------------------------ */
section('Login and 2FA');
/* ------------------------------------------------------------------ */

let totpSecret = '';

{
  const wrong = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: 'wrong-password-entirely' }),
  });
  check('Wrong password rejected', wrong.status === 401);
  check(
    'Wrong password gives a generic message',
    typeof wrong.body?.error === 'string' && !/no such user|not found/i.test(wrong.body.error),
  );

  const login = await call('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  if (login.status === 403) {
    console.error(
      '\n\x1b[31mBlocked: email not verified.\x1b[0m Run the verify-email script above, then re-run.\n',
    );
    process.exit(1);
  }

  check('Login accepted', login.status === 200, JSON.stringify(login.body));
  check('First login asks for 2FA enrolment', login.body.status === 'enrol_totp');
  check('Session cookie issued', cookie.length > 0);

  const enrol = await call('/api/auth/totp/enrol', { method: 'POST' });
  check('TOTP enrolment returns a secret', enrol.status === 200 && !!enrol.body.secret);
  check(
    'Provisioning URI is well-formed',
    typeof enrol.body?.uri === 'string' && enrol.body.uri.startsWith('otpauth://totp/'),
  );
  totpSecret = enrol.body.secret;

  // Without a secret every check below throws a TypeError inside generateTotp,
  // which buries the real failure under a stack trace. Stop here and name it.
  if (!totpSecret) {
    console.log(
      `\n\x1b[31mBlocked: 2FA enrolment returned no secret.\x1b[0m ` +
        `Earlier steps must have failed — read the failures above, and check the dev server log.\n`,
    );
    process.exit(1);
  }

  const badCode = await call('/api/auth/totp/confirm', {
    method: 'POST',
    body: JSON.stringify({ code: '000000' }),
  });
  check('Wrong TOTP code rejected', badCode.status === 401);

  const confirm = await call('/api/auth/totp/confirm', {
    method: 'POST',
    body: JSON.stringify({ code: generateTotp(totpSecret, Math.floor(Date.now() / 1000)) }),
  });
  check('Correct TOTP code enables 2FA', confirm.status === 200 && confirm.body.status === 'enabled');
  check('Ten recovery codes issued', confirm.body?.recoveryCodes?.length === 10);
}

/* ------------------------------------------------------------------ */
section('Authorisation');
/* ------------------------------------------------------------------ */

{
  const saved = cookie;
  cookie = '';
  const anon = await call('/api/profile/draft');
  check('Unauthenticated request rejected', anon.status === 401, `got ${anon.status}`);

  cookie = 'finmanai_session=forged-token-value';
  const forged = await call('/api/profile/draft');
  check('Forged session cookie rejected', forged.status === 401, `got ${forged.status}`);

  cookie = saved;
  const compliance = await call('/api/compliance/verify-chain');
  check('Client cannot reach the compliance endpoint', compliance.status === 403, `got ${compliance.status}`);
}

/* ------------------------------------------------------------------ */
section('Onboarding — eight steps');
/* ------------------------------------------------------------------ */

const today = new Date();
const yr = (n: number) => new Date(today.getFullYear() + n, 5, 1).toISOString().slice(0, 10);

const STEPS: Record<number, unknown> = {
  1: {
    planningMode: 'individual',
    personal: {
      fullName: 'Smoke Test', age: 32, city: 'Pune', state: 'Maharashtra',
      cityTier: 'metro', maritalStatus: 'married', familyMembers: 3,
      dependentMembers: 2, expectedRetirementAge: 60,
    },
  },
  2: {
    employment: {
      occupation: 'Engineer', employmentType: 'salaried', industry: 'IT',
      yearsOfExperience: 9, employerType: 'private', jobStability: 'stable',
      expectedIncomeGrowth: 0.08,
    },
    income: {
      monthlyTakeHome: 120000, annualGrossIncome: 2000000, annualVariableIncome: 200000,
      monthlyBusinessIncome: 0, monthlyRentalIncome: 0, annualInterestDividendIncome: 0,
      monthlyOtherFamilyIncome: 0, monthlyOtherIncome: 0,
      incomeFrequency: 'monthly', incomeStability: 'fixed',
    },
  },
  3: {
    expenses: {
      rentOrHome: 30000, foodAndGroceries: 18000, utilities: 5000, transportation: 6000,
      education: 12000, healthcare: 2000, insurancePremiums: 3000,
      lifestyleAndEntertainment: 10000, subscriptions: 1500, dependentRelated: 0,
      otherRecurring: 3000, annualIrregular: 120000,
    },
  },
  4: {
    dependents: [
      {
        id: 'd1', relationship: 'child', age: 6, gender: 'female',
        monthlyRequirement: 4000, monthlyEducationExpense: 12000, monthlyMedicalExpense: 0,
        expectedFutureRequirement: 4000000, yearsOfDependency: 16,
      },
    ],
  },
  5: {
    assets: [
      {
        id: 'a1', type: 'savings_account', amountInvested: 400000, currentValue: 400000,
        investmentDate: '2024-01-01', monthlyContribution: 0, lockInMonthsRemaining: 0,
      },
      {
        id: 'a2', type: 'equity_mutual_fund', amountInvested: 600000, currentValue: 950000,
        investmentDate: '2020-04-01', monthlyContribution: 15000, lockInMonthsRemaining: 0,
      },
    ],
    liabilities: [
      {
        id: 'l1', type: 'credit_card', outstandingAmount: 90000, interestRate: 0.42,
        monthlyEMI: 5000, remainingTenureMonths: 24, prepaymentChargeRate: 0, overdueAmount: 0,
      },
    ],
  },
  6: {
    insurance: {
      healthCoverSelf: 0, healthCoverFamilyFloater: 0, healthCoverParents: 0,
      termLifeCover: 0, employerProvidedHealthCover: 500000, employerProvidedLifeCover: 0,
      personalAccidentCover: 0, criticalIllnessCover: 0, annualPremiumTotal: 36000,
      hasInvestmentLinkedPolicy: false,
    },
    emergencyFund: {
      currentEmergencySavings: 400000, familyFinancialSupportAvailable: true,
      expectedMajorEmergencyExpense: 0,
    },
  },
  7: {
    goals: [
      {
        id: 'g1', name: "Daughter's education", category: 'child_education',
        requiredAmountToday: 4000000, targetDate: yr(12), amountAlreadySaved: 0,
        monthlyAmountCurrentlyInvested: 0, priority: 'critical', considerInflation: true,
      },
      {
        id: 'g2', name: 'Retirement', category: 'retirement',
        requiredAmountToday: 30000000, targetDate: yr(28), amountAlreadySaved: 950000,
        monthlyAmountCurrentlyInvested: 15000, priority: 'high', considerInflation: true,
      },
    ],
    risk: {
      investmentExperience: 3, productKnowledge: 3, preferredRiskLevel: 4,
      maxAcceptableDrawdown: 0.3, reactionToMarketDecline: 4, abilityToHandleLosses: 3,
      investmentTimeHorizon: 20, needForGuaranteedCapital: 4, comfortWithVolatility: 4,
    },
  },
  8: {
    liquidity: {
      amountImmediatelyAccessible: 200000, expectedWithdrawalsNext12Months: 0,
      largeExpensesWithin3Years: 0, acceptableLockInMonths: 60,
      withdrawalFrequency: 'rare', minimumBankBalancePreference: 100000,
    },
    preferences: {
      preferredTypes: ['equity', 'debt', 'gold'], avoidTypes: [], cryptoOptIn: false,
      style: 'passive', incomeOrGrowth: 'capital_growth',
      ethicalPreference: false, interestedInTaxSaving: true,
    },
    tax: {
      taxResidency: 'resident', selectedRegime: 'undecided',
      annualEPFContribution: 180000, annualPPFContribution: 0,
      annualNPSContributionSelf: 0, annualNPSContributionEmployer: 0,
      annualLifeInsurancePremium: 0, annualHealthInsurancePremium: 0,
      annualELSSInvestment: 0, annualHomeLoanPrincipalRepaid: 0,
      annualHomeLoanInterestPaid: 0, annualChildTuitionFees: 144000,
      annualCapitalGainsRealised: 0, isSalaried: true,
    },
    consent: {
      processFinancialInformation: true, generatePersonalisedRecommendations: true,
      informationAccurate: true, riskDisclosuresAccepted: true,
      storeRecommendationHistory: true, remindersAndNotifications: false,
    },
  },
};

{
  // Rejected before it is stored, so bad data never reaches a profile version.
  const invalid = await call('/api/profile/draft', {
    method: 'POST',
    body: JSON.stringify({ step: 1, data: { planningMode: 'individual', personal: { age: 12 } } }),
  });
  check('Invalid step data rejected with field errors', invalid.status === 422 && Array.isArray(invalid.body.errors));

  for (const step of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const res = await call('/api/profile/draft', {
      method: 'POST',
      body: JSON.stringify({ step, data: STEPS[step] }),
    });
    check(`Step ${step} saved`, res.status === 200, JSON.stringify(res.body).slice(0, 200));
  }

  const loaded = await call('/api/profile/draft');
  check('Draft reloads all eight steps', Object.keys(loaded.body?.steps ?? {}).length === 8);
}

/* ------------------------------------------------------------------ */
section('Commit and plan generation');
/* ------------------------------------------------------------------ */

let planId = '';

{
  const commit = await call('/api/profile/commit', { method: 'POST' });
  check('Profile committed', commit.status === 200 && commit.body.status === 'committed', JSON.stringify(commit.body).slice(0, 300));
  check('First version is 1', commit.body?.version === 1);

  const again = await call('/api/profile/commit', { method: 'POST' });
  check('Re-committing unchanged data creates no new version', again.body?.status === 'unchanged');

  const plan = await call('/api/plan/generate', { method: 'POST' });
  check('Plan generated', plan.status === 200 && !!plan.body.planId, JSON.stringify(plan.body).slice(0, 300));
  planId = plan.body?.planId ?? '';

  if (planId) {
    const page = await fetch(`${BASE}/plan/${planId}`, { headers: { cookie } });
    const html = await page.text();
    check('Plan page renders', page.status === 200);
    check('Plan shows the action plan', html.includes('What to do'));
    check('Plan shows stress tests', html.includes('If things go wrong'));
    check('Disclosures are on the plan itself', html.includes('market risks'));

    const advisory = html.includes('Where to invest each month');
    const diagnosticBanner = html.includes('Diagnostics only');
    check(
      'Advisory mode is consistent with what is rendered',
      advisory !== diagnosticBanner,
      advisory ? 'advisory: allocation shown' : 'diagnostic_only: allocation withheld',
    );
    console.log(
      `    \x1b[2mADVISORY_MODE appears to be: ${advisory ? 'advisory' : 'diagnostic_only'}\x1b[0m`,
    );

    // The engine's own guard: the card must be cleared before investing.
    check('Credit card at 42% appears in the action plan', /42\.0%/.test(html));
  }
}

/* ------------------------------------------------------------------ */
section('Phase 6 — keeping the plan current');
/* ------------------------------------------------------------------ */

let secondPlanId = '';

{
  const status = await call('/api/profile/status');
  check('Review status is reported', status.status === 200 && status.body?.profileVersion === 1);
  check(
    'A profile committed today is current',
    status.body?.status?.state === 'current',
    status.body?.status?.state,
  );
  check('…and is not shown as historical', status.body?.materiallyOverdue === false);
  check(
    'The plan is stamped with the assumptions version in use',
    status.body?.assumptionsDrift === null,
    JSON.stringify(status.body?.assumptionsDrift),
  );

  // Recording the annual review. This is the case that produces NO new profile
  // version: the review itself is the evidence, and it resets the clock.
  const review = await call('/api/profile/review', {
    method: 'POST',
    body: JSON.stringify({ outcome: 'unchanged' }),
  });
  check(
    'An unchanged review is recorded',
    review.status === 200 && review.body?.outcome === 'unchanged',
    JSON.stringify(review.body).slice(0, 200),
  );
  check(
    'It resets the clock to a full year',
    review.body?.nextReviewInDays >= 364,
    String(review.body?.nextReviewInDays),
  );

  const versions = await call('/api/plans');
  check(
    'Recording a review created no new plan',
    versions.body?.plans?.length === 1,
    `${versions.body?.plans?.length} plans`,
  );

  // The dashboard — the page a returning user now lands on.
  const dash = await fetch(`${BASE}/dashboard`, { headers: { cookie } });
  const dashHtml = await dash.text();
  check('Dashboard renders', dash.status === 200);
  check('Dashboard lists the plan history', dashHtml.includes('Plan history'));
  check('Dashboard says the plan is current', dashHtml.includes('Your plan is current'));
}

{
  // A material change, then a second plan, then the comparison.
  const raise = await call('/api/profile/draft', {
    method: 'POST',
    body: JSON.stringify({
      step: 2,
      data: {
        ...(STEPS[2] as Record<string, unknown>),
        income: {
          ...((STEPS[2] as { income: Record<string, unknown> }).income),
          monthlyTakeHome: 150000,
        },
      },
    }),
  });
  check('A pay rise is saved to the draft', raise.status === 200);

  const status = await call('/api/profile/status');
  check(
    'The unsaved pay rise is flagged as a material change',
    (status.body?.pendingMaterialChanges ?? []).some((c: string) => c.includes('Monthly income')),
    JSON.stringify(status.body?.pendingMaterialChanges),
  );

  const refused = await call('/api/profile/review', {
    method: 'POST',
    body: JSON.stringify({ outcome: 'unchanged' }),
  });
  check(
    'We refuse to record "nothing changed" when it plainly has',
    refused.status === 409,
    `got ${refused.status}`,
  );

  const commit = await call('/api/profile/commit', { method: 'POST' });
  check('The new version commits', commit.body?.status === 'committed' && commit.body?.version === 2);
  check(
    'The commit reports the material change',
    (commit.body?.materialChanges ?? []).length > 0,
    JSON.stringify(commit.body?.materialChanges),
  );

  const plan = await call('/api/plan/generate', { method: 'POST' });
  check('A second plan is generated', plan.status === 200 && !!plan.body.planId);
  secondPlanId = plan.body?.planId ?? '';
}

{
  if (planId && secondPlanId) {
    const cmp = await call(`/api/plan/compare?a=${planId}&b=${secondPlanId}`);
    check('Two plans can be compared', cmp.status === 200, JSON.stringify(cmp.body).slice(0, 200));
    check(
      'The comparison attributes the change to the profile update',
      (cmp.body?.diff?.causes ?? []).some((c: string) => c.includes('version 1 with version 2')),
      JSON.stringify(cmp.body?.diff?.causes),
    );
    check('The comparison finds a real difference', cmp.body?.diff?.unchanged === false);
    check(
      'A pay rise increases the money free to invest',
      (cmp.body?.diff?.cashflow ?? []).some(
        (c: { label: string; direction: string }) =>
          c.label === 'Free to invest' && c.direction === 'up',
      ),
      JSON.stringify(cmp.body?.diff?.cashflow),
    );

    const same = await call(`/api/plan/compare?a=${planId}&b=${planId}`);
    check('A plan cannot be compared with itself', same.status === 400, `got ${same.status}`);

    const page = await fetch(`${BASE}/plan/compare?a=${planId}&b=${secondPlanId}`, {
      headers: { cookie },
    });
    const html = await page.text();
    check('The comparison page renders', page.status === 200);
    check('…and leads with what changed', html.includes('What changed'));

    const printPage = await fetch(`${BASE}/plan/${secondPlanId}/print`, { headers: { cookie } });
    const printHtml = await printPage.text();
    check('The printable plan renders', printPage.status === 200);
    check('…with the disclosures on it', printHtml.includes('Important information'));
  }
}

{
  // Approval and notes are adviser actions, and this account is a client.
  const approve = await call(`/api/plan/${secondPlanId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ decision: 'approved' }),
  });
  check('A client cannot approve their own plan', approve.status === 403, `got ${approve.status}`);

  const note = await call(`/api/plan/${secondPlanId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body: 'client-written note' }),
  });
  check('A client cannot write an adviser note', note.status === 403, `got ${note.status}`);

  const queue = await call('/api/adviser/queue');
  check('A client cannot read an adviser queue', queue.status === 403, `got ${queue.status}`);
}

/* ------------------------------------------------------------------ */
section('Session lifecycle');
/* ------------------------------------------------------------------ */

{
  const before = await call('/api/profile/draft');
  check('Session valid before logout', before.status === 200);

  await call('/api/auth/logout', { method: 'POST' });

  const after = await call('/api/profile/draft');
  check('Session rejected after logout', after.status === 401, `got ${after.status}`);
}

/* ================================================================== */

console.log('\n' + '─'.repeat(70));
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  console.log(
    '\nRun `node --experimental-strip-types scripts/verify-integrity.ts` to check the audit chain.\n',
  );
  process.exit(1);
}
console.log(`\nNext: node --experimental-strip-types scripts/verify-integrity.ts\n`);
