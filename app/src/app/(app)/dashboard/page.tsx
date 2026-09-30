/**
 * The dashboard.
 *
 * Before Phase 6 a returning user was redirected straight back into onboarding
 * step 1, because the product ended at the plan and there was nothing else to
 * show them. That is fine for someone completing a form once and wrong for an
 * advisory relationship, which is what the regulation assumes this is.
 *
 * The order is deliberate. Anything that makes the current advice unreliable —
 * an overdue review, a plan that no longer matches its profile, rules that have
 * changed underneath it — comes before the plan itself. A dashboard that leads
 * with a reassuring summary and buries the staleness notice at the bottom is
 * telling the user what they want to hear.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../../../lib/auth';
import { reviewState, pendingMaterialChanges } from '../../../lib/reprofile';
import { prisma } from '../../../lib/db';
import { Page, PageTitle, Section, Notice, EmptyState } from '../../../components/Shell';
import { AdviserInvites } from '../../../components/AdviserInvites';

const dmy = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const [state, pending] = await Promise.all([
    reviewState(user.id),
    pendingMaterialChanges(user.id),
  ]);

  // Someone who has never committed a profile has no dashboard to look at.
  // Send them to the wizard rather than showing an empty shell.
  if (!state.profileId) redirect('/onboarding/1');

  // Adviser links, pending and active. This is the only place the client can
  // accept one, or withdraw access afterwards.
  const links = await prisma.adviserClient.findMany({
    where: { clientId: user.id, revokedAt: null, status: { in: ['invited', 'active'] } },
    include: { adviser: { select: { id: true, email: true } } },
    orderBy: { invitedAt: 'desc' },
  });

  const plans = await prisma.plan.findMany({
    where: { profile: { userId: user.id } },
    orderBy: { generatedAt: 'desc' },
    select: {
      id: true,
      generatedAt: true,
      advisoryMode: true,
      narrativeSource: true,
      assumptionsVersion: true,
      profileHash: true,
      profile: { select: { version: true, dataHash: true } },
    },
  });

  const review = state.status;

  return (
    <Page wide>
      <PageTitle
        title="Your plan"
        meta={`Profile version ${state.profileVersion} · last reviewed ${
          state.lastReviewedAt ? dmy(state.lastReviewedAt) : 'never'
        }`}
        actions={
          state.latestPlan ? (
            <>
              <Link href={`/plan/${state.latestPlan.id}`} className="btn btn-primary">
                Read your plan
              </Link>
              <Link href={`/plan/${state.latestPlan.id}/print`} className="btn btn-secondary">
                Save as PDF
              </Link>
            </>
          ) : (
            <Link href="/onboarding/review" className="btn btn-primary">
              Generate your first plan
            </Link>
          )
        }
      />

      {/* Anything that undermines the advice goes first. */}
      <div className="mt-8 space-y-3">
        {state.materiallyOverdue && (
          <Notice tone="blocked" title="Your plan is being shown as a historical record">
            <p>
              Your profile was last reviewed {review?.daysSinceProfile} days ago. We will not present
              recommendations built on inputs that old as current advice — not because the plan has
              changed, but because we can no longer vouch for what went into it.{' '}
              <Link href="/reprofile" className="font-medium underline">
                Review it now
              </Link>{' '}
              and it becomes current again.
            </p>
          </Notice>
        )}

        {!state.materiallyOverdue && review?.state === 'overdue' && (
          <Notice tone="warn" title="Your annual review is overdue">
            <p>
              {review.message}{' '}
              <Link href="/reprofile" className="font-medium underline">
                Review your profile
              </Link>{' '}
              — if nothing has changed, saying so is the whole task.
            </p>
          </Notice>
        )}

        {review?.state === 'due_soon' && (
          <Notice tone="warn" title="Your annual review is due soon">
            <p>
              {review.message}{' '}
              <Link href="/reprofile" className="font-medium underline">
                Do it now
              </Link>
              .
            </p>
          </Notice>
        )}

        {state.latestPlan && !state.latestPlan.verifiable && (
          <Notice tone="blocked" title="Your latest plan cannot be verified">
            <p>
              It no longer matches the profile version that produced it, so it is not being shown as
              advice. Generate a fresh plan from your current profile.
            </p>
          </Notice>
        )}

        {state.assumptionsDrift && (
          <Notice tone="warn" title="The rules changed since this plan was built">
            <p>
              Your plan used the {state.assumptionsDrift.planVersion} assumptions; we now use{' '}
              {state.assumptionsDrift.currentVersion}. Tax slabs, small-savings rates and inflation
              all live in that dated set, so your figures can move without you changing anything.{' '}
              <Link href="/onboarding/review" className="font-medium underline">
                Regenerate your plan
              </Link>{' '}
              to see the difference.
            </p>
          </Notice>
        )}

        {pending.length > 0 && (
          <Notice tone="warn" title="You have changes that are not in your plan yet">
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {pending.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="mt-2">
              These are big enough to change the advice.{' '}
              <Link href="/onboarding/review" className="font-medium underline">
                Save your profile and rebuild the plan
              </Link>
              .
            </p>
          </Notice>
        )}

        {review?.state === 'current' && pending.length === 0 && !state.assumptionsDrift && (
          <Notice tone="info" title="Your plan is current">
            <p>{review.message}</p>
          </Notice>
        )}
      </div>

      {links.length > 0 && (
        <Section title="Who can see this">
          <AdviserInvites
            invites={links.map((l) => ({
              adviserId: l.adviser.id,
              adviserEmail: l.adviser.email,
              invitedAt: l.invitedAt.toISOString(),
              status: l.status,
            }))}
          />
        </Section>
      )}

      <Section
        title="Plan history"
        subtitle="Plans are never edited. Regenerating writes a new one and keeps the old, so what you were told in March stays exactly what you were told in March."
        actions={
          plans.length > 1 ? (
            <Link
              href={`/plan/compare?a=${plans[1].id}&b=${plans[0].id}`}
              className="btn btn-secondary btn-sm"
            >
              What changed since last time
            </Link>
          ) : undefined
        }
      >
        {plans.length === 0 ? (
          <EmptyState
            title="No plans yet"
            action={
              <Link href="/onboarding/review" className="btn btn-primary">
                Generate your first plan
              </Link>
            }
          >
            Once your profile is saved we build a plan from it, and every plan you have ever been
            given stays listed here.
          </EmptyState>
        ) : (
          <div className="card scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>Generated</th>
                  <th>Profile</th>
                  <th>Assumptions</th>
                  <th>Explanation</th>
                  <th>Status</th>
                  <th>Compare</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p, i) => {
                  const verifiable = p.profileHash === p.profile.dataHash;
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/plan/${p.id}`} className="font-medium hover:underline">
                          {dmy(p.generatedAt)}
                        </Link>
                        {p.advisoryMode === 'diagnostic_only' && (
                          <span className="chip ml-2">diagnostic only</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>v{p.profile.version}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{p.assumptionsVersion}</td>
                      <td style={{ color: 'var(--text-muted)' }}>
                        {p.narrativeSource === 'llm' ? 'AI-written' : 'Template'}
                      </td>
                      <td>
                        {verifiable ? (
                          <span
                            className="inline-flex items-center gap-1.5"
                            style={{ color: 'var(--good-fg)' }}
                          >
                            <span
                              aria-hidden="true"
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ background: 'currentColor' }}
                            />
                            Verified
                          </span>
                        ) : (
                          <span className="font-medium" style={{ color: 'var(--bad-fg)' }}>
                            Cannot be verified
                          </span>
                        )}
                      </td>
                      <td>
                        {/* Compared against the plan immediately before it, which is
                            the comparison people actually want: what changed last time. */}
                        {i + 1 < plans.length ? (
                          <Link
                            href={`/plan/compare?a=${plans[i + 1].id}&b=${p.id}`}
                            className="underline underline-offset-2 hover:no-underline"
                          >
                            vs previous
                          </Link>
                        ) : (
                          <span style={{ color: 'var(--text-faint)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Keep it current"
        subtitle="Advice is only suitable for the situation it was built for, so the profile behind it has a shelf life."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <ActionCard
            href="/reprofile"
            title="Annual review"
            body="Confirm what we hold is still true. If nothing has changed, saying so is the whole task."
          />
          <ActionCard
            href="/onboarding/1"
            title="Edit your answers"
            body="Go back through the questions. Nothing is overwritten — saving creates a new version."
          />
          <ActionCard
            href="/onboarding/review"
            title="Rebuild my plan"
            body="Generate a fresh plan from your current profile and keep the old one on record."
          />
        </div>
      </Section>
    </Page>
  );
}

/** One of the three ways to keep a profile current. */
function ActionCard({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href as never} className="card card-link block p-4">
      <p className="font-medium">{title}</p>
      <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        {body}
      </p>
    </Link>
  );
}
