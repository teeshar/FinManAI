'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The two answers to an annual review.
 *
 * "Nothing has changed" is a real answer and the common one, so it is a button
 * rather than something you reach by walking eight steps and pressing save at
 * the end. A review flow that makes confirming as much work as changing is a
 * review flow people stop completing, and then the record says nothing.
 */
export function ReviewActions({ hasPendingChanges }: { hasPendingChanges: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const confirmUnchanged = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/profile/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome: 'unchanged' }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error);
        return;
      }
      setDone(
        `Recorded. Your next review is due in ${body.nextReviewInDays} days, and your plan is current again.`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-8">
      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-[color:var(--bad-border)] bg-[color:var(--bad-bg)] p-4 text-sm leading-relaxed text-[color:var(--bad-fg)]">
          {error}
        </div>
      )}
      {done && (
        <div className="mb-4 rounded-lg border border-[color:var(--good-border)] bg-[color:var(--good-bg)] p-4 text-sm leading-relaxed text-[color:var(--good-fg)]">
          {done}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={confirmUnchanged}
          disabled={busy || hasPendingChanges || done !== null}
          className="btn btn-primary text-sm"
          title={
            hasPendingChanges
              ? 'Your saved answers have already changed — finish the update instead.'
              : undefined
          }
        >
          {busy ? 'Recording…' : 'Everything above is still true'}
        </button>
        <button
          onClick={() => router.push('/onboarding/1')}
          className="btn btn-secondary text-sm"
        >
          Something has changed — let me update it
        </button>
      </div>

      <p className="mt-4 text-sm leading-relaxed">
        Confirming takes a second and is a complete answer. If you update instead, saving the
        new version counts as your review — you do not need to come back here afterwards.
      </p>
    </div>
  );
}
