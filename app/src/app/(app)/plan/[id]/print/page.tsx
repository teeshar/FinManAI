/**
 * The printable plan — the document a client keeps.
 *
 * Built as a print stylesheet rather than by adding a PDF rendering library.
 * Three reasons, in order of weight:
 *
 *   1. A browser's own print-to-PDF produces a better document than a
 *      half-configured renderer: real fonts, real hyphenation, selectable text,
 *      and page breaks the user can see before they commit to them.
 *   2. It needs no dependency and no server-side headless browser, so the plan
 *      a client saves is generated from exactly the same components that
 *      rendered the plan they read.
 *   3. It cannot drift. A separate PDF template is a second copy of the plan
 *      that will disagree with the first one within a release or two — and a
 *      document that says something different from the screen is precisely the
 *      compliance problem this codebase spends its effort avoiding.
 *
 * Print rules that matter here: disclosures and the AI-use statement must land
 * on the page, never be clipped, and no section may break across a page in a
 * way that separates a figure from what it means.
 */

import { redirect, notFound } from 'next/navigation';
import { currentUser, requestIp } from '../../../../../lib/auth';
import { loadPlanFor } from '../../../../../lib/plan-access';
import { recordAudit } from '../../../../../lib/audit';
import { PrintButton } from './PrintButton';
import { Lockup } from '../../../../../components/Shell';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const pct = (n: number) => (n * 100).toFixed(1) + '%';
const title = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default async function PrintPlan({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login');

  const loaded = await loadPlanFor((await params).id, user);
  if (!loaded) notFound();

  // Taking a copy away is an export, and exports are audited — this is the one
  // action after which the advice exists outside our records entirely.
  await recordAudit('plan.exported', 'Plan', loaded.id, {
    userId: loaded.subjectUserId,
    actorId: user.id,
    ip: await requestIp(),
  }, { format: 'print' });

  if (!loaded.verifiable) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-12">
        <p className="rounded-lg border border-[color:var(--bad-border)] bg-[color:var(--bad-bg)] p-4 text-sm leading-relaxed text-[color:var(--bad-fg)]">
          This plan no longer matches the profile version that produced it, so it cannot be
          exported as advice.
        </p>
      </div>
    );
  }

  const plan = loaded.plan;
  const advisory = plan.advisoryMode === 'advisory';
  const d = plan.derived;

  return (
    <>
      {/*
        Scoped print rules. `print:hidden` handles the chrome; these handle the
        things Tailwind has no utility for — page breaks and margins.
      */}
      <style>{`
        @page { margin: 18mm 16mm; }
        @media print {
          body { background: #fff; }
          .plan-section { break-inside: avoid; page-break-inside: avoid; }
          .plan-break { break-before: page; page-break-before: always; }
          a { text-decoration: none; color: inherit; }
        }
      `}</style>

      <div className="mx-auto max-w-3xl px-5 py-10 print:max-w-none print:px-0 print:py-0">
        <div className="card mb-8 flex flex-wrap items-center justify-between gap-4 p-4 print:hidden">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Use your browser&rsquo;s print dialog and choose &ldquo;Save as PDF&rdquo;. Everything
            below is exactly what will be on the page.
          </p>
          <PrintButton />
        </div>

        {/*
          The mark on the document itself. A plan that leaves this product is
          the one artefact a client shows to somebody else — a spouse, an
          accountant — and an unbranded page of figures has no provenance.
        */}
        <header
          className="plan-section flex flex-wrap items-end justify-between gap-4 border-b pb-4"
          style={{ borderColor: 'var(--border-strong)' }}
        >
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Financial plan</h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              Generated {new Date(loaded.generatedAt).toLocaleDateString('en-IN')} · profile version{' '}
              {loaded.profileVersion} · engine {plan.engineVersion} · assumptions{' '}
              {plan.assumptionsVersion}
            </p>
          </div>
          <Lockup width={132} variant="light" />
          {!advisory && (
            <p className="mt-3 w-full border-l-2 border-[color:var(--border-strong)] pl-3 text-sm leading-relaxed text-[color:var(--text-muted)]">
              <strong>Diagnostics only.</strong> This report shows your financial position, the gaps
              in it, and what would happen under stress. It does not recommend specific
              investments.
            </p>
          )}
          {loaded.historical && (
            <p className="mt-3 w-full border-l-2 border-[color:var(--bad-border)] pl-3 text-sm leading-relaxed text-[color:var(--text-muted)]">
              <strong>A record, not current advice.</strong> The profile behind this plan was last
              reviewed {loaded.daysSinceReview} days ago.
            </p>
          )}
        </header>

        {loaded.narrative && (
          <section className="plan-section mt-6 whitespace-pre-line text-sm leading-relaxed">
            {loaded.narrative}
            <p className="mt-3 text-xs">
              {loaded.narrativeSource === 'llm'
                ? 'Written by an AI model constrained to the figures in this document. Every number it used was checked against the calculated plan.'
                : 'Written from a fixed template. No AI model was used for this explanation.'}
            </p>
          </section>
        )}

        <Block title="Where your money goes">
          <dl className="grid grid-cols-4 gap-4 text-sm">
            <Fig label="Monthly income" value={inr(d.plannableMonthlyIncome)} />
            <Fig label="Total spending" value={inr(d.totalMonthlyExpenses)} />
            <Fig label="EMIs" value={inr(d.totalMonthlyEMI)} />
            <Fig label="Free to invest" value={inr(d.investableSurplus)} />
          </dl>
          <p className="mt-3 text-sm text-[color:var(--text-muted)]">
            Net worth {inr(d.netWorth)} — {inr(d.totalAssets)} of assets against{' '}
            {inr(d.totalLiabilities)} of debt. {d.yearsToRetirement} years to retirement.
          </p>
        </Block>

        <Block title="Financial health">
          <table className="w-full text-sm">
            <tbody>
              {plan.diagnostics.map((x) => (
                <tr key={x.key} className="border-b border-[color:var(--border)] align-top">
                  <td className="py-2 pr-4 font-medium">{x.label}</td>
                  <td className="py-2 pr-4">{x.comment}</td>
                  <td className="py-2 whitespace-nowrap text-right">{title(x.band)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Block>

        <Block title="Your risk profile">
          <p className="text-sm leading-relaxed text-[color:var(--text-muted)]">
            <strong>{title(plan.riskProfile.band)}</strong> — capacity{' '}
            {plan.riskProfile.capacityScore}/100, tolerance {plan.riskProfile.toleranceScore}/100.
            We plan to the lower of the two ({plan.riskProfile.finalScore}), capping equity at{' '}
            {pct(plan.riskProfile.equityCeiling)}.
          </p>
          {plan.riskProfile.divergenceNote && (
            <p className="mt-2 text-sm leading-relaxed">
              {plan.riskProfile.divergenceNote}
            </p>
          )}
        </Block>

        <Block title="What to do, in order">
          <ol className="space-y-3 text-sm">
            {plan.actionPlan.map((a) => (
              <li key={a.rank}>
                <p className="font-medium">
                  {a.rank}. {a.title}
                  {a.monthlyAmountLater !== undefined
                    ? ` — ${inr(a.monthlyAmount)}/mo now, ${inr(a.monthlyAmountLater)}/mo from month ${a.startsInMonths}`
                    : a.monthlyAmount > 0
                      ? ` — ${inr(a.monthlyAmount)}/mo`
                      : ''}
                </p>
                <p className="mt-0.5 leading-relaxed">{a.reason}</p>
              </li>
            ))}
          </ol>
        </Block>

        {plan.goalPlans.length > 0 && (
          <Block title="Your goals" breakBefore>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--border-strong)] text-left">
                  <th className="pb-2 font-medium">Goal</th>
                  <th className="pb-2 text-right font-medium">Years</th>
                  <th className="pb-2 text-right font-medium">Cost then</th>
                  <th className="pb-2 text-right font-medium">Needs / month</th>
                  <th className="pb-2 text-right font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {plan.goalPlans.map((g) => (
                  <tr key={g.goalId} className="border-b border-[color:var(--border)] align-top">
                    <td className="py-2 pr-3">
                      <p className="font-medium">{g.name}</p>
                      {g.negotiation && (
                        <p className="mt-1 leading-relaxed">{g.negotiation}</p>
                      )}
                    </td>
                    <td className="py-2 text-right">{g.yearsToTarget}</td>
                    <td className="py-2 text-right">{inr(g.futureCost)}</td>
                    <td className="py-2 text-right">{inr(g.requiredMonthlySIP)}</td>
                    <td className="py-2 whitespace-nowrap text-right">{title(g.feasibility)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
        )}

        {advisory && plan.aggregateAllocation.length > 0 && (
          <Block title="Where to invest each month">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--border-strong)] text-left">
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 text-right font-medium">Share</th>
                  <th className="pb-2 text-right font-medium">Monthly</th>
                </tr>
              </thead>
              <tbody>
                {plan.aggregateAllocation.map((s) => (
                  <tr key={s.instrument.id} className="border-b border-[color:var(--border)] align-top">
                    <td className="py-2 pr-3">
                      <p className="font-medium">{s.instrument.label}</p>
                      <p className="mt-0.5 leading-relaxed">{s.rationale}</p>
                    </td>
                    <td className="py-2 text-right">{pct(s.percent)}</td>
                    <td className="py-2 text-right font-medium">{inr(s.monthlyAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
        )}

        <Block title="If things go wrong">
          <div className="space-y-3 text-sm">
            {plan.stressTests.map((t) => (
              <div key={t.key}>
                <p className="font-medium">
                  {t.title} — {title(t.severity)}
                </p>
                <p className="mt-0.5 leading-relaxed text-[color:var(--text-muted)]">
                  {t.headline} {t.whatBreaks}
                </p>
                <p className="mt-0.5 leading-relaxed">{t.mitigation}</p>
              </div>
            ))}
          </div>
        </Block>

        <Block title="Tax">
          <p className="text-sm leading-relaxed text-[color:var(--text-muted)]">
            Old regime {inr(plan.taxRecommendation.oldRegimeTax)} · new regime{' '}
            {inr(plan.taxRecommendation.newRegimeTax)} — the{' '}
            <strong>{plan.taxRecommendation.recommendedRegime} regime</strong> saves{' '}
            {inr(plan.taxRecommendation.annualSaving)} a year.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {plan.taxRecommendation.notes.map((n, i) => (
              <li key={i}>• {n}</li>
            ))}
          </ul>
        </Block>

        {/* Never allowed to be clipped. Its own page if it needs one. */}
        <Block title="Important information" breakBefore>
          <ul className="space-y-1.5 text-xs leading-relaxed">
            {plan.disclosures.map((disc, i) => (
              <li key={i}>{disc}</li>
            ))}
          </ul>
        </Block>
      </div>
    </>
  );
}

function Block({
  title,
  children,
  breakBefore,
}: {
  title: string;
  children: React.ReactNode;
  breakBefore?: boolean;
}) {
  return (
    <section className={`plan-section mt-7 ${breakBefore ? 'plan-break' : ''}`}>
      <h2 className="mb-2 border-b border-[color:var(--border)] pb-1 text-base font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs">{label}</dt>
      <dd className="mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}
