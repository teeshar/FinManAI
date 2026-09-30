'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ApprovalState } from '../../../../lib/adviser-service';

type Note = { id: string; adviserId: string; body: string; createdAt: string };

/**
 * The adviser's side of a plan: notes, and the decision to release it.
 *
 * Shown only to an adviser reading a client's plan — the client sees the
 * *outcome* of a release decision on their own plan, but not the working. An
 * adviser's note is their reasoning, and a note written knowing the client is
 * reading it over your shoulder is a worse record than one written honestly.
 *
 * Withholding requires a reason. It is retained with the plan, and "why did you
 * not release this" is exactly the question an audit asks four years later.
 */
export function AdviserPanel({
  planId,
  approval,
  notes: initialNotes,
}: {
  planId: string;
  approval: ApprovalState;
  notes: Note[];
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addNote = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/plan/${planId}/notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error);
        return;
      }
      setNotes([
        ...notes,
        { id: result.noteId, adviserId: 'you', body, createdAt: new Date().toISOString() },
      ]);
      setDraft('');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: 'approved' | 'withheld') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/plan/${planId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, reason: reason.trim() || undefined }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8 rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--surface-sunk)] p-5">
      <h2 className="font-semibold tracking-tight">Adviser</h2>

      {error && (
        <p role="alert" className="mt-3 rounded border border-[color:var(--bad-border)] bg-[color:var(--bad-bg)] p-3 text-sm leading-relaxed text-[color:var(--bad-fg)]">
          {error}
        </p>
      )}

      {approval.required ? (
        <div className="mt-4">
          <p className="text-sm text-[color:var(--text-muted)]">
            Release status:{' '}
            <strong>
              {approval.decision === 'approved'
                ? 'released to the client'
                : approval.decision === 'withheld'
                  ? 'held back'
                  : 'not yet decided'}
            </strong>
            {approval.reason && (
              <span style={{ color: 'var(--text-muted)' }}> — {approval.reason}</span>
            )}
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason — required if you are holding this back. Retained with the plan."
            rows={2}
            className="field mt-3 text-sm"
          />
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => decide('approved')}
              disabled={busy}
              className="btn btn-primary text-sm"
            >
              Release to client
            </button>
            <button
              onClick={() => decide('withheld')}
              disabled={busy}
              className="btn btn-secondary text-sm"
            >
              Hold back
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm leading-relaxed">
          This deployment is in diagnostic-only mode. A diagnostic report makes no
          recommendation, so there is nothing here for you to sign off.
        </p>
      )}

      <div className="mt-6">
        <h3 className="text-sm font-medium">Your notes</h3>
        <p className="mt-1 text-xs leading-relaxed">
          Retained with the plan for the full five-year window, and encrypted — a note about a
          client&rsquo;s finances is client financial data however informally it is written.
        </p>
        {notes.length > 0 && (
          <ul className="mt-3 space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm leading-relaxed">
                <p className="whitespace-pre-line">{n.body}</p>
                <p className="mt-1 text-xs">
                  {new Date(n.createdAt).toLocaleString('en-IN')}
                </p>
              </li>
            ))}
          </ul>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What you want on the record about this plan."
          rows={3}
          className="field mt-3 text-sm"
        />
        <button
          onClick={addNote}
          disabled={busy || !draft.trim()}
          className="btn btn-secondary mt-2"
        >
          Add note
        </button>
      </div>
    </section>
  );
}
