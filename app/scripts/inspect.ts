/**
 * Read what is actually stored, decrypted.
 *
 * Prisma Studio and psql show you the rows, which for this application means
 * they show you `v1.v1.xRnlO3s…` — an AES-256-GCM envelope. Profiles, plans and
 * adviser notes are encrypted at rest, so the one thing you usually want to see
 * is the one thing those tools cannot render. Hence this.
 *
 * **A note on the audit trail.** This tool does not write an audit event, and
 * that is deliberate rather than an oversight. Anyone holding the database
 * credentials and the field key can already read these rows with psql and a
 * dozen lines of Node; an event written here would suggest a completeness the
 * application cannot actually provide, and a control that gives false assurance
 * is worse than an absent one. The audit chain's job is to prove nothing was
 * *changed*. Reads by an operator at the database level sit outside it, which is
 * why database credentials are held narrowly in the first place.
 *
 * Read-only. It opens no write path at all.
 *
 * Usage:
 *   npm run inspect                      # who is in the database
 *   npm run inspect -- <email>           # one person, in full
 *   npm run inspect -- <email> --table   # the plan as tables
 *   npm run inspect -- <email> --raw     # the complete decrypted JSON
 */

import './env.ts';
import { decryptField } from '../../core/src/field-crypto.ts';
import { verifyChain } from '../../core/src/audit.ts';
import type { AuditEvent, AuditAction } from '../../core/src/audit.ts';
import type { FinancialProfile, RecommendationPlan } from '../../engine/src/types.ts';
import { table } from '../src/lib/table.ts';
import { keyRing } from '../src/lib/keys.ts';
import { prisma } from '../src/lib/db.ts';

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const asTable = args.includes('--table');
const email = args.find((a) => !a.startsWith('--'));

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const dt = (d: Date) => d.toLocaleString('en-IN');
const rule = () => console.log('─'.repeat(72));
const head = (s: string) => {
  console.log(`\n\x1b[1m${s}\x1b[0m`);
  rule();
};

const db = /\/([^/?]+)(\?|$)/.exec(process.env.DATABASE_URL ?? '')?.[1] ?? 'unknown';

/* ------------------------------------------------------------------ */
/* No argument — who is in here                                        */
/* ------------------------------------------------------------------ */

if (!email) {
  head(`Accounts in "${db}"`);
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      email: true, role: true, emailVerified: true, totpEnabled: true,
      createdAt: true, lastLoginAt: true, deletedAt: true,
      _count: { select: { profiles: true, drafts: true, consents: true } },
    },
  });

  if (users.length === 0) {
    console.log('None. Sign up at http://localhost:3000/signup');
  } else {
    console.log(
      table(
        [
          { header: 'Email', maxWidth: 34 },
          { header: 'Role' },
          { header: 'Verified' },
          { header: '2FA' },
          { header: 'Versions', align: 'right' },
          { header: 'Joined' },
        ],
        users.map((u) => [
          u.email + (u.deletedAt ? ' (deleted)' : ''),
          u.role.toLowerCase(),
          u.emailVerified ? 'yes' : 'NO',
          u.totpEnabled ? 'on' : 'NOT SET',
          String(u._count.profiles),
          dt(u.createdAt),
        ]),
      ),
    );
  }

  const [profiles, planCount, events] = await Promise.all([
    prisma.profile.count(), prisma.plan.count(), prisma.auditEvent.count(),
  ]);
  console.log(`Totals: ${profiles} profile version(s), ${planCount} plan(s), ${events} audit event(s).`);
  console.log(`\nOne person in full:  npm run inspect -- <email>`);
  await prisma.$disconnect();
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* One person, decrypted                                               */
/* ------------------------------------------------------------------ */

const user = await prisma.user.findUnique({
  where: { email: email.toLowerCase() },
  include: {
    profiles: { orderBy: { version: 'desc' } },
    consents: { orderBy: { acceptedAt: 'desc' } },
    drafts: true,
    reviews: { orderBy: { reviewedAt: 'desc' } },
  },
});

