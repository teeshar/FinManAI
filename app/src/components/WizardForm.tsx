'use client';

/**
 * The wizard form.
 *
 * One renderer for all eight steps, driven by `wizard-config.ts`. Everything
 * here is about not losing people: autosave so a dropped connection does not
 * cost forty minutes, inline errors rather than a wall at submit, and help text
 * that explains why an intrusive question is being asked.
 *
 * Three things about the layout are load-bearing rather than decorative.
 *
 * The rail names all eight steps. "Step 3 of 8" tells you how much is left but
 * not what is coming, and the questions here get more personal as they go —
 * someone who can see that "Family" and "Assets & debts" are ahead is being
 * asked to consent to the whole thing, not led into it one screen at a time.
 *
 * The action bar is fixed to the bottom. These steps are long enough to scroll,
 * and a Continue button that lives at the end of the document means the save
 * status is off-screen for most of the time you are typing.
 *
 * Money fields echo what was typed back in Indian digit grouping. The single
 * most damaging input error in this product is an order-of-magnitude slip — a
 * salary entered as 800000 instead of 80000 moves every number in the plan —
 * and no validation can catch it, because both are plausible. Showing
 * "₹8,00,000" under the box is how a person catches their own typo.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { FieldDef, RepeaterDef, StepDef } from '../lib/wizard-config';
import { getPath, setPath } from '../lib/wizard-config';
import { SpendingPortrait } from './SpendingPortrait';
import type { ExpenseKey, Provenance, SpendingBasis } from '../lib/spending-baseline';

type Data = Record<string, unknown>;

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export default function WizardForm({
  def,
  steps,
  initial,
  spendingBasis,
  totalSteps,
}: {
  def: StepDef;
  steps: { step: number; short: string }[];
  initial: Data;
  /**
   * Present only on the Spending step, and only when the earlier steps supply
   * enough to sketch a household. Its absence is the fallback to plain fields.
   */
  spendingBasis?: SpendingBasis | null;
  totalSteps: number;
}) {
  const router = useRouter();
  const [data, setData] = useState<Data>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const dirty = useRef(false);
  const errorBox = useRef<HTMLDivElement>(null);

  const save = useCallback(
    async (silent: boolean) => {
      setSaving(true);
      try {
        const res = await fetch('/api/profile/draft', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ step: def.step, data }),
        });
        const body = await res.json();
        if (!res.ok) {
          setErrors(body.errors ?? [body.error ?? 'Could not save.']);
          return false;
        }
        setErrors([]);
        dirty.current = false;
        if (silent) setSavedAt(new Date().toLocaleTimeString());
        return true;
      } catch {
        setErrors(['Could not reach the server. Your answers are still on screen — try again.']);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [data, def.step],
  );

  // Autosave. Nobody should lose a step to a dropped connection or a closed tab.
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => void save(true), 2500);
    return () => clearTimeout(t);
  }, [data, save]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const update = (path: string, value: unknown) => {
    dirty.current = true;
    setData((d) => setPath(d, path, value));
  };

  const visible = (f: FieldDef) => {
    if (!f.showWhen) return true;
    return f.showWhen.equals.includes(getPath(data, f.showWhen.path) as string);
  };

  const onContinue = async () => {
    if (!(await save(false))) {
      // The rejected answers may be far above the fold on a long step.
      errorBox.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (def.step < totalSteps) router.push(`/onboarding/${def.step + 1}`);
    else router.push('/onboarding/review');
  };

  return (
    <>
      <ProgressRail steps={steps} current={def.step} />

      <div className="mx-auto max-w-2xl px-5 pb-40 pt-8">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--brand-fg)' }}>
          Step {def.step} of {totalSteps}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{def.title}</h1>
        <p className="prose-advice mt-3 text-[0.9375rem]" style={{ color: 'var(--text-muted)' }}>
          {def.intro}
        </p>

        {errors.length > 0 && (
          <div
            ref={errorBox}
            role="alert"
            className="mt-7 rounded-lg border p-4"
            style={{ background: 'var(--bad-bg)', borderColor: 'var(--bad-border)', color: 'var(--bad-fg)' }}
          >
            <p className="font-semibold">
              {errors.length === 1 ? 'One answer needs attention' : `${errors.length} answers need attention`}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 space-y-5">
          {/*
            The Spending step is answered by correcting a sketch rather than by
            filling in boxes — see `SpendingPortrait`. Every other step, and this
            one when there is nothing to build a sketch from, uses the fields.
          */}
          {spendingBasis ? (
            <SpendingPortrait
              basis={spendingBasis}
              values={(data.expenses as Partial<Record<ExpenseKey, number>>) ?? {}}
              provenance={
                (data.expenseProvenance as Partial<Record<ExpenseKey, Provenance>>) ?? {}
              }
              onChange={(values, provenance) => {
                dirty.current = true;
                setData((d) => ({ ...d, expenses: values, expenseProvenance: provenance }));
              }}
            />
          ) : (
            def.fields && def.fields.filter(visible).length > 0 && (
              <div className="card-raised space-y-6 p-5 sm:p-6">
                {def.fields.filter(visible).map((f) => (
                  <Field
                    key={f.path}
                    def={f}
                    value={getPath(data, f.path)}
                    onChange={(v) => update(f.path, v)}
                  />
                ))}
              </div>
            )
          )}

          {def.repeaters?.map((r) => (
            <Repeater
              key={r.path}
              def={r}
              rows={(getPath(data, r.path) as Data[]) ?? []}
              onChange={(rows) => update(r.path, rows)}
            />
          ))}
        </div>

        {def.reassurance && <p className="aside-note mt-7">{def.reassurance}</p>}
      </div>

      <ActionBar
        step={def.step}
        totalSteps={totalSteps}
        saving={saving}
        savedAt={savedAt}
        onBack={() => router.push(`/onboarding/${def.step - 1}`)}
        onContinue={onContinue}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The progress rail.
 *
 * Completed steps are links, because the commonest reason to look at this is to
 * go back and correct something. Steps ahead are not: they are reachable by
 * URL, but offering them here invites people to skip the question they did not
 * want to answer and then meet it again as a validation error.
 */
function ProgressRail({
  steps,
  current,
}: {
  steps: { step: number; short: string }[];
  current: number;
}) {
  const pct = (current / steps.length) * 100;

  return (
    <div
      /* `top-16` and not `top-0`: the app header is 4rem and also sticky, so a
         rail pinned to the viewport top slides underneath it. */
      className="sticky top-16 z-20 border-b backdrop-blur-md"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--bg) 85%, transparent)',
      }}
    >
      <div className="mx-auto max-w-3xl px-5">
        {/* Wide screens: every step named. */}
        <ol className="hidden items-center gap-1 py-3 md:flex">
          {steps.map((s) => {
            const done = s.step < current;
            const active = s.step === current;
            const label = (
              <>
                <span
                  aria-hidden="true"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold"
                  style={
                    active
                      ? { backgroundImage: 'linear-gradient(var(--brand-grad-from), var(--brand-grad-to))', color: '#fff' }
                      : done
                        ? { background: 'var(--brand-tint)', color: 'var(--brand-fg)' }
                        : { background: 'var(--surface-sunk)', color: 'var(--text-faint)' }
                  }
                >
                  {done ? '✓' : s.step}
                </span>
                <span className="truncate">{s.short}</span>
              </>
            );

            const cls =
              'flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.8125rem] transition-colors';

            return (
              <li key={s.step} className="flex min-w-0 items-center">
                {done ? (
                  <a
                    href={`/onboarding/${s.step}`}
                    className={`${cls} hover:bg-[color:var(--surface-sunk)]`}
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {label}
                  </a>
                ) : (
                  <span
                    className={cls}
                    aria-current={active ? 'step' : undefined}
                    style={{
                      color: active ? 'var(--text)' : 'var(--text-faint)',
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {label}
                  </span>
                )}
                {s.step < steps.length && (
                  <span
                    aria-hidden="true"
                    className="mx-0.5 h-px w-3 shrink-0"
                    style={{ background: 'var(--border-strong)' }}
                  />
                )}
              </li>
            );
          })}
        </ol>

        {/* Narrow screens: the bar carries it. */}
        <div className="py-3 md:hidden">
          <div className="flex items-baseline justify-between text-[0.8125rem]">
            <span className="font-medium">{steps[current - 1]?.short}</span>
            <span style={{ color: 'var(--text-faint)' }}>
              {current} of {steps.length}
            </span>
          </div>
        </div>
      </div>

      <div className="h-[3px] w-full" style={{ background: 'var(--surface-sunk)' }}>
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundImage: 'linear-gradient(90deg, var(--brand-grad-from), var(--brand-grad-to))',
          }}
        />
      </div>
    </div>
  );
}

