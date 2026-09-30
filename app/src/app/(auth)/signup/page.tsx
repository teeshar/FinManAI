import { AuthPanel } from '../../../components/AuthPanel';
import { googleEnabled } from '../../../lib/oauth-google';

/** The same screen as `/login`, opened on the create-account tab. */
export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <AuthPanel initialMode="signup" googleEnabled={googleEnabled()} initialError={error} />;
}
