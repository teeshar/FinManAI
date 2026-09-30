'use client';

/**
 * The Spending step, inverted.
 *
 * A form asks you to recall twelve figures. This shows you twelve figures and
 * asks you to correct the ones that are wrong. The task changes from recall to
 * recognition, which is both faster and — for household spending, where people
 * systematically underestimate — more accurate.
 *
 * Three things carry the honesty of it:
 *
 *   Provenance is visible per row, always. A figure we guessed and a figure you
 *   gave us are not the same kind of fact, and a screen that renders them
 *   identically is lying about where its numbers came from. Suitability rests
 *   on client-provided information; an estimate nobody disagreed with is not
 *   that, so it is labelled until somebody says otherwise.
 *
 *   The total is never hidden. Pre-filled fields make an order-of-magnitude
 *   slip easier to skim past, not harder — so the bar and the arithmetic under
 *   it are on screen the whole time. A form cannot say "₹94,000 of your ₹80,000
 *   is spoken for"; this can, and that sentence is the entire point of it.
 *
 *   Accepting is deliberate, and bounded. Rent and food are roughly 40% of
 *   outgoings between them, so they cannot be waved through in bulk — see
 *   `BULK_ACCEPTABLE` in `spending-baseline.ts` for which categories can and
 *   the reasoning for the line.
 */

import { useMemo, useState } from 'react';
import {
  BULK_ACCEPTABLE,
  LOAD_BEARING,
  estimateSpending,
  type ExpenseKey,
  type Provenance,
  type SpendingBasis,
} from '../lib/spending-baseline';

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

type Row = {
  key: ExpenseKey;
  label: string;
  help?: string;
  /** Annual rather than monthly — only `annualIrregular`. */
  annual?: boolean;
};

/**
 * Ordered largest-first rather than by the schema's field order. Somebody
 * checking a sketch of their own life checks the big numbers and skims the
 * rest, so the big numbers go where the attention is.
 */
const ROWS: Row[] = [
  { key: 'rentOrHome', label: 'Rent or home upkeep', help: 'Not the home-loan EMI — that comes later, under loans.' },
  { key: 'foodAndGroceries', label: 'Food and groceries' },
  { key: 'transportation', label: 'Transport and fuel' },
  { key: 'lifestyleAndEntertainment', label: 'Lifestyle and eating out' },
  { key: 'utilities', label: 'Utilities' },
  { key: 'insurancePremiums', label: 'Insurance premiums' },
  { key: 'healthcare', label: 'Healthcare, out of pocket' },
  { key: 'education', label: 'Education fees', help: 'Left at zero unless you tell us otherwise.' },
  { key: 'dependentRelated', label: 'Support sent to family', help: 'Left at zero unless you tell us otherwise.' },
  { key: 'subscriptions', label: 'Subscriptions' },
  { key: 'otherRecurring', label: 'Anything else, monthly' },
  {
    key: 'annualIrregular',
    label: 'Irregular yearly spending',
    annual: true,
    help: 'Festivals, travel, renewals, repairs. Lumpy costs are what quietly break a monthly budget, so we spread them across the year.',
  },
];

