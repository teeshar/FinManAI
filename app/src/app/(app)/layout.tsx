import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth';
import { Nav } from '../../components/Shell';

/**
 * Everything under (app) holds financial data, so the guard is here rather than
 * repeated per page: signed in, and two-factor enabled. A page that forgets to
 * check cannot exist inside this group.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (!user.stronglyAuthenticated) redirect('/totp/enrol');

  return (
    <>
      <Nav user={user} />
      {children}
    </>
  );
}
