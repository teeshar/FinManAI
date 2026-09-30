import { AuthPanel } from '../../../components/AuthPanel';
import { googleEnabled } from '../../../lib/oauth-google';

/**
 * Both paths live on one screen — see `AuthPanel`. This route opens on the
 * sign-in tab; `/signup` opens on the other. Keeping two URLs means existing
 * links, the middleware redirect and browser history all keep working.
 */
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <AuthPanel initialMode="signin" googleEnabled={googleEnabled()} initialError={error} />;
}
