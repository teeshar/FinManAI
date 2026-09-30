/**
 * What changed, and why.
 *
 * Phase 6 calls this the most valuable screen in the product once a client has
 * three plans. The reason is that a single plan is a document, but two plans
 * side by side are the plan *responding to their life* — and that is the thing
 * a report generator cannot do and an advisory relationship must.
 *
 * The page leads with the CAUSE, not the numbers. "Your plan has been updated"
 * with no reason attached is the sentence every client learns to distrust.
 * Whether their own answers moved, or the tax rules did, or we became able to
 * show them more, changes how they should read everything below it.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser, requestIp } from '../../../../lib/auth';
import { loadPlanFor } from '../../../../lib/plan-access';
import { diffPlans } from '../../../../lib/plan-diff';
import type { FieldChange, GoalChange } from '../../../../lib/plan-diff';
import { recordAudit } from '../../../../lib/audit';
import { Page, PageTitle, Section, Notice } from '../../../../components/Shell';

const dmy = (d: Date) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const title = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function render(value: number, unit: FieldChange['unit']): string {
  switch (unit) {
    case 'inr':
      return '₹' + Math.round(value).toLocaleString('en-IN');
    case 'percent':
      return (value * 100).toFixed(1) + '%';
    case 'months':
      return value.toFixed(1) + ' months';
    case 'years':
      return value.toFixed(0) + ' years';
    case 'count':
      return String(Math.round(value));
  }
}

export default async function Compare({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const { a, b } = await searchParams;
  if (!a || !b || a === b) {
    return (
      <Page>
        <Notice tone="info" title="Pick two plans to compare">
          <p>
            <Link href="/dashboard" className="font-medium underline">
              Your plan history
            </Link>{' '}
            has a comparison link against the plan before it.
          </p>
        </Notice>
      </Page>
    );
  }

  const [older, newer] = await Promise.all([loadPlanFor(a, user), loadPlanFor(b, user)]);
  if (!older || !newer || older.subjectUserId !== newer.subjectUserId) {
    return (
      <Page>
        <Notice tone="blocked" title="Those plans cannot be compared">
          <p>One of them does not exist, or is not yours to read.</p>
        </Notice>
      </Page>
    );
  }

  const diff = diffPlans(older.plan, newer.plan, {
    profileVersionBefore: older.profileVersion,
    profileVersionAfter: newer.profileVersion,
  });

  await recordAudit('plan.compared', 'Plan', newer.id, {
    userId: newer.subjectUserId,
    actorId: user.id,
    ip: await requestIp(),
  }, { comparedWith: older.id });

  return (
    <Page>
      <PageTitle
        eyebrow="Plan comparison"
        title="What changed"
        actions={
          <Link href="/dashboard" className="btn btn-secondary">
            All your plans
          </Link>
        }
      />

      {/*
        The two plans as a pair rather than a sentence. Which version produced
        which set of numbers is the first thing anyone checks.
      */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <PlanChip id={older.id} when={dmy(older.generatedAt)} version={older.profileVersion} role="Before" />
        <PlanChip id={newer.id} when={dmy(newer.generatedAt)} version={newer.profileVersion} role="Now" accent />
      </div>

      {/* The cause comes before the numbers. */}
      <div className="mt-6 space-y-2">
        {diff.causes.map((c) => (
          <p key={c} className="aside-note">
            {c}
          </p>
        ))}
      </div>

      {diff.unchanged ? (
        <div className="mt-6">
          <Notice tone="info" title="Nothing material moved">
            <p>
              Every headline figure is the same in both plans, within rounding. That is a real
              result, not a missing one — regenerating a plan from unchanged inputs is supposed to
              produce the same advice.
            </p>
          </Notice>
        </div>
      ) : (
        <p className="prose-advice mt-7 text-lg">{diff.headline}</p>
      )}

      <Changes title="Your money" changes={diff.cashflow} />
      <Changes title="Your safety net" changes={diff.protection} />

      {(diff.risk.length > 0 || diff.riskBandChange) && (
        <Section title="Your risk profile">
          {diff.riskBandChange && (
            <p className="mb-3 text-sm leading-relaxed text-[color:var(--text-muted)]">
              Moved from <strong>{title(diff.riskBandChange.before)}</strong> to{' '}
              <strong>{title(diff.riskBandChange.after)}</strong>. This changes the ceiling on how
              much of your money may sit in equity, so it moves the allocation for every goal.
            </p>
          )}
          <ChangeTable changes={diff.risk} />
        </Section>
      )}

      {diff.goals.some((g) => g.status !== 'unchanged') && (
        <Section title="Your goals">
          <div className="space-y-4">
            {diff.goals
              .filter((g) => g.status !== 'unchanged')
              .map((g) => (
                <GoalBlock key={g.goalId} goal={g} />
              ))}
          </div>
          {diff.goals.some((g) => g.status === 'unchanged') && (
            <p className="mt-4 text-sm">
              Unchanged:{' '}
              {diff.goals
                .filter((g) => g.status === 'unchanged')
                .map((g) => g.name)
                .join(', ')}
              .
            </p>
          )}
        </Section>
      )}

      {(diff.actions.added.length > 0 ||
        diff.actions.removed.length > 0 ||
        diff.actions.reordered) && (
        <Section
          title="What to do, in order"
          subtitle="The sequencing is the advice, so a change in the order is itself news."
        >
          <ul className="space-y-2 text-sm leading-relaxed">
            {diff.actions.added.map((t) => (
              <li key={`+${t}`} className="text-[color:var(--text)]">
                <span className="mr-2 font-medium text-[color:var(--good-fg)]">New</span>
                {t}
              </li>
            ))}
            {diff.actions.removed.map((t) => (
              <li key={`-${t}`} style={{ color: 'var(--text-muted)' }}>
                <span className="mr-2 font-medium">Done or dropped</span>
                {t}
              </li>
            ))}
            {diff.actions.reordered && (
              <li className="text-[color:var(--text)]">
                <span className="mr-2 font-medium text-[color:var(--warn-fg)]">Reordered</span>
                The priority of your remaining steps has changed. Read the plan in its new order
                rather than carrying on from memory.
              </li>
            )}
          </ul>
        </Section>
      )}

      {diff.allocationWithheld ? (
        <Section title="Where to invest">
          <p className="text-sm leading-relaxed">
            One of these plans was produced in diagnostic-only mode, where the allocation table is
            withheld. That is a difference in what we are permitted to show you, not a change in
            what we recommend, so there is nothing to compare here.
          </p>
        </Section>
      ) : (
        <Changes title="Where to invest" changes={diff.allocation} />
      )}

      <Changes
        title="If things go wrong"
        changes={diff.stress}
        subtitle="How long you could hold out under each stress test."
      />

      <div className="mt-12 border-t pt-6" style={{ borderColor: 'var(--border)' }}>
        <Link href="/dashboard" className="btn btn-secondary">
          Back to your plans
        </Link>
      </div>
    </Page>
  );
}

