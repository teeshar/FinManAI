/**
 * The adviser console.
 *
 * Phase 6's definition of done includes "an adviser can see, at a glance, which
 * of their clients need attention this month". That is the whole design brief
 * for this page: it is a triage list, not a dashboard. Anything that is not a
 * reason to open a client's file does not belong on it.
 *
 * Metadata only — a morning triage list has no business decrypting a single
 * client's financial position. An adviser who wants to read a plan opens it,
 * and that read is separately audited as `adviser.viewed_client`.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../../../lib/auth';
import { adviserQueue } from '../../../lib/adviser-service';
import { advisoryMode } from '../../../lib/keys';
import { Page, PageTitle, Section, Notice, EmptyState } from '../../../components/Shell';
import { InviteClient } from './InviteClient';

const dmy = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function AdviserConsole() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'ADVISER' && user.role !== 'ADMIN') redirect('/dashboard');

  const { entries, activeClients, deposit } = await adviserQueue(user.id);
  const needsAttention = entries.filter((e) => e.urgency > 0);
  const settled = entries.filter((e) => e.urgency === 0);

  return (
    <Page wide>
      <PageTitle
        eyebrow="Adviser console"
        title="Your clients"
        meta={`${activeClients} active · IAASB deposit band ${deposit.deposit}${
          advisoryMode() !== 'advisory' ? ' · diagnostic-only mode' : ''
        }`}
      />

      {/* The count that decides whether this morning has a queue. */}
      {entries.length > 0 && (
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <Tally label="Need attention today" value={needsAttention.length} accent={needsAttention.length > 0} />
          <Tally label="Settled" value={settled.length} />
          <Tally label="Active relationships" value={activeClients} />
        </div>
      )}

      <div className="mt-7 space-y-3">
        {deposit.warning && (
          <Notice tone="warn" title="You are approaching a deposit threshold">
            <p>{deposit.warning}</p>
          </Notice>
        )}
        {needsAttention.length === 0 && entries.length > 0 && (
          <Notice tone="info" title="Nothing needs attention today">
            <p>Every client&rsquo;s profile is current and every plan is released.</p>
          </Notice>
        )}
      </div>

      {needsAttention.length > 0 && (
        <Section
          title="Needs attention"
          subtitle="Ordered by urgency: overdue reviews first, then plans waiting on you."
        >
          <Queue entries={needsAttention} />
        </Section>
      )}

      {settled.length > 0 && (
        <Section title="Everything else">
          <Queue entries={settled} />
        </Section>
      )}

      {entries.length === 0 && (
        <Section title="No clients yet">
          <EmptyState title="Nobody has accepted an invitation yet">
            Invite someone below. They must accept before you can see anything — consent to be
            advised is the client&rsquo;s to give, never yours to assume.
          </EmptyState>
        </Section>
      )}

      <Section title="Invite a client">
        <InviteClient />
      </Section>
    </Page>
  );
}

/** A headline count. The queue is a triage list, so the size of it is the news. */
function Tally({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
        {label}
      </p>
      <p
        className="mt-1.5 text-3xl font-semibold leading-none tracking-tight"
        style={accent ? { color: 'var(--warn-fg)' } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function Queue({ entries }: { entries: Awaited<ReturnType<typeof adviserQueue>>['entries'] }) {
  return (
    <div className="card scroll-x">
      <table className="table">
        <thead>
          <tr>
            <th>Client</th>
            <th>Profile</th>
            <th>Last reviewed</th>
            <th>Latest plan</th>
            <th>Why it is here</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.clientId}>
              <td>
                <p className="font-medium">{e.email}</p>
                {e.status !== 'active' && (
                  <p className="mt-0.5 text-xs capitalize" style={{ color: 'var(--text-faint)' }}>
                    {e.status}
                  </p>
                )}
              </td>
              <td style={{ color: 'var(--text-muted)' }}>
                {e.profileVersion ? `v${e.profileVersion}` : 'not started'}
              </td>
              <td style={{ color: 'var(--text-muted)' }}>
                {e.daysSinceReview === null ? '—' : `${e.daysSinceReview} days ago`}
              </td>
              <td>
                {e.latestPlanId ? (
                  <Link
                    href={`/plan/${e.latestPlanId}`}
                    className="underline underline-offset-2 hover:no-underline"
                  >
                    {e.latestPlanAt ? dmy(e.latestPlanAt) : 'open'}
                  </Link>
                ) : (
                  <span style={{ color: 'var(--text-faint)' }}>none</span>
                )}
              </td>
              <td>
                <div className="flex flex-wrap gap-1.5">
                  {e.materiallyOverdue && <Flag tone="red">Shown as historical</Flag>}
                  {!e.materiallyOverdue && e.reviewState === 'overdue' && (
                    <Flag tone="amber">Review overdue</Flag>
                  )}
                  {e.reviewState === 'due_soon' && <Flag tone="amber">Review due soon</Flag>}
                  {e.awaitingApproval && <Flag tone="amber">Awaiting your release</Flag>}
                  {e.assumptionsStale && <Flag tone="slate">Built on old assumptions</Flag>}
                  {e.status === 'invited' && <Flag tone="slate">Invitation not accepted</Flag>}
                  {e.urgency === 0 && <span style={{ color: 'var(--text-faint)' }}>—</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Flag({ tone, children }: { tone: 'red' | 'amber' | 'slate'; children: React.ReactNode }) {
  const style = {
    red: { background: 'var(--bad-bg)', color: 'var(--bad-fg)' },
    amber: { background: 'var(--warn-bg)', color: 'var(--warn-fg)' },
    slate: { background: 'var(--surface-sunk)', color: 'var(--text-muted)' },
  }[tone];
  return (
    <span className="chip" style={style}>
      {children}
    </span>
  );
}
