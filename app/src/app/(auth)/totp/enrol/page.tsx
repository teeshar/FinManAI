'use client';

/**
 * TOTP enrolment. Mandatory before any financial data is reachable.
 *
 * Recovery codes are shown exactly once and the user must confirm they have
 * saved them — a lost phone with no recovery codes means a lost account.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function EnrolTotp() {
  const router = useRouter();
  const [secret, setSecret] = useState('');
  const [uri, setUri] = useState('');
  const [qrSvg, setQrSvg] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/auth/totp/enrol', { method: 'POST' });
      const body = await res.json();
      if (res.ok) {
        setSecret(body.secret);
        setUri(body.uri);
        setQrSvg(body.qrSvg ?? '');
      } else {
        setError(body.error);
      }
    })();
  }, []);

  const confirm = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const form = new FormData(e.currentTarget);
    const res = await fetch('/api/auth/totp/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: form.get('code') }),
    });
    const body = await res.json();
    if (!res.ok) return setError(body.error);
    setCodes(body.recoveryCodes);
  };

  if (codes.length > 0) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Save your recovery codes</h1>
        <p className="mt-3 leading-relaxed opacity-80">
          These are the only way back into your account if you lose your phone. Each works once.
          They are shown now and never again — we store only their hashes.
        </p>
        <ul
          className="mono mt-6 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-4 tracking-wide"
          style={{ background: 'var(--surface-sunk)', borderColor: 'var(--border)' }}
        >
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <label
          className="mt-6 flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 text-sm leading-relaxed transition-colors"
          style={{
            borderColor: saved ? 'var(--brand-fg)' : 'var(--border)',
            background: saved ? 'var(--brand-tint)' : 'transparent',
          }}
        >
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          I have saved these somewhere safe, not on this device alone.
        </label>
        <button
          disabled={!saved}
          onClick={() => router.push('/onboarding/1')}
          className="btn btn-primary mt-6 w-full"
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Set up two-factor authentication</h1>
      <p className="mt-3 leading-relaxed opacity-80">
        This is required before we hold your financial information. A password on its own is not
        enough to protect a complete picture of someone&apos;s money.
      </p>

      {error && (
        <div role="alert" className="mt-4 rounded-lg border p-3 text-sm leading-relaxed" style={{ background: 'var(--bad-bg)', borderColor: 'var(--bad-border)', color: 'var(--bad-fg)' }}>
          <p>{error}</p>
          {!uri && (
            // Without a secret there is nothing to confirm, so the only way
            // forward is to sign in again. Saying "sign in" without offering a
            // way to do it leaves the user stuck on this page.
            <a href="/login" className="mt-2 inline-block font-medium underline">
              Go to sign in
            </a>
          )}
        </div>
      )}

      {uri && (
        <>
          <p className="mt-6 text-sm opacity-80">
            Scan this in Google Authenticator, Authy, 1Password or any similar app:
          </p>
          {/*
            The SVG is generated server-side by our own code from a string we
            produced — never third-party markup — so injecting it is safe here,
            and it keeps a QR library out of the client bundle. A white plate
            behind it because scanners fail on a dark background.
          */}
          {qrSvg && (
            /* Always a white plate, in both themes — scanners fail on a dark
               background, and a QR nobody can scan is a locked account. */
            <div
              className="mt-3 flex justify-center rounded-lg border p-4 [&_svg]:h-52 [&_svg]:w-52"
              style={{ background: '#fff', borderColor: 'var(--border)' }}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          )}

          <details className="mt-4">
            <summary
              className="cursor-pointer text-sm underline underline-offset-2"
              style={{ color: 'var(--text-muted)' }}
            >
              Can&apos;t scan it? Enter the key by hand
            </summary>
            <p className="mt-2.5 text-sm" style={{ color: 'var(--text-muted)' }}>
              Type this into your authenticator app:
            </p>
            <p
              className="mono mt-2 break-all rounded-lg border p-3 font-medium tracking-wide"
              style={{ background: 'var(--surface-sunk)', borderColor: 'var(--border)' }}
            >
              {secret}
            </p>
          </details>
        </>
      )}

      {/* Only ask for a code once a secret has actually been issued. */}
      {uri && (
      <form method="post" onSubmit={confirm} className="mt-8 space-y-4">
        <div>
          <label htmlFor="code" className="label">
            Enter the 6-digit code to confirm
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            placeholder="000000"
            className="field mono mt-1.5 tracking-[0.3em]"
          />
        </div>
        <button className="btn btn-primary w-full">
          Confirm
        </button>
      </form>
      )}
    </div>
  );
}