/** One end of the comparison. */
function PlanChip({
  id,
  when,
  version,
  role,
  accent,
}: {
  id: string;
  when: string;
  version: number;
  role: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={`/plan/${id}`}
      className="card card-link block p-4"
      style={accent ? { borderColor: 'var(--brand-ring-strong)' } : undefined}
    >
      <p
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: accent ? 'var(--brand-fg)' : 'var(--text-faint)' }}
      >
        {role}
      </p>
      <p className="mt-1.5 font-medium">{when}</p>
      <p className="mt-0.5 text-sm" style={{ color: 'var(--text-muted)' }}>
        Profile version {version}
      </p>
    </Link>
  );
}

function Changes({
  title,
  changes,
  subtitle,
}: {
  title: string;
  changes: FieldChange[];
  subtitle?: string;
}) {
  if (changes.length === 0) return null;
  return (
    <Section title={title} subtitle={subtitle}>
      <ChangeTable changes={changes} />
    </Section>
  );
}

function ChangeTable({ changes }: { changes: FieldChange[] }) {
  if (changes.length === 0) return null;
  return (
    <div className="card scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>Figure</th>
            <th className="num">Before</th>
            <th className="num">Now</th>
            <th className="num">Change</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.label}>
              <td>
                <p className="font-medium">{c.label}</p>
                {c.note && (
                  <p className="mt-0.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {c.note}
                  </p>
                )}
              </td>
              <td className="num" style={{ color: 'var(--text-faint)' }}>
                {render(c.before, c.unit)}
              </td>
              <td className="num font-semibold">{render(c.after, c.unit)}</td>
              {/*
                The arrow carries the direction as well as the sign. Up is not
                good and down is not bad here — a smaller required SIP is a
                better plan — so this stays neutral in colour deliberately.
              */}
              <td className="num" style={{ color: 'var(--text-muted)' }}>
                <span aria-hidden="true">{c.direction === 'up' ? '↑' : '↓'}</span>{' '}
                {render(Math.abs(c.delta), c.unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GoalBlock({ goal }: { goal: GoalChange }) {
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-medium">{goal.name}</p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {goal.status === 'added'
            ? 'New goal'
            : goal.status === 'removed'
              ? 'No longer in your plan'
              : goal.feasibilityBefore !== goal.feasibilityAfter
                ? `${title(goal.feasibilityBefore!)} → ${title(goal.feasibilityAfter!)}`
                : title(goal.feasibilityAfter!)}
        </p>
      </div>
      {goal.changes.length > 0 && (
        <div className="mt-3">
          <ChangeTable changes={goal.changes} />
        </div>
      )}
    </div>
  );
}
