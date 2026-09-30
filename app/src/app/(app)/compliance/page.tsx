/**
 * The compliance console.
 *
 * Phase 5 shipped every endpoint an auditor needs and nothing that renders
 * them, so a COMPLIANCE-role user read raw JSON. That is not a cosmetic gap:
 * the point of the audit chain is that someone actually looks at it, and a
 * control nobody exercises is a hope rather than a control.
 *
 * Chain integrity comes first because it is the headline an auditor looks for
 * before anything else. If the chain is broken, every number below it is
 * unreliable and the page says so instead of burying it under counts.
 *
 * What is deliberately absent: plan and profile CONTENTS. The export endpoint
 * excludes them on purpose — an auditor needs to see that advice was given,
 * when, on what basis, and that the records are intact, not to receive every
 * client's decrypted financial position. A console that reintroduced what the
 * API refused to ship would defeat that.
 */

import { redirect } from 'next/navigation';
import { currentUser } from '../../../lib/auth';
import { verifyAuditChain } from '../../../lib/audit';
import { prisma } from '../../../lib/db';
import { RETENTION_YEARS } from '../../../../../core/src/audit';
import { advisoryMode } from '../../../lib/keys';
import { Page, PageTitle, Section, Notice } from '../../../components/Shell';
import { ExportPanel } from './ExportPanel';

const dt = (d: Date) => new Date(d).toLocaleString('en-IN');