if (!user) {
  console.error(`No account for "${email}" in "${db}".\n\nWho is here:  npm run inspect`);
  await prisma.$disconnect();
  process.exit(1);
}

const ring = keyRing();

console.log(`\n\x1b[2mdatabase: ${db}\x1b[0m`);
console.log('\x1b[33m! This prints a complete financial position to your terminal.\x1b[0m');

head('Account');
console.log(`${user.email}
  role            ${user.role}
  email verified  ${user.emailVerified ? dt(user.emailVerified) : 'NO'}
  2FA             ${user.totpEnabled ? 'enabled' : 'not set up'}
  joined          ${dt(user.createdAt)}
  last login      ${user.lastLoginAt ? dt(user.lastLoginAt) : 'never'}
  failed attempts ${user.failedAttempts}${user.lockedUntil ? ` · locked until ${dt(user.lockedUntil)}` : ''}`);

if (user.drafts.length > 0) {
  head(`Wizard drafts — ${user.drafts.length} step(s) saved`);
  console.log(
    '  Drafts are working state, not a record of advice. They are overwritten freely\n' +
      '  and are what the wizard reloads when someone returns to amend an answer.\n',
  );
  for (const d of user.drafts.sort((a, b) => a.step - b.step)) {
    const data = JSON.parse(decryptField(d.data, ring, `draft:${user.id}:${d.step}`));
    console.log(`  step ${d.step}: ${Object.keys(data).join(', ')}`);
  }
}

head(`Profile versions — ${user.profiles.length}`);
console.log('  Immutable. A new version is written on every change; none is ever edited.\n');

for (const p of user.profiles) {
  const data = JSON.parse(
    decryptField(p.dataEncrypted, ring, `profile:${p.id}`),
  ) as FinancialProfile;

  console.log(
    `  v${p.version}${p.isActive ? ' \x1b[32m(active)\x1b[0m' : ''} · ${dt(p.createdAt)} · ` +
      `${p.planningMode} · key ${p.keyVersion}\n  hash ${p.dataHash}`,
  );

  if (p.isActive || raw) {
    const monthlySpend = Object.entries(data.expenses)
      .filter(([k]) => k !== 'annualIrregular')
      .reduce((sum, [, v]) => sum + (typeof v === 'number' ? v : 0), 0);

    console.log(`
    name              ${data.personal.fullName}
    age               ${data.personal.age}, retiring at ${data.personal.expectedRetirementAge}
    take-home         ${inr(data.income.monthlyTakeHome)}/month
    gross annual      ${inr(data.income.annualGrossIncome)}
    spending          ${inr(monthlySpend)}/month (rent/home ${inr(data.expenses.rentOrHome)})
    dependants        ${data.dependents.length}
    assets            ${data.assets.length} · liabilities ${data.liabilities.length}
    term cover        ${data.insurance.termLifeCover > 0 ? inr(data.insurance.termLifeCover) : 'none'}
    goals             ${data.goals.length}${data.goals.length ? ': ' + data.goals.map((g) => g.name).join(', ') : ''}`);
  }

  if (raw) {
    console.log('\n' + JSON.stringify(data, null, 2));
  }
  console.log();
}

const plans = await prisma.plan.findMany({
  where: { profile: { userId: user.id } },
  orderBy: { generatedAt: 'desc' },
  include: { profile: { select: { version: true, dataHash: true } }, approvals: true, notes: true },
});

head(`Plans — ${plans.length}`);
console.log('  Append-only. Regenerating writes a new row and keeps the old.\n');

