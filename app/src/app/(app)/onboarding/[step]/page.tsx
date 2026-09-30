/**
 * Onboarding step. Server component: loads the saved draft, hands it to the
 * client form. Resumable by design — people complete this over two sittings.
 */

import { redirect, notFound } from 'next/navigation';
import WizardForm from '../../../../components/WizardForm';
import { stepDef, WIZARD } from '../../../../lib/wizard-config';
import { TOTAL_STEPS } from '../../../../lib/validation';
import { loadDraft } from '../../../../lib/profile-service';
import { readBasis } from '../../../../lib/spending-baseline';
import { currentUser } from '../../../../lib/auth';

export default async function OnboardingStep({
  params,
}: {
  params: Promise<{ step: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!user.stronglyAuthenticated) redirect('/totp/enrol');

  const step = Number((await params).step);
  const def = stepDef(step);
  if (!def) notFound();

  const draft = await loadDraft(user.id);
  const initial = (draft[step] as Record<string, unknown>) ?? {};

  /*
   * The Spending step opens with a sketch rather than empty boxes, and the
   * sketch is built from answers given on earlier steps. Someone who arrived
   * here by URL, or whose earlier steps are not in this draft, has no basis to
   * build one from and gets the plain fields instead — a portrait drawn from
   * nothing would be worse than no portrait.
   */
  const basis = step === 3 ? readBasis(draft) : null;

  return (
    <WizardForm
      def={def}
      steps={WIZARD.map((w) => ({ step: w.step, short: w.short }))}
      initial={initial}
      spendingBasis={basis}
      totalSteps={TOTAL_STEPS}
    />
  );
}
