'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Date range, and the JSON export an annual audit actually consumes.
 *
 * The export is itself an audited event — "who pulled the records, and when" is
 * a question a regulator is entitled to ask about the compliance function too.
 */
export function ExportPanel({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/compliance/export?from=${start}&to=${end}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error);
        return;
      }
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `finmanai-compliance-${start}-to-${end}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {error && (
        <p role="alert" className="mb-3 rounded border border-[color:var(--bad-border)] bg-[color:var(--bad-bg)] p-3 text-sm text-[color:var(--bad-fg)]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs">From</span>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="field mt-1"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs">To</span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="field mt-1"
          />
        </label>
        <button
          onClick={() => router.push(`/compliance?from=${start}&to=${end}`)}
          className="btn btn-secondary"
        >
          Show this period
        </button>
        <button
          onClick={download}
          disabled={busy}
          className="btn btn-primary text-sm"
        >
          {busy ? 'Preparing…' : 'Download JSON'}
        </button>
      </div>
      <p className="mt-3 text-sm leading-relaxed">
        The export contains the chain verification, the event log, and plan, consent and agreement
        metadata. It contains no plan or profile contents by design.
      </p>
    </div>
  );
}