export default async function ComplianceConsole({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'COMPLIANCE' && user.role !== 'ADMIN') redirect('/dashboard');

  const params = await searchParams;
  // Default to the last 90 days — long enough to show a pattern, short enough
  // that the event table on screen stays readable.
  const to = params.to ?? new Date().toISOString().slice(0, 10);
  const from =
    params.from ?? new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

  const range = { gte: new Date(from), lte: new Date(`${to}T23:59:59.999Z`) };

  const [chain, plans, events, counts, staleKeys, outbox] = await Promise.all([
    verifyAuditChain(),
    prisma.plan.findMany({
      where: { generatedAt: range },
      select: {
        id: true,
        generatedAt: true,
        advisoryMode: true,
        assumptionsVersion: true,
        narrativeSource: true,
        narrativeModel: true,
        narrativeRejection: true,
        profileHash: true,
        profile: { select: { version: true, dataHash: true } },
      },
      orderBy: { generatedAt: 'desc' },
    }),
    prisma.auditEvent.findMany({
      where: { createdAt: range },
      orderBy: { sequence: 'desc' },
      take: 100,
      select: {
        sequence: true, action: true, entityType: true, entityId: true,
        userId: true, actorId: true, createdAt: true, hash: true, legalHold: true,
      },
    }),
    Promise.all([
      prisma.auditEvent.count({ where: { createdAt: range } }),
      prisma.consent.count({ where: { acceptedAt: range } }),
      prisma.clientAgreement.count({ where: { signedAt: range } }),
      prisma.profileReview.count({ where: { reviewedAt: range } }),
      prisma.user.count({ where: { deletedAt: null } }),
    ]),
    prisma.profile.groupBy({ by: ['keyVersion'], _count: true }),
    prisma.outbox.count({ where: { sentAt: null } }),
  ]);

  const [eventCount, consentCount, agreementCount, reviewCount, userCount] = counts;
  const unverifiable = plans.filter((p) => p.profileHash !== p.profile.dataHash);
  const llm = plans.filter((p) => p.narrativeSource === 'llm').length;
  const fallback = plans.filter((p) => p.narrativeSource === 'fallback').length;
  const rejected = plans.filter((p) => p.narrativeRejection).length;
  const models = [...new Set(plans.map((p) => p.narrativeModel).filter(Boolean))];

  return (
    <Page wide>
      <PageTitle
        eyebrow="Compliance console"
        title="Compliance"
        meta={`${from} to ${to} · retention ${RETENTION_YEARS} years · mode ${advisoryMode()}`}
      />

      {/* The headline an auditor looks for first. */}
      <div className="mt-8 space-y-3">
        {chain.valid ? (
          <Notice tone="info" title={`Audit chain intact — ${chain.checked} events verified`}>
            <p>
              Every event hashes to its predecessor. This does not prove nobody has database write
              access; it proves nobody has used it, which is the property that matters in a
              dispute.
            </p>
          </Notice>
        ) : (
          <Notice tone="blocked" title={`Audit chain BROKEN at sequence ${chain.brokenAt}`}>
            <p>{chain.reason}</p>
            <p className="mt-2">
              Treat this as an incident, not a bug. Do not repair the chain — preserve it, and
              follow the breach runbook. A rewritten chain destroys the only evidence of what was
              altered.
            </p>
          </Notice>
        )}

        {unverifiable.length > 0 && (
          <Notice tone="blocked" title={`${unverifiable.length} plan(s) cannot be traced to their profile`}>
            <p>
              These are not being shown to clients as advice. Each needs regenerating from the
              current profile:{' '}
              {unverifiable.map((p) => `${p.id.slice(0, 8)} (profile v${p.profile.version})`).join(', ')}
            </p>
          </Notice>
        )}

        {staleKeys.length > 1 && (
          <Notice tone="warn" title="Profiles are spread across more than one encryption key">
            <p>
              {staleKeys.map((k) => `${k.keyVersion}: ${k._count}`).join(' · ')}. Run{' '}
              <code className="mono rounded px-1.5 py-0.5" style={{ background: 'var(--surface)' }}>npm run rotate:keys</code> to completion —
              retired keys must stay in the key ring until every row has moved off them.
            </p>
          </Notice>
        )}

        {outbox > 0 && (
          <Notice tone="warn" title={`${outbox} message(s) queued and not yet sent`}>
            <p>
              Run <code className="mono rounded px-1.5 py-0.5" style={{ background: 'var(--surface)' }}>npm run send:reminders</code>. A reminder
              stuck in the queue means a client has not been told their plan is going stale.
            </p>
          </Notice>
        )}
      </div>

      <Section title="The period in numbers">
        <dl className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Audit events" value={eventCount} />
          <Stat label="Plans generated" value={plans.length} />
          <Stat label="Annual reviews" value={reviewCount} />
          <Stat label="Consents recorded" value={consentCount} />
          <Stat label="Agreements signed" value={agreementCount} />
          <Stat label="Live users" value={userCount} />
        </dl>
      </Section>

      <Section
        title="AI use"
        subtitle="SEBI requires the extent of AI use to be disclosable. A rising rejection count means the model is drifting, or the prompt needs work."
      >
        <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat label="Model-written narratives" value={llm} />
          <Stat label="Fell back to template" value={fallback} />
          <Stat label="Rejected by the validator" value={rejected} />
          <Stat label="Models used" value={models.length === 0 ? '—' : models.join(', ')} />
        </dl>
        <p className="mt-4 text-sm leading-relaxed">
          A model never produces a number. It receives the finished plan and writes prose, and two
          independent guards — unit-aware numeric validation and a claim-level check — discard
          anything that adds a figure, names a scheme, or promises an outcome.
        </p>
      </Section>

      <Section title="Advisory mode">
        <dl className="grid grid-cols-2 gap-6 sm:grid-cols-3">
          <Stat
            label="Advisory"
            value={plans.filter((p) => p.advisoryMode === 'advisory').length}
          />
          <Stat
            label="Diagnostic only"
            value={plans.filter((p) => p.advisoryMode === 'diagnostic_only').length}
          />
          <Stat
            label="Assumptions versions in use"
            value={[...new Set(plans.map((p) => p.assumptionsVersion))].join(', ') || '—'}
          />
        </dl>
      </Section>

      <Section title="Export for the annual audit">
        <ExportPanel from={from} to={to} />
      </Section>

      <Section
        title="Event log"
        subtitle="The 100 most recent events in the period. The full log is in the export."
      >
        <div className="card scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>When</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Subject</th>
                <th>Actor</th>
                <th>Hash</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.sequence}>
                  <td style={{ color: 'var(--text-faint)' }}>{e.sequence}</td>
                  <td className="whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                    {dt(e.createdAt)}
                  </td>
                  <td className="font-medium">
                    {e.action}
                    {e.legalHold && (
                      <span
                        className="chip ml-2"
                        style={{ background: 'var(--bad-bg)', color: 'var(--bad-fg)' }}
                      >
                        legal hold
                      </span>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{e.entityType}</td>
                  <td className="mono text-xs">{e.userId?.slice(0, 8) ?? '—'}</td>
                  <td className="mono text-xs">
                    {/* Shown separately from the subject: an adviser acting for a
                        client is exactly the access an audit asks about. */}
                    {e.actorId?.slice(0, 8) ?? '—'}
                    {e.actorId && e.userId && e.actorId !== e.userId && (
                      <span className="ml-1" style={{ color: 'var(--warn-fg)' }}>
                        on behalf
                      </span>
                    )}
                  </td>
                  <td className="mono text-xs" style={{ color: 'var(--text-faint)' }}>
                    {e.hash.slice(0, 12)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </Page>
  );
}

/**
 * A counted figure on the console. Deliberately plainer than the plan's `Stat`:
 * these are operational counts an auditor scans, not numbers anyone acts on.
 */
function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card p-4">
      <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
        {label}
      </dt>
      <dd className="mt-1.5 text-xl font-semibold leading-tight">{value}</dd>
    </div>
  );
}
