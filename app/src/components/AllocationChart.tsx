/**
 * The asset-class mix, as a 100% stacked bar.
 *
 * **Why asset class and not instrument.** The plan's allocation table lists
 * eight-or-so instrument categories, which is the right level for "what do I
 * buy". But the decision that actually carries the risk is the split between
 * equity, debt, gold and real assets — it is what the risk band's equity
 * ceiling constrains, and it is what changes when someone's profile changes.
 * Five categories also fit a single bar legibly; eight do not.
 *
 * **Why a stacked bar and not a donut.** The repository notes a donut would
 * help here, and a donut is the conventional answer — but people read angles
 * poorly, and this data has slices of 33.7% and 29.1% that a donut renders as
 * two near-identical wedges. A single bar keeps them on a common baseline where
 * the comparison is direct, and it degrades gracefully on a narrow screen.
 *
 * **Colour.** Categorical, because asset classes are distinct identities rather
 * than points on a scale. Hues are assigned in a fixed order — equity is always
 * slot 1 — so a filtered or regenerated plan never repaints the survivors. The
 * palette is validated for colour-vision deficiency in both light and dark
 * modes; three light-mode hues sit below 3:1 against the surface, so every
 * segment carries a visible label and the instrument table below repeats the
 * numbers. No value is available only on hover.
 */

import type { AllocationSlice, AssetClass } from '../../../engine/src/types';

/**
 * Fixed slot order. Never cycled, never reassigned by rank: colour follows the
 * entity so that equity is the same colour in every plan a client ever reads.
 */
const SERIES: { key: AssetClass; label: string; light: string; dark: string }[] = [
  { key: 'equity',      label: 'Equity',      light: '#2a78d6', dark: '#3987e5' },
  { key: 'debt',        label: 'Debt',        light: '#eb6834', dark: '#d95926' },
  { key: 'gold',        label: 'Gold',        light: '#1baf7a', dark: '#199e70' },
  { key: 'real_assets', label: 'Real assets', light: '#eda100', dark: '#c98500' },
  { key: 'crypto',      label: 'Crypto',      light: '#e87ba4', dark: '#d55181' },
];

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const pct = (n: number) => (n * 100).toFixed(1) + '%';

export function AllocationChart({ slices }: { slices: AllocationSlice[] }) {
  const total = slices.reduce((sum, s) => sum + s.percent, 0);
  if (total <= 0) return null;

  const grouped = SERIES.map((series) => {
    const members = slices.filter((s) => s.assetClass === series.key);
    return {
      ...series,
      // Renormalised, because eligibility filtering can leave the slices summing
      // to slightly under 1 and a bar that stops at 97% looks like a bug.
      share: members.reduce((sum, s) => sum + s.percent, 0) / total,
      monthly: members.reduce((sum, s) => sum + s.monthlyAmount, 0),
      count: members.length,
    };
  }).filter((g) => g.share > 0);

  // 2px surface gaps between segments, per the mark spec — the separation is
  // structural, so it survives colour-vision deficiency and greyscale printing.
  const GAP = 0.6;
  const usable = 100 - GAP * (grouped.length - 1);

  let x = 0;
  const segments = grouped.map((g) => {
    const width = g.share * usable;
    const seg = { ...g, x, width };
    x += width + GAP;
    return seg;
  });

  return (
    <figure className="m-0">
      <style>{`
        .alloc-seg { fill: var(--alloc-light); background-color: var(--alloc-light); }
        @media (prefers-color-scheme: dark) {
          .alloc-seg { fill: var(--alloc-dark); background-color: var(--alloc-dark); }
        }
      `}</style>

      <svg
        viewBox="0 0 100 9"
        preserveAspectRatio="none"
        className="h-9 w-full"
        role="img"
        aria-label={
          'Asset class mix: ' +
          grouped.map((g) => `${g.label} ${pct(g.share)}`).join(', ')
        }
      >
        {segments.map((s) => (
          <rect
            key={s.key}
            x={s.x}
            y={0}
            width={s.width}
            height={9}
            /* 4px-equivalent rounded ends; the viewBox is unitless so this is
               scaled to read as a small radius at any width. */
            rx={0.9}
            className="alloc-seg"
            style={
              { '--alloc-light': s.light, '--alloc-dark': s.dark } as React.CSSProperties
            }
          >
            <title>{`${s.label}: ${pct(s.share)}, ${inr(s.monthly)} a month`}</title>
          </rect>
        ))}
      </svg>

      {/*
        The legend is always present — with five series, identity must never be
        carried by colour alone. Every figure on the chart is repeated here as
        text, so nothing is hover-only. Labels wear text tokens, never the
        series colour; the swatch beside them carries the identity.
      */}
      <figcaption className="mt-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {segments.map((s) => (
            <div key={s.key} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="alloc-seg mt-1 h-2.5 w-2.5 shrink-0 rounded-sm"
                style={
                  { '--alloc-light': s.light, '--alloc-dark': s.dark } as React.CSSProperties
                }
              />
              <div className="min-w-0">
                <dt className="text-sm font-medium">{s.label}</dt>
                <dd className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {pct(s.share)} · {inr(s.monthly)}/mo
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </figcaption>
    </figure>
  );
}
