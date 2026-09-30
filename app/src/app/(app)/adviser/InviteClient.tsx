'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Invite a client.
 *
 * The response is deliberately identical whether or not the address has an
 * account — an adviser should not be able to use this form to discover who is
 * a user — so the confirmation text says what actually happened rather than
 * implying the invitation definitely reached someone.
 */
export function InviteClient() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invite = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/adviser/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error);
        return;
      }
      setSent(true);
      setEmail('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg">
      {error && (
        <p role="alert" className="mb-3 rounded border border-[color:var(--bad-border)] bg-[color:var(--bad-bg)] p-3 text-sm text-[color:var(--bad-fg)]">
          {error}
        </p>
      )}
      {sent && (
        <p className="mb-3 rounded border border-[color:var(--border)] bg-[color:var(--surface-sunk)] p-3 text-sm leading-relaxed text-[color:var(--text-muted)]">
          If that address has an account, an invitation is waiting for them. They appear in your
          list as <em>active</em> once they accept — until then you cannot see anything of theirs.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="client@example.com"
          className="field min-w-64 flex-1 text-sm"
        />
        <button
          onClick={invite}
          disabled={busy || !email.trim()}
          className="btn btn-primary"
        >
          {busy ? 'Sending…' : 'Invite'}
        </button>
      </div>
    </div>
  );
}
