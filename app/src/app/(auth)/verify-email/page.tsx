'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * useSearchParams() opts a component out of static prerendering, so the part
 * that reads the token lives inside a Suspense boundary. Without it the whole
 * page fails to build.
 */
export default function VerifyEmail() {
  return (
    <Suspense fallback={<Status>Verifying your email…</Status>}>
      <VerifyEmailInner />
    </Suspense>
  );
}

function VerifyEmailInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setState('failed');
      setError('This link is missing its token.');
      return;
    }
    void (async () => {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json();
      if (res.ok) {
        setState('done');
        setTimeout(() => router.push('/login'), 1500);
      } else {
        setState('failed');
        setError(body.error);
      }
    })();
  }, [params, router]);

  return (
    <div className="text-center">
      {state === 'working' && (
        <>
          <Spinner />
          <p className="mt-4" style={{ color: 'var(--text-muted)' }}>
            Verifying your email…
          </p>
        </>
      )}
      {state === 'done' && (
        <>
          <Badge tone="good" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Email verified</h1>
          <p className="mt-2.5" style={{ color: 'var(--text-muted)' }}>
            Taking you to sign in…
          </p>
        </>
      )}
      {state === 'failed' && (
        <>
          <Badge tone="bad" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">Could not verify</h1>
          <p className="mt-2.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {error}
          </p>
          <a href="/signup" className="btn btn-secondary mt-6">
            Start again
          </a>
        </>
      )}
    </div>
  );
}

/** A tick or a cross, sized so the outcome is legible before the words are. */
function Badge({ tone }: { tone: 'good' | 'bad' }) {
  return (
    <div
      className="mx-auto flex h-12 w-12 items-center justify-center rounded-full"
      style={{ background: `var(--${tone}-bg)`, color: `var(--${tone}-fg)` }}
    >
      <svg
        width="24" height="24" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"
      >
        {tone === 'good' ? <path d="M20 6 9 17l-5-5" /> : <path d="M18 6 6 18M6 6l12 12" />}
      </svg>
    </div>
  );
}

function Spinner() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto h-8 w-8 animate-spin rounded-full border-2"
      style={{ borderColor: 'var(--border-strong)', borderTopColor: 'var(--brand-fg)' }}
    />
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-center">
      <p className="opacity-80">{children}</p>
    </div>
  );
}