/**
 * The action bar.
 *
 * Fixed rather than in flow so the save state is visible while typing. The
 * save status is `aria-live` because autosave is otherwise a silent promise:
 * the whole point of telling someone their work is safe is that they hear it.
 */
function ActionBar({
  step,
  totalSteps,
  saving,
  savedAt,
  onBack,
  onContinue,
}: {
  step: number;
  totalSteps: number;
  saving: boolean;
  savedAt: string | null;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur-md"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--bg) 88%, transparent)',
      }}
    >
      <div className="mx-auto flex max-w-2xl items-center gap-4 px-5 py-3.5">
        <p
          className="flex min-w-0 items-center gap-2 text-[0.8125rem]"
          aria-live="polite"
          style={{ color: 'var(--text-faint)' }}
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: saving ? 'var(--warn-fg)' : savedAt ? 'var(--good-fg)' : 'var(--text-faint)' }}
          />
          <span className="truncate">
            {saving ? 'Saving…' : savedAt ? `Saved at ${savedAt}` : 'Answers save as you type'}
          </span>
        </p>

        <div className="ml-auto flex shrink-0 gap-2.5">
          {step > 1 && (
            <button type="button" onClick={onBack} className="btn btn-secondary">
              Back
            </button>
          )}
          <button type="button" onClick={onContinue} disabled={saving} className="btn btn-primary">
            {step === totalSteps ? 'Finish' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Field({
  def,
  value,
  onChange,
}: {
  def: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const id = `f-${def.path.replace(/\./g, '-')}`;
  const describedBy = def.help ? `${id}-help` : undefined;

  const label = (
    <label htmlFor={id} className="label">
      {def.label}
      {def.optional && (
        <span className="ml-2 font-normal" style={{ color: 'var(--text-faint)' }}>
          optional
        </span>
      )}
    </label>
  );

  const help = def.help && (
    <p id={describedBy} className="help">
      {def.help}
    </p>
  );

  if (def.kind === 'checkbox') {
    const checked = value === true;
    return (
      <label
        className="flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors"
        style={{
          borderColor: checked ? 'var(--brand-fg)' : 'var(--border)',
          background: checked ? 'var(--brand-tint)' : 'transparent',
        }}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <span className="min-w-0">
          <span className="block text-sm leading-relaxed">{def.label}</span>
          {help}
        </span>
      </label>
    );
  }

  if (def.kind === 'radio') {
    return (
      <fieldset>
        <legend className="label">{def.label}</legend>
        {help}
        <div className="mt-3 space-y-2">
          {def.options?.map((o) => {
            const checked = String(value) === o.value;
            return (
              <label
                key={o.value}
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors"
                style={{
                  borderColor: checked ? 'var(--brand-fg)' : 'var(--border)',
                  background: checked ? 'var(--brand-tint)' : 'transparent',
                  fontWeight: checked ? 500 : 400,
                }}
              >
                <input
                  type="radio"
                  name={id}
                  value={o.value}
                  checked={checked}
                  onChange={() =>
                    onChange(o.value === 'true' ? true : o.value === 'false' ? false : o.value)
                  }
                  className="h-4 w-4 shrink-0"
                />
                <span>{o.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (def.kind === 'scale5') {
    return (
      <fieldset>
        <legend className="label">{def.label}</legend>
        {help}
        <div className="mt-3">
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => {
              const on = value === n;
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(n)}
                  className="flex-1 rounded-lg border py-3 text-sm font-semibold transition-colors"
                  style={
                    on
                      ? {
                          borderColor: 'transparent',
                          backgroundImage:
                            'linear-gradient(100deg, var(--brand-grad-from), var(--brand-grad-to))',
                          color: '#fff',
                        }
                      : { borderColor: 'var(--border)', color: 'var(--text-muted)' }
                  }
                >
                  {n}
                </button>
              );
            })}
          </div>
          {def.scaleLabels && (
            <div className="mt-2 flex justify-between text-xs" style={{ color: 'var(--text-faint)' }}>
              <span>{def.scaleLabels[0]}</span>
              <span>{def.scaleLabels[1]}</span>
            </div>
          )}
        </div>
      </fieldset>
    );
  }

  if (def.kind === 'select') {
    return (
      <div>
        {label}
        {help}
        <select
          id={id}
          value={(value as string) ?? ''}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          className="field mt-2"
        >
          <option value="">Choose…</option>
          {def.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // money / percent / number / text / date
  const isNumeric = def.kind === 'money' || def.kind === 'number' || def.kind === 'percent';
  const echo =
    def.kind === 'money' && typeof value === 'number' && value > 0 ? inr(value) : null;

  return (
    <div>
      {label}
      {help}
      <div className="relative mt-2">
        {def.kind === 'money' && (
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            ₹
          </span>
        )}
        <input
          id={id}
          type={def.kind === 'date' ? 'date' : isNumeric ? 'number' : 'text'}
          inputMode={isNumeric ? 'numeric' : undefined}
          value={
            def.kind === 'percent' && typeof value === 'number'
              ? String(Math.round(value * 1000) / 10)
              : ((value as string | number) ?? '')
          }
          placeholder={def.placeholder}
          aria-describedby={describedBy}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(def.kind === 'text' || def.kind === 'date' ? '' : 0);
            if (def.kind === 'percent') return onChange(Number(raw) / 100);
            onChange(isNumeric ? Math.round(Number(raw)) : raw);
          }}
          className={`field ${def.kind === 'money' ? 'pl-7' : ''} ${def.suffix ? 'pr-20' : ''}`}
        />
        {def.suffix && (
          <span
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            {def.suffix}
          </span>
        )}
      </div>
      {/* Reads the figure back grouped, so an extra zero is visible rather than
          merely typed. See the note at the top of this file. */}
      {echo && (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--text-faint)' }}>
          {echo}
        </p>
      )}
    </div>
  );
}

function Repeater({
  def,
  rows,
  onChange,
}: {
  def: RepeaterDef;
  rows: Data[];
  onChange: (rows: Data[]) => void;
}) {
  const add = () => onChange([...rows, { ...def.template, id: crypto.randomUUID() }]);
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const edit = (i: number, path: string, value: unknown) =>
    onChange(rows.map((r, idx) => (idx === i ? setPath(r, path, value) : r)));

  /**
   * A one-line summary for the card header. The first text-ish answer in the
   * row is almost always its name — "Home loan", "Ananya", "House deposit" —
   * and a list of cards headed "#1 #2 #3" is unreadable once there are four.
   */
  const summarise = (row: Data): string | null => {
    for (const f of def.fields) {
      const v = getPath(row, f.path);
      if ((f.kind === 'text' || f.kind === 'select') && typeof v === 'string' && v.trim()) {
        return v.replace(/_/g, ' ');
      }
    }
    return null;
  };

  return (
    <section className="card-raised p-5 sm:p-6">
      <h2 className="text-base font-semibold tracking-tight">{def.label}</h2>
      {def.help && (
        <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {def.help}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="aside-note mt-4">
          Nothing added yet. If none applies to you, continue — this section is not compulsory.
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {rows.map((row, i) => {
            const name = summarise(row);
            return (
              <div
                key={(row.id as string) ?? i}
                className="rounded-lg border"
                style={{ borderColor: 'var(--border)' }}
              >
                <div
                  className="flex items-center justify-between gap-3 rounded-t-lg border-b px-4 py-2.5"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-sunk)' }}
                >
                  <p className="min-w-0 truncate text-sm font-medium">
                    {name ?? `${def.label.replace(/s$/, '')} ${i + 1}`}
                  </p>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="shrink-0 text-sm font-medium hover:underline"
                    style={{ color: 'var(--bad-fg)' }}
                  >
                    Remove
                  </button>
                </div>
                <div className="space-y-5 p-4">
                  {def.fields.map((f) => (
                    <Field
                      key={f.path}
                      def={f}
                      value={getPath(row, f.path)}
                      onChange={(v) => edit(i, f.path, v)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={add}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm font-medium transition-colors hover:bg-[color:var(--surface-sunk)]"
        style={{ borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }}
      >
        <span aria-hidden="true" className="text-base leading-none">
          +
        </span>
        {def.addLabel}
      </button>
    </section>
  );
}
