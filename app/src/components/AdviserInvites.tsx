'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export type Invite = { adviserId: string; adviserEmail: string; invitedAt: string; status: string };

/**
 * Pending adviser invitations, on the client's own dashboard.
 *
 * Accepting is deliberately the client's action and nowhere else's: nothing an
 * adviser does can grant them access to someone's finances. The API enforces
 * that; this is the only place in the product where the decision is offered.
 *
 * Revoking is offered on the same footing as accepting, and stays available
 * afterwards — consent that cannot be withdrawn is not consent.
 */
export function AdviserInvites({ invites }: { invites: Invite[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (invites.length === 0) return null;

  const decide = async (adviserId: string, action: 'accept' | 'revoke') => {
    setBusy(adviserId);
    setError(null);
    try {
      const res = await fetch('/api/adviser/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adviserId, action }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card divide-y" style={{ borderColor: 'var(--border)' }}>
      {error && (
        <p
          role="alert"
          className="m-4 rounded-lg border p-3 text-sm"
          style={{ background: 'var(--bad-bg)', borderColor: 'var(--bad-border)', color: 'var(--bad-fg)' }}
        >
          {error}
        </p>
      )}
      {invites.map((i) => {
        const active = i.status === 'active';
        return (
          <div
            key={i.adviserId}
            className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 p-4"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <p className="truncate font-medium">{i.adviserEmail}</p>
                <span
                  className="chip"
                  style={
                    active
                      ? { background: 'var(--good-bg)', color: 'var(--good-fg)' }
                      : { background: 'var(--warn-bg)', color: 'var(--warn-fg)' }
                  }
                >
                  {active ? 'Has access' : 'Awaiting your decision'}
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {active
                  ? 'Can see your profile and your plans. Every time they open your file it is recorded.'
                  : 'Has asked to advise you. They can see nothing until you accept.'}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              {!active && (
                <button
                  onClick={() => decide(i.adviserId, 'accept')}
                  disabled={busy === i.adviserId}
                  className="btn btn-primary btn-sm"
                >
                  Accept
                </button>
              )}
              <button
                onClick={() => decide(i.adviserId, 'revoke')}
                disabled={busy === i.adviserId}
                className={active ? 'btn btn-danger btn-sm' : 'btn btn-secondary btn-sm'}
              >
                {active ? 'Withdraw access' : 'Decline'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
