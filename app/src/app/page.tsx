import { redirect } from 'next/navigation';
import { currentUser } from '../lib/auth';
import { prisma } from '../lib/db';

/**
 * Where the front door leads.
 *
 * A returning user used to be sent back to onboarding step 1 regardless of
 * whether they had already finished it, which made the product look like it had
 * forgotten them. Anyone with a committed profile now lands on their dashboard;
 * only someone genuinely part-way through sees the wizard.
 */
export default async function Home() {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!user.stronglyAuthenticated) redirect('/totp/enrol');

  if (user.role === 'ADVISER') redirect('/adviser');
  if (user.role === 'COMPLIANCE') redirect('/compliance');

  const profile = await prisma.profile.findFirst({
    where: { userId: user.id, isActive: true },
    select: { id: true },
  });

  redirect(profile ? '/dashboard' : '/onboarding/1');
}
