/**
 * Review and commit. The only place a profile version is created.
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Review() {
  const router = useRouter();
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const commit = async () => {
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch('/api/profile/commit', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        setErrors(body.errors ?? [body.error]);
        return;
      }
      if (body.status === 'unchanged') {
        setMessage(body.message);
        return;
      }
      const plan = await fetch('/api/plan/generate', { method: 'POST' });
      const planBody = await plan.json();
      if (!plan.ok) {
        setErrors([planBody.error]);
        return;
      }
      router.push(`/plan/${planBody.planId}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-12">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--brand-fg)' }}>
        Last step
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Ready to build your plan</h1>
      <p className="prose-advice mt-3" style={{ color: 'var(--text-muted)' }}>
        We will save this version of your profile and generate a plan from it. The profile is stored
        as a dated snapshot rather than overwritten, so any plan can always be explained by the exact
        information that produced it.
      </p>

      {/*
        What happens next, before it happens. Generating a plan can take a few
        seconds and ends on a different page; saying so up front is the
        difference between waiting and wondering whether the button worked.
      */}
      <ol className="mt-8 space-y-3">
        {[
          ['Your answers are saved as a new, dated profile version.', 'Nothing you entered before is overwritten.'],
          ['The engine works through them in order.', 'Cashflow, then protection, then debt, then goals.'],
          ['You land on your plan.', 'It stays on your dashboard, and stays readable for as long as you have an account.'],
        ].map(([title, body], i) => (
          <li key={title} className="card flex gap-4 p-4">
            <span
              aria-hidden="true"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
              style={{
                backgroundImage: 'linear-gradient(var(--brand-grad-from), var(--brand-grad-to))',
                color: '#fff',
              }}
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{title}</p>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {errors.length > 0 && (
        <div
          role="alert"
          className="mt-8 rounded-lg border p-4"
          style={{ background: 'var(--bad-bg)', borderColor: 'var(--bad-border)', color: 'var(--bad-fg)' }}
        >
          <p className="font-semibold">Not quite ready</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <button
            onClick={() => router.push('/onboarding/1')}
            className="mt-3 text-sm font-medium underline underline-offset-2"
          >
            Go back and fix these
          </button>
        </div>
      )}

      {message && <p className="aside-note mt-8">{message}</p>}

      <div className="mt-9 flex flex-wrap gap-3">
        <button onClick={commit} disabled={busy} className="btn btn-primary btn-lg">
          {busy ? 'Building your plan…' : 'Build my plan'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/onboarding/8')}
          disabled={busy}
          className="btn btn-secondary btn-lg"
        >
          Back to the questions
        </button>
      </div>
    </div>
  );
}