export function SpendingPortrait({
  basis,
  values,
  provenance,
  onChange,
}: {
  basis: SpendingBasis;
  values: Partial<Record<ExpenseKey, number>>;
  provenance: Partial<Record<ExpenseKey, Provenance>>;
  onChange: (values: Record<ExpenseKey, number>, provenance: Record<ExpenseKey, Provenance>) => void;
}) {
  const estimate = useMemo(() => estimateSpending(basis), [basis]);

  // A row shows the saved answer if there is one, otherwise the sketch.
  const amount = (k: ExpenseKey) => values[k] ?? estimate[k];
  const state = (k: ExpenseKey): Provenance => provenance[k] ?? 'estimated';

  const [openHelp, setOpenHelp] = useState<ExpenseKey | null>(null);

  const commit = (next: Partial<Record<ExpenseKey, number>>, nextProv: Partial<Record<ExpenseKey, Provenance>>) => {
    const v = {} as Record<ExpenseKey, number>;
    const p = {} as Record<ExpenseKey, Provenance>;
    for (const r of ROWS) {
      v[r.key] = next[r.key] ?? values[r.key] ?? estimate[r.key];
      p[r.key] = nextProv[r.key] ?? provenance[r.key] ?? 'estimated';
    }
    onChange(v, p);
  };

  const setAmount = (k: ExpenseKey, n: number) => commit({ [k]: n }, { [k]: 'entered' });
  const accept = (k: ExpenseKey) => commit({ [k]: amount(k) }, { [k]: 'accepted' });

  const acceptRest = () => {
    const v: Partial<Record<ExpenseKey, number>> = {};
    const p: Partial<Record<ExpenseKey, Provenance>> = {};
    for (const k of BULK_ACCEPTABLE) {
      if (state(k) === 'estimated') {
        v[k] = amount(k);
        p[k] = 'accepted';
      }
    }
    commit(v, p);
  };

  /* -------------------------------------------------------------- */

  const monthly = ROWS.filter((r) => !r.annual).reduce((s, r) => s + amount(r.key), 0);
  const spreadIrregular = Math.round(amount('annualIrregular') / 12);
  const totalMonthly = monthly + spreadIrregular;
  const surplus = basis.monthlyTakeHome - totalMonthly;
  const overspent = surplus < 0;

  /*
   * Categories we deliberately do not guess sit at ₹0, which looks identical to
   * an answered question. For a household with dependants that is the single
   * biggest way this screen can under-read: checked against the nine test
   * households, the two whose sketch fell furthest below their real spending
   * were both families, and school fees were most of the difference. So it is
   * named rather than left to be noticed.
   */
  const unpromptedZero =
    basis.dependentMembers > 0 && amount('education') === 0 && state('education') === 'estimated';

  const stillEstimated = ROWS.filter((r) => state(r.key) === 'estimated');
  const bulkLeft = BULK_ACCEPTABLE.filter((k) => state(k) === 'estimated');
  const bigLeft = LOAD_BEARING.filter((k) => state(k) === 'estimated');

  return (
    <div className="space-y-5">
      {/* ---- The sketch, and what it was built from ---- */}
      <section className="card-raised overflow-hidden">
        <div className="border-b p-5 sm:p-6" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-lg font-semibold tracking-tight">
            Here is roughly what a household like yours spends
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Built from what you have already told us — {inr(basis.monthlyTakeHome)} a month,{' '}
            {basis.cityTier === 'metro' ? 'a metro' : basis.cityTier === 'tier2' ? 'a tier-2 city' : 'a tier-3 town'},{' '}
            {basis.familyMembers} {basis.familyMembers === 1 ? 'person' : 'people'}. It is a starting
            sketch, not a finding about you. Correct anything that is wrong; that is the whole task.
          </p>
        </div>

        {/* ---- Running total. Never hidden. ---- */}
        <div className="p-5 sm:p-6">
          <Bar spent={totalMonthly} income={basis.monthlyTakeHome} />

          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--text)' }}>{inr(totalMonthly)}</strong> of your{' '}
              {inr(basis.monthlyTakeHome)} is spoken for
              {spreadIrregular > 0 && (
                <>
                  {' '}
                  <span style={{ color: 'var(--text-faint)' }}>
                    (including {inr(spreadIrregular)} a month set aside for the yearly costs)
                  </span>
                </>
              )}
            </p>
            <p
              className="text-sm font-semibold"
              style={{ color: overspent ? 'var(--bad-fg)' : 'var(--good-fg)' }}
            >
              {overspent ? `${inr(-surplus)} short` : `${inr(surplus)} left over`}
            </p>
          </div>

          {overspent && (
            <p
              className="mt-4 rounded-lg border p-3.5 text-sm leading-relaxed"
              style={{ background: 'var(--bad-bg)', borderColor: 'var(--bad-border)', color: 'var(--bad-fg)' }}
            >
              This adds up to more than you earn. That may well be true — plenty of households run a
              deficit, and if so we will plan for it rather than pretend otherwise. But it is also
              what a mistyped figure looks like, so it is worth a second look before you continue.
            </p>
          )}
        </div>
      </section>

      {/* ---- The rows ---- */}
      <section className="card-raised overflow-hidden">
        <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {ROWS.map((row) => (
            <ExpenseRow
              key={row.key}
              row={row}
              amount={amount(row.key)}
              estimate={estimate[row.key]}
              provenance={state(row.key)}
              share={row.annual ? null : amount(row.key) / Math.max(1, basis.monthlyTakeHome)}
              helpOpen={openHelp === row.key}
              onToggleHelp={() => setOpenHelp((k) => (k === row.key ? null : row.key))}
              onAmount={(n) => setAmount(row.key, n)}
              onAccept={() => accept(row.key)}
            />
          ))}
        </ul>
      </section>

      {unpromptedZero && (
        <section
          className="rounded-lg border p-4 sm:p-5"
          style={{ background: 'var(--info-bg)', borderColor: 'var(--info-border)', color: 'var(--info-fg)' }}
        >
          <p className="font-semibold">We have not guessed your education costs</p>
          <p className="mt-1.5 text-sm leading-relaxed">
            You told us {basis.dependentMembers === 1 ? 'someone depends' : `${basis.dependentMembers} people depend`}{' '}
            on you. School and college fees vary far too much between households for a guess to be
            worth anything, so that row is sitting at zero — which will overstate what you have left
            over until you fill it in.
          </p>
        </section>
      )}

      {/* ---- What is still a guess ---- */}
      {stillEstimated.length > 0 ? (
        <section
          className="rounded-lg border p-4 sm:p-5"
          style={{ background: 'var(--warn-bg)', borderColor: 'var(--warn-border)', color: 'var(--warn-fg)' }}
        >
          <p className="font-semibold">
            {stillEstimated.length === 1
              ? 'One figure is still our guess'
              : `${stillEstimated.length} figures are still our guesses`}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed">
            {bigLeft.length > 0 ? (
              <>
                Rent and food are around forty percent of what a household spends, so those two need
                you to look at them directly — a plan built on our guess at your rent is not built
                on your information.
              </>
            ) : (
              <>
                The rest are small enough that accepting them together is reasonable. We record that
                you accepted them, and which ones, so the plan can say where each figure came from.
              </>
            )}
          </p>
          {bulkLeft.length > 0 && (
            <button
              type="button"
              onClick={acceptRest}
              className="btn btn-secondary btn-sm mt-3.5"
            >
              These {bulkLeft.length} look about right
            </button>
          )}
        </section>
      ) : (
        <section
          className="rounded-lg border p-4 sm:p-5"
          style={{ background: 'var(--good-bg)', borderColor: 'var(--good-border)', color: 'var(--good-fg)' }}
        >
          <p className="font-semibold">Every figure here is now yours</p>
          <p className="mt-1.5 text-sm leading-relaxed">
            Nothing on this step is still an estimate we made. That is what lets the plan cite your
            spending as a reason for what it recommends.
          </p>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Spending against income, as one bar.
 *
 * Overspending is drawn as the bar running past its own track rather than
 * simply turning red, because the shape says "more than there is" without
 * needing the colour to be read.
 */
function Bar({ spent, income }: { spent: number; income: number }) {
  const over = spent > income;
  const fill = Math.min(100, (spent / Math.max(1, income)) * 100);
  const overflow = over ? Math.min(100, ((spent - income) / Math.max(1, income)) * 100) : 0;

  return (
    <div>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--surface-sunk)' }}
        role="img"
        aria-label={`${Math.round((spent / Math.max(1, income)) * 100)} percent of your take-home pay is committed`}
      >
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${fill}%`,
            backgroundImage: over
              ? undefined
              : 'linear-gradient(90deg, var(--brand-grad-from), var(--brand-grad-to))',
            background: over ? 'var(--bad-fg)' : undefined,
          }}
        />
        {overflow > 0 && (
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${overflow}%`, background: 'var(--bad-border)' }}
          />
        )}
      </div>
    </div>
  );
}