for (const row of plans) {
  const plan = JSON.parse(
    decryptField(row.outputEncrypted, ring, `plan:${row.id}`),
  ) as RecommendationPlan;
  const bound = row.profileHash === row.profile.dataHash;
  const d = plan.derived;

  console.log(
    `  ${dt(row.generatedAt)} · profile v${row.profile.version} · ${row.advisoryMode}\n` +
      `  ${bound ? '\x1b[32mtraceable to its profile\x1b[0m' : '\x1b[31mNOT traceable — cannot be shown as advice\x1b[0m'}` +
      ` · narrative ${row.narrativeSource}${row.narrativeRejection ? ` (rejected: ${row.narrativeRejection})` : ''}` +
      ` · engine ${row.engineVersion} · assumptions ${row.assumptionsVersion}`,
  );
  console.log(`
    income            ${inr(d.plannableMonthlyIncome)}/month
    spending          ${inr(d.totalMonthlyExpenses)}/month
    EMIs              ${inr(d.totalMonthlyEMI)}/month
    free to invest    ${inr(d.investableSurplus)}/month
    net worth         ${inr(d.netWorth)}
    risk band         ${plan.riskProfile.band} (capacity ${plan.riskProfile.capacityScore}, tolerance ${plan.riskProfile.toleranceScore})
    actions           ${plan.actionPlan.length}${plan.actionPlan.length ? ': ' + plan.actionPlan.map((a) => a.title).join('; ') : ''}
    goals             ${plan.goalPlans.map((g) => `${g.name} (${g.feasibility})`).join(', ') || 'none'}`);

  if (asTable) {
    console.log('\n    \x1b[1mFinancial health\x1b[0m');
    console.log(
      table(
        [{ header: 'Ratio', maxWidth: 26 }, { header: 'Band' }, { header: 'Comment', maxWidth: 46 }],
        plan.diagnostics.map((x) => [x.label, x.band, x.comment]),
        '    ',
      ),
    );

    console.log('\n    \x1b[1mWhat to do, in order\x1b[0m');
    console.log(
      table(
        [
          { header: '#', align: 'right' },
          { header: 'Action', maxWidth: 34 },
          { header: 'Monthly', align: 'right' },
          { header: 'Why', maxWidth: 46 },
        ],
        plan.actionPlan.map((a) => [
          String(a.rank),
          a.title,
          a.monthlyAmountLater !== undefined
            ? `${inr(a.monthlyAmount)} → ${inr(a.monthlyAmountLater)}`
            : a.monthlyAmount > 0 ? inr(a.monthlyAmount) : '—',
          a.reason,
        ]),
        '    ',
      ),
    );

    if (plan.goalPlans.length > 0) {
      console.log('\n    \x1b[1mGoals\x1b[0m');
      console.log(
        table(
          [
            { header: 'Goal', maxWidth: 28 },
            { header: 'Years', align: 'right' },
            { header: 'Cost then', align: 'right' },
            { header: 'Needs/month', align: 'right' },
            { header: 'Verdict' },
          ],
          plan.goalPlans.map((g) => [
            g.name,
            String(g.yearsToTarget),
            inr(g.futureCost),
            g.requiredMonthlySIP > 0 ? inr(g.requiredMonthlySIP) : '—',
            g.feasibility.replace(/_/g, ' '),
          ]),
          '    ',
        ),
      );
    }

    if (plan.aggregateAllocation.length > 0) {
      // Worth being explicit: in diagnostic_only mode the engine still computes
      // the allocation and stores it — the *page* withholds it. So this shows
      // what is in the database, which is not the same as what the client was
      // shown. Reading the two as interchangeable would be a compliance error.
      console.log(
        `\n    \x1b[1mAllocation\x1b[0m` +
          (row.advisoryMode !== 'advisory'
            ? `  \x1b[2m(stored, but withheld from the client — this plan is ${row.advisoryMode})\x1b[0m`
            : ''),
      );
      console.log(
        table(
          [
            { header: 'Category', maxWidth: 30 },
            { header: 'Share', align: 'right' },
            { header: 'Monthly', align: 'right' },
          ],
          plan.aggregateAllocation.map((sl) => [
            sl.instrument.label,
            (sl.percent * 100).toFixed(1) + '%',
            inr(sl.monthlyAmount),
          ]),
          '    ',
        ),
      );
    } else {
      console.log('\n    \x1b[2mNo allocation was computed for this plan.\x1b[0m');
    }

    console.log('\n    \x1b[1mIf things go wrong\x1b[0m');
    console.log(
      table(
        [
          { header: 'Scenario', maxWidth: 24 },
          { header: 'Severity' },
          { header: 'Result', maxWidth: 52 },
        ],
        plan.stressTests.map((t) => [t.title, t.severity, t.headline]),
        '    ',
      ),
    );
    console.log();
  }

  for (const note of row.notes) {
    console.log(`    adviser note      ${decryptField(note.bodyEncrypted, ring, `note:${note.id}`)}`);
  }
  for (const a of row.approvals) {
    console.log(`    release           ${a.decision}${a.reason ? ` — ${a.reason}` : ''} at ${dt(a.decidedAt)}`);
  }
  if (raw) console.log('\n' + JSON.stringify(plan, null, 2));
  console.log();
}

