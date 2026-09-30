'use client';

import { useRouter } from 'next/navigation';

/**
 * Sign out.
 *
 * A client component rather than a plain form POST because the logout route
 * returns JSON — a form submission would navigate the browser to it and render
 * `{"status":"signed_out"}` as a page. The session is revoked server-side
 * either way; this just lands the user somewhere sensible afterwards.
 */
export function SignOut() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        router.push('/login');
        router.refresh();
      }}
      className="btn btn-secondary btn-sm"
    >
      Sign out
    </button>
  );
}