const PROVENANCE_STYLE: Record<Provenance, { label: string; token: string }> = {
  estimated: { label: 'our estimate', token: 'warn' },
  accepted: { label: 'you accepted', token: 'good' },
  entered: { label: 'yours', token: 'good' },
};

function ExpenseRow({
  row,
  amount,
  estimate,
  provenance,
  share,
  helpOpen,
  onToggleHelp,
  onAmount,
  onAccept,
}: {
  row: Row;
  amount: number;
  estimate: number;
  provenance: Provenance;
  share: number | null;
  helpOpen: boolean;
  onToggleHelp: () => void;
  onAmount: (n: number) => void;
  onAccept: () => void;
}) {
  const prov = PROVENANCE_STYLE[provenance];
  const isEstimate = provenance === 'estimated';
  const moved = provenance === 'entered' && amount !== estimate;

  return (
    <li className="p-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`sp-${row.key}`} className="text-sm font-medium">
              {row.label}
            </label>
            <span
              className="chip"
              style={{ background: `var(--${prov.token}-bg)`, color: `var(--${prov.token}-fg)` }}
            >
              {prov.label}
            </span>
            {row.help && (
              <button
                type="button"
                onClick={onToggleHelp}
                aria-expanded={helpOpen}
                className="text-xs underline underline-offset-2"
                style={{ color: 'var(--text-faint)' }}
              >
                {helpOpen ? 'hide' : 'why'}
              </button>
            )}
          </div>
          {helpOpen && row.help && (
            <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {row.help}
            </p>
          )}
          {/* What we thought, once you have said otherwise. Keeping the estimate
              on screen is how someone spots that they corrected the wrong row. */}
          {moved && (
            <p className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
              we guessed {inr(estimate)}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {share !== null && share > 0.005 && (
            <span
              className="hidden w-12 text-right text-xs tabular-nums sm:inline"
              style={{ color: 'var(--text-faint)' }}
            >
              {(share * 100).toFixed(0)}%
            </span>
          )}
          <div className="relative w-36">
            <span
              className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              ₹
            </span>
            <input
              id={`sp-${row.key}`}
              type="number"
              inputMode="numeric"
              value={amount === 0 ? '' : amount}
              placeholder="0"
              onChange={(e) => onAmount(e.target.value === '' ? 0 : Math.round(Number(e.target.value)))}
              className="field pl-7 text-right"
              style={
                isEstimate
                  ? { color: 'var(--text-muted)', borderStyle: 'dashed' }
                  : undefined
              }
            />
          </div>
          {isEstimate ? (
            <button type="button" onClick={onAccept} className="btn btn-secondary btn-sm">
              Looks right
            </button>
          ) : (
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center"
              style={{ color: 'var(--good-fg)' }}
            >
              <svg
                width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
          )}
        </div>
      </div>
      {row.annual && (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--text-faint)' }}>
          per year — about {inr(Math.round(amount / 12))} a month
        </p>
      )}
    </li>
  );
}
