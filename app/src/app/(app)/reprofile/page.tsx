/**
 * The annual review.
 *
 * SEBI requires the risk profile to be reviewed at least annually or on a
 * material life event. Phase 6 is explicit that this must be a SHORT flow, not
 * the eight-step wizard again: we show what we currently believe, and the
 * client confirms it or changes it.
 *
 * What is shown here is chosen by one rule — these are the inputs that most
 * move the advice, and they are also the ones most likely to have changed in a
 * year. Income, spending, dependants, cover and goals. Asking someone to
 * re-read forty fields is how a five-minute task becomes one nobody completes.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../../../lib/auth';
import { loadActiveProfile } from '../../../lib/profile-service';
import { reviewState, pendingMaterialChanges } from '../../../lib/reprofile';
import { Page, PageTitle, Section, Notice, KeyValue } from '../../../components/Shell';
import { ReviewActions } from './ReviewActions';
import type { FinancialProfile } from '../../../../../engine/src/types';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const dmy = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Which wizard step owns each block, so "that's wrong" leads somewhere useful. */
const OWNING_STEP = { income: 2, spending: 3, family: 4, protection: 6, goals: 7 } as const;

export default async function Reprofile() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const ctx = { userId: user.id, actorId: user.id };
  const [snapshot, state, pending] = await Promise.all([
    loadActiveProfile(user.id, ctx),
    reviewState(user.id),
    pendingMaterialChanges(user.id),
  ]);

  if (!snapshot) redirect('/onboarding/1');

  const p = snapshot.data as FinancialProfile;
  const monthlySpend = Object.entries(p.expenses)
    .filter(([key]) => key !== 'annualIrregular')
    .reduce((sum, [, value]) => sum + (typeof value === 'number' ? value : 0), 0);

  return (
    <Page>
      <PageTitle
        eyebrow="Annual review"
        title="Is this still true?"
        meta={`What you told us when you last saved your profile, on ${dmy(snapshot.createdAt)}. Read it through — if it is all still true, saying so is the whole review.`}
      />

      <div className="mt-8 space-y-3">
        {state.status && state.status.state !== 'current' && (
          <Notice
            tone={state.materiallyOverdue ? 'blocked' : 'warn'}
            title={
              state.materiallyOverdue
                ? 'Your plan is currently shown as a historical record'
                : 'This review is due'
            }
          >
            <p>{state.status.message}</p>
          </Notice>
        )}

        {pending.length > 0 && (
          <Notice tone="warn" title="You have already changed some answers">
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {pending.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="mt-2">
              Because these are unsaved, we cannot record your profile as unchanged.{' '}
              <Link href="/onboarding/review" className="font-medium underline">
                Save the new version
              </Link>{' '}
              — that counts as this year&rsquo;s review.
            </p>
          </Notice>
        )}
      </div>

      <Section title="Money coming in" subtitle="This sets everything downstream — the surplus, the goals, the cover you need.">
        <Facts
          step={OWNING_STEP.income}
          rows={[
            ['Take-home each month', inr(p.income.monthlyTakeHome)],
            ['Gross annual income', inr(p.income.annualGrossIncome)],
            ['Variable pay each year', inr(p.income.annualVariableIncome)],
            ['How steady it is', p.income.incomeStability.replace(/_/g, ' ')],
            ...(p.income.monthlyOtherFamilyIncome > 0
              ? [['Other family income', inr(p.income.monthlyOtherFamilyIncome)] as [string, string]]
              : []),
          ]}
        />
      </Section>

      <Section title="Money going out">
        <Facts
          step={OWNING_STEP.spending}
          rows={[
            ['Total monthly spending', inr(monthlySpend)],
            ['Rent or home loan', inr(p.expenses.rentOrHome)],
            ['Irregular costs each year', inr(p.expenses.annualIrregular)],
          ]}
        />
      </Section>

      <Section title="Who depends on you" subtitle="A change here moves both the life cover you need and the goals we plan for.">
        <Facts
          step={OWNING_STEP.family}
          rows={
            p.dependents.length === 0
              ? [['Dependants', 'None recorded']]
              : p.dependents.map((d) => [
                  `${d.relationship.replace(/_/g, ' ')}, age ${d.age}`,
                  `${inr(d.monthlyRequirement + d.monthlyEducationExpense + d.monthlyMedicalExpense)}/month for ${d.yearsOfDependency} years`,
                ])
          }
        />
      </Section>

      <Section title="Protection">
        <Facts
          step={OWNING_STEP.protection}
          rows={[
            ['Term life cover', p.insurance.termLifeCover > 0 ? inr(p.insurance.termLifeCover) : 'None'],
            [
              'Health cover',
              p.insurance.healthCoverFamilyFloater + p.insurance.healthCoverSelf > 0
                ? inr(p.insurance.healthCoverFamilyFloater + p.insurance.healthCoverSelf)
                : 'None',
            ],
            [
              'Employer health cover',
              p.insurance.employerProvidedHealthCover > 0
                ? `${inr(p.insurance.employerProvidedHealthCover)} — counted at half weight, because it ends with the job`
                : 'None',
            ],
          ]}
        />
      </Section>

      <Section title="What you are saving for">
        <Facts
          step={OWNING_STEP.goals}
          rows={
            p.goals.length === 0
              ? [['Goals', 'None recorded']]
              : p.goals.map((g) => [
                  g.name,
                  `${inr(g.requiredAmountToday)} in today's money, by ${dmy(g.targetDate)} · ${g.priority.replace(/_/g, ' ')}`,
                ])
          }
        />
      </Section>

      <ReviewActions hasPendingChanges={pending.length > 0} />
    </Page>
  );
}

/**
 * One block of the review: the facts, and the one link that leads to the step
 * that owns them. "That's wrong" has to go somewhere, or the review becomes a
 * page people confirm because disagreeing with it is too much work.
 */
function Facts({ rows, step }: { rows: [string, string][]; step: number }) {
  return (
    <div className="card px-5 py-1.5">
      <KeyValue rows={rows} />
      <div className="border-t py-3" style={{ borderColor: 'var(--border)' }}>
        <Link
          href={`/onboarding/${step}`}
          className="text-sm font-medium underline underline-offset-2 hover:no-underline"
          style={{ color: 'var(--brand-fg)' }}
        >
          Change this
        </Link>
      </div>
    </div>
  );
}
