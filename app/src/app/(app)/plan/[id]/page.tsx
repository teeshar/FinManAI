/**
 * The plan.
 *
 * Four things this page must get right, all regulatory as much as editorial:
 *
 *   1. In `diagnostic_only` mode it renders diagnostics, gaps and stress tests
 *      but NOT the allocation or product recommendations. That is the switch
 *      that lets a pilot run before RIA registration lands.
 *   2. Disclosures and the AI-use statement appear on the plan itself, not
 *      buried in a footer link.
 *   3. A plan that can no longer be traced to the profile that produced it, or
 *      whose profile is long past its annual review, is not presented as
 *      current advice. It is not hidden either — what we said in March stays
 *      exactly what we said in March, clearly labelled as a record of the time.
 *   4. Reading a plan is an audited event. Phase 3's own definition of done
 *      requires an audit event for the generation AND the view, and an adviser
 *      opening a client's plan is precisely the access an auditor asks about.
 */

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { currentUser, requestIp } from '../../../../lib/auth';
import { loadPlanFor } from '../../../../lib/plan-access';
import { planNotes } from '../../../../lib/adviser-service';
import { recordAudit } from '../../../../lib/audit';
import { prisma } from '../../../../lib/db';
import { Page, PageTitle, Section, Notice, Stat, Pill } from '../../../../components/Shell';
import { AllocationChart } from '../../../../components/AllocationChart';
import { Narrative } from '../../../../components/Narrative';
import { AdviserPanel } from './AdviserPanel';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const pct = (n: number) => (n * 100).toFixed(1) + '%';
const title = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Stress severity drives the border only; the Pill carries the label. */
const SEVERITY_TOKEN: Record<string, string> = {
  comfortable: 'good', manageable: 'warn', painful: 'bad', catastrophic: 'bad',
};

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const id = (await params).id;
  const loaded = await loadPlanFor(id, user);
  // `notFound` rather than a 403 for someone else's plan: confirming that a
  // plan ID exists is itself a disclosure.
  if (!loaded) notFound();

  await recordAudit('plan.viewed', 'Plan', loaded.id, {
    userId: loaded.subjectUserId,
    actorId: user.id,
    ip: await requestIp(),
  }, { actingAsAdviser: loaded.actingAsAdviser });

  if (!loaded.verifiable) {
    return (
      <Page>
        <Notice tone="blocked" title="This plan cannot be verified">
          <p>
            It no longer matches the profile version that produced it, so we cannot show it as
            advice — the reasoning behind it can no longer be reconstructed from the inputs.
            Generate a fresh plan from your current profile.
          </p>
          <p className="mt-3">
            <Link href="/onboarding/review" className="font-medium underline">
              Rebuild my plan
            </Link>
          </p>
        </Notice>
      </Page>
    );
  }

  const plan = loaded.plan;
  const advisory = plan.advisoryMode === 'advisory';
  const d = plan.derived;

  // An adviser's notes are their reasoning about this client, and belong only
  // to the adviser side of the relationship.
  const notes = loaded.actingAsAdviser ? await planNotes(loaded.id) : [];

  // Offered only where there is something to compare against.
  const previous = await prisma.plan.findFirst({
    where: {
      profile: { userId: loaded.subjectUserId },
      generatedAt: { lt: loaded.generatedAt },
    },
    orderBy: { generatedAt: 'desc' },
    select: { id: true },
  });

  return (
    <Page>
      <div className="space-y-3">
        {loaded.historical && (
          <Notice tone="blocked" title="A record of what we advised at the time">
            <p>
              This plan is intact and nothing in it has changed — but the profile behind it was
              last reviewed {loaded.daysSinceReview} days ago, so we will not present it as current
              advice. Recommendations are only suitable for the situation they were built for.
            </p>
            <p className="mt-3">
              <Link href="/reprofile" className="font-medium underline">
                Review your profile
              </Link>{' '}
              and this becomes live again.
            </p>
          </Notice>
        )}

        {loaded.approval.required && loaded.approval.decision !== 'approved' && (
          <Notice tone="warn" title="Not yet released by your adviser">
            <p>
              {loaded.approval.decision === 'withheld'
                ? `Your adviser has held this back: ${loaded.approval.reason}`
                : 'Your adviser has not signed this off yet. An adviser is personally accountable for advice given under their name, so a generated plan is not advice until they release it.'}
            </p>
          </Notice>
        )}

        {!advisory && (
          <Notice tone="info" title="Diagnostics only">
            <p>
              This report shows your financial position, the gaps in it, and what would happen
              under stress. It does not recommend specific investments, because we are not yet
              registered to give that advice.
            </p>
          </Notice>
        )}
      </div>

      <div className="mt-8">
        <PageTitle
          eyebrow={advisory ? 'Your plan' : 'Diagnostic report'}
          title="Your financial plan"
          meta={`Generated ${new Date(loaded.generatedAt).toLocaleDateString('en-IN')} · profile version ${loaded.profileVersion} · engine ${plan.engineVersion} · assumptions ${plan.assumptionsVersion}`}
          actions={
            <>
              <Link href={`/plan/${loaded.id}/print`} className="btn btn-primary">
                Save as PDF
              </Link>
              {previous && (
                <Link
                  href={`/plan/compare?a=${previous.id}&b=${loaded.id}`}
                  className="btn btn-secondary"
                >
                  What changed
                </Link>
              )}
              <Link href="/dashboard" className="btn btn-secondary">
                All your plans
              </Link>
            </>
          }
        />
      </div>

      {/*
        A jump list. This document runs to nine sections and the one people come
        back for — "what do I actually do" — is a long way down. Anchors rather
        than a sticky rail so it costs nothing on a phone and prints as nothing.
      */}
      <nav className="no-print mt-6 flex flex-wrap gap-2" aria-label="Sections of this plan">
        {[
          ['cashflow', 'Cashflow'],
          ['health', 'Health'],
          ['actions', 'What to do'],
          ...(plan.goalPlans.length > 0 ? [['goals', 'Goals'] as [string, string]] : []),
          ...(advisory && plan.aggregateAllocation.length > 0
            ? [['allocation', 'Where to invest'] as [string, string]]
            : []),
          ['stress', 'If things go wrong'],
          ['tax', 'Tax'],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="chip hover:underline">
            {label}
          </a>
        ))}
      </nav>

      {loaded.actingAsAdviser && (
        <AdviserPanel planId={loaded.id} approval={loaded.approval} notes={notes} />
      )}

      {plan.warnings.length > 0 && (
        <div className="mt-8 space-y-2">
          {plan.warnings.map((w, i) => (
            <p key={i} className="aside-note">
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Narrative */}
      {loaded.narrative && (
        <section className="mt-10">
          <Narrative text={loaded.narrative} source={loaded.narrativeSource} />
        </section>
      )}

      {/* Cashflow */}
      <Section id="cashflow" title="Where your money goes">
        <dl className="card-raised grid grid-cols-2 gap-6 p-5 sm:grid-cols-4 sm:p-6">
          <Stat label="Monthly income" value={inr(d.plannableMonthlyIncome)} />
          <Stat label="Total spending" value={inr(d.totalMonthlyExpenses)} />
          <Stat label="EMIs" value={inr(d.totalMonthlyEMI)} />
          <Stat label="Free to invest" value={inr(d.investableSurplus)} emphasis />
        </dl>
        <p className="mt-4 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Net worth <strong style={{ color: 'var(--text)' }}>{inr(d.netWorth)}</strong> —{' '}
          {inr(d.totalAssets)} of assets against {inr(d.totalLiabilities)} of debt.{' '}
          {d.yearsToRetirement} years to retirement.
        </p>
      </Section>

      {/* Diagnostics */}
      <Section id="health" title="Financial health">
        <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
          {plan.diagnostics.map((x) => (
            <div key={x.key} className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="font-medium">{x.label}</p>
                <p
                  className="prose-advice mt-1 text-sm"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {x.comment}
                </p>
              </div>
              <Pill label={x.band} />
            </div>
          ))}
        </div>
      </Section>

      {/* Risk profile */}
      <Section id="risk" title="Your risk profile">
        <div className="card-raised p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-2xl font-semibold tracking-tight">{title(plan.riskProfile.band)}</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              equity capped at{' '}
              <strong style={{ color: 'var(--text)' }}>{pct(plan.riskProfile.equityCeiling)}</strong>
            </p>
          </div>

          {/*
            Both scores on one scale, with the lower one marked. Invariant 9 says
            we plan to `min(capacity, tolerance)`; showing the two side by side is
            how someone sees which of the two is holding them back — and whether
            it is the one they could change.
          */}
          <div className="mt-6 space-y-4">
            <ScoreBar
              label="Capacity — what your finances can absorb"
              score={plan.riskProfile.capacityScore}
              binding={plan.riskProfile.capacityScore <= plan.riskProfile.toleranceScore}
            />
            <ScoreBar
              label="Tolerance — what you told us you can live with"
              score={plan.riskProfile.toleranceScore}
              binding={plan.riskProfile.toleranceScore < plan.riskProfile.capacityScore}
            />
          </div>

          <p className="mt-5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            We plan to the lower of the two ({plan.riskProfile.finalScore}), never the average — the
            constraint that binds is the one that matters.
          </p>
        </div>
        {plan.riskProfile.divergenceNote && (
          <p className="aside-note mt-4">{plan.riskProfile.divergenceNote}</p>
        )}
      </Section>

      {/* Action plan */}
      <Section
        id="actions"
        title="What to do, in order"
        subtitle="The order is the advice. Each step is sized to fit inside the surplus the one above it leaves behind."
      >
        <ol className="space-y-3">
          {plan.actionPlan.map((a) => (
            <li key={a.rank} className="card flex gap-4 p-4">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                style={{
                  backgroundImage: 'linear-gradient(var(--brand-grad-from), var(--brand-grad-to))',
                  color: '#fff',
                }}
              >
                {a.rank}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="font-medium">{a.title}</p>
                  {a.monthlyAmountLater !== undefined ? (
                    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                      {inr(a.monthlyAmount)}/mo now → {inr(a.monthlyAmountLater)}/mo from month{' '}
                      {a.startsInMonths}
                    </span>
                  ) : a.monthlyAmount > 0 ? (
                    <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
                      {inr(a.monthlyAmount)}/mo
                    </span>
                  ) : null}
                </div>
                <p className="prose-advice mt-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {a.reason}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* Goals */}
      {plan.goalPlans.length > 0 && (
        <Section id="goals" title="Your goals">
          <div className="space-y-3">
            {plan.goalPlans.map((g) => (
              <div key={g.goalId} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">{g.name}</p>
                  <Pill label={g.feasibility} />
                </div>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {g.yearsToTarget} years away. Costs {inr(g.futureCost)} by then.
                  {g.requiredMonthlySIP > 0 && (
                    <>
                      {' '}Needs <strong>{inr(g.requiredMonthlySIP)} a month</strong>
                      {g.stepUpRate > 0 && `, rising ${(g.stepUpRate * 100).toFixed(0)}% a year`}.
                    </>
                  )}
                </p>
                {g.negotiation && (
                  <p
                    className="mt-3 rounded-lg border p-3 text-sm leading-relaxed"
                    style={{
                      background: 'var(--warn-bg)',
                      borderColor: 'var(--warn-border)',
                      color: 'var(--warn-fg)',
                    }}
                  >
                    {g.negotiation}
                  </p>
                )}
                {g.note && (
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                    {g.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Allocation — advisory mode only */}
      {advisory && plan.aggregateAllocation.length > 0 && (
        <Section
          id="allocation"
          title="Where to invest each month"
          subtitle="The mix across asset classes is the risk decision; the table below is what to buy. Categories, never named schemes — see the disclosures at the foot of this plan."
        >
          <div className="card-raised mb-4 p-5 sm:p-6">
            <AllocationChart slices={plan.aggregateAllocation} />
          </div>
          <div className="card scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Share</th>
                  <th className="num">Monthly</th>
                </tr>
              </thead>
              <tbody>
                {plan.aggregateAllocation.map((s) => (
                  <tr key={s.instrument.id}>
                    <td>
                      <p className="font-medium">{s.instrument.label}</p>
                      <p className="mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                        {s.rationale}
                      </p>
                    </td>
                    <td className="num" style={{ color: 'var(--text-muted)' }}>{pct(s.percent)}</td>
                    <td className="num font-semibold">{inr(s.monthlyAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Rebalancing — advisory mode only */}
      {advisory && plan.rebalancing.portfolioValue > 0 && (
        <Section id="rebalance" title="Your existing portfolio">
          <p className="prose-advice text-sm" style={{ color: 'var(--text-muted)' }}>
            {plan.rebalancing.summary}
          </p>
          <div className="mt-4 space-y-3">
            {plan.rebalancing.actions.map((a) => (
              <div key={a.rank} className="card p-4">
                <p className="font-medium">
                  {a.title}
                  {a.taxCost > 0 && (
                    <span className="ml-2 font-normal" style={{ color: 'var(--text-muted)' }}>
                      tax cost {inr(a.taxCost)}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {a.reason}
                </p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Stress tests — shown in both modes; this is diagnostics, not advice */}
      <Section id="stress" title="If things go wrong" subtitle="Three deterministic scenarios, not a simulation. Coarse, but honest about being coarse.">
        <div className="space-y-3">
          {plan.stressTests.map((t) => (
            <div
              key={t.key}
              className="rounded-lg border p-4"
              style={{
                background: `var(--${SEVERITY_TOKEN[t.severity]}-bg)`,
                borderColor: `var(--${SEVERITY_TOKEN[t.severity]}-border)`,
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-medium">{t.title}</p>
                <Pill label={t.severity} />
              </div>
              <p className="mt-1.5 text-sm italic leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {t.scenario}
              </p>
              <p className="mt-2 text-sm leading-relaxed">
                {t.headline} {t.whatBreaks}
              </p>
              <p className="mt-2 text-sm font-medium leading-relaxed">{t.mitigation}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Tax */}
      <Section id="tax" title="Tax">
        <p className="card-raised p-4 text-sm leading-relaxed sm:p-5">
          Old regime {inr(plan.taxRecommendation.oldRegimeTax)} · new regime{' '}
          {inr(plan.taxRecommendation.newRegimeTax)} — the{' '}
          <strong>{plan.taxRecommendation.recommendedRegime} regime</strong> saves you{' '}
          {inr(plan.taxRecommendation.annualSaving)} a year.
        </p>
        <ul className="mt-4 space-y-2">
          {plan.taxRecommendation.notes.map((n, i) => (
            <li key={i} className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              • {n}
            </li>
          ))}
        </ul>
      </Section>

      {/* Disclosures — on the plan, not buried in a footer */}
      {/* On the plan, not behind a link. Quiet, but never hidden. */}
      <Section id="disclosures" title="Important information">
        <ul
          className="card space-y-2.5 p-5 text-xs leading-relaxed"
          style={{ color: 'var(--text-faint)' }}
        >
          {plan.disclosures.map((disc, i) => (
            <li key={i}>{disc}</li>
          ))}
        </ul>
      </Section>
    </Page>
  );
}

/**
 * One of the two risk scores, on a 0-100 rail.
 *
 * `binding` marks the score the plan is actually built on. Without it the two
 * bars look like a pair of measurements rather than a decision, and the whole
 * point of showing both is that one of them is doing the constraining.
 */
function ScoreBar({
  label,
  score,
  binding,
}: {
  label: string;
  score: number;
  binding: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span className="shrink-0 font-semibold">
          {score}
          <span className="font-normal" style={{ color: 'var(--text-faint)' }}>
            /100
          </span>
        </span>
      </div>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--surface-sunk)' }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${score}%`,
            backgroundImage: binding
              ? 'linear-gradient(90deg, var(--brand-grad-from), var(--brand-grad-to))'
              : undefined,
            background: binding ? undefined : 'var(--border-strong)',
          }}
        />
      </div>
      {binding && (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--brand-fg)' }}>
          This is the one we plan to.
        </p>
      )}
    </div>
  );
}