if (user.consents.length > 0) {
  head('Consent');
  for (const c of user.consents) {
    const given = Object.entries({
      process: c.processFinancialInformation,
      recommendations: c.generatePersonalisedRecommendations,
      accurate: c.informationAccurate,
      risk: c.riskDisclosuresAccepted,
      history: c.storeRecommendationHistory,
      reminders: c.remindersAndNotifications,
    })
      .map(([k, v]) => `${v ? '' : 'no-'}${k}`)
      .join(', ');
    console.log(`  ${dt(c.acceptedAt)} · text ${c.consentVersion}${c.revokedAt ? ' · REVOKED' : ''}\n    ${given}`);
  }
}

if (user.reviews.length > 0) {
  head('Annual reviews');
  for (const r of user.reviews) {
    console.log(`  ${dt(r.reviewedAt)} · ${r.outcome}${r.changes ? ` · ${r.changes}` : ''}`);
  }
}

const events = await prisma.auditEvent.findMany({
  where: { userId: user.id },
  orderBy: { sequence: 'asc' },
});

head(`Audit trail — ${events.length} event(s)`);
console.log(
  table(
    [
      { header: '#', align: 'right' },
      { header: 'When' },
      { header: 'Action' },
      { header: 'Entity' },
      { header: 'Actor' },
    ],
    events.map((e) => [
      String(e.sequence),
      dt(e.createdAt),
      e.action,
      e.entityType,
      // Shown separately from the subject: an adviser acting for a client is
      // exactly the access an audit asks about.
      e.actorId && e.actorId !== e.userId ? 'an adviser' : 'themselves',
    ]),
    '  ',
  ),
);

const all = await prisma.auditEvent.findMany({ orderBy: { sequence: 'asc' } });
const chain = verifyChain(
  all.map((r): AuditEvent => ({
    sequence: r.sequence, userId: r.userId, actorId: r.actorId,
    action: r.action as AuditAction, entityType: r.entityType, entityId: r.entityId,
    metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    createdAt: r.createdAt.toISOString(), ipHash: r.ipHash,
    prevHash: r.prevHash, hash: r.hash,
  })),
);
console.log(
  chain.valid
    ? `\n  \x1b[32mChain intact\x1b[0m across all ${chain.checked} events in the database.`
    : `\n  \x1b[31mCHAIN BROKEN at ${chain.brokenAt}: ${chain.reason}\x1b[0m`,
);

rule();
console.log(
  (asTable ? '' : 'The plan as tables:          npm run inspect -- <email> --table\n') +
    (raw ? '' : 'Everything, as stored JSON:  npm run inspect -- <email> --raw\n'),
);

await prisma.$disconnect();
