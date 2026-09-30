/**
 * The application chrome and the layout primitives every page is built from.
 *
 * There was no navigation before Phase 6, because there was nowhere to go: the
 * product ended at the plan. Once advice is something that gets reviewed,
 * compared and released, a returning user needs a way back to their own
 * history — and an adviser needs a way to their queue.
 *
 * Role decides what appears. A client never sees a link to the compliance
 * console; the routes enforce that too, but a link to somewhere you may not go
 * is a bad interface as well as a bad boundary.
 *
 * The primitives below exist so that a ratio is banded, a figure is set and a
 * section is titled identically on every page. When each page invents its own,
 * the same number ends up looking more serious on one screen than another —
 * which is a correctness problem here, not a cosmetic one.
 */

import Link from 'next/link';
import type { Route } from 'next';
import { SignOut } from './SignOut';
import { NavLinks } from './NavLinks';
import type { AuthedUser } from '../lib/auth';

export function Nav({ user }: { user: AuthedUser }) {
  // Typed routes: `Route` makes a broken link a compile error rather than a 404
  // someone finds in production.
  const links: { href: Route; label: string }[] = [{ href: '/dashboard', label: 'Your plan' }];
  if (user.role === 'ADVISER' || user.role === 'ADMIN') {
    links.push({ href: '/adviser', label: 'Clients' });
  }
  if (user.role === 'COMPLIANCE' || user.role === 'ADMIN') {
    links.push({ href: '/compliance', label: 'Compliance' });
  }

  return (
    <header
      className="no-print sticky top-0 z-30 border-b backdrop-blur-md"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--bg) 82%, transparent)',
      }}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5 sm:gap-8">
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight"
        >
          <Mark size={26} />
          <span className="hidden sm:inline">FinManAI</span>
        </Link>

        <NavLinks links={links} />

        <div className="ml-auto flex items-center gap-3">
          <span
            className="hidden max-w-48 truncate text-sm lg:inline"
            style={{ color: 'var(--text-faint)' }}
            title={user.email}
          >
            {user.email}
          </span>
          <SignOut />
        </div>
      </div>
    </header>
  );
}

/**
 * The brand mark.
 *
 * Raster rather than the drawn glyph that stood in for it before. The logo is a
 * gradient emblem over a node mesh; redrawing that as flat SVG paths loses the
 * thing that makes it the logo, so the artwork is served as artwork.
 *
 * Two files, chosen by `prefers-color-scheme` in the markup. An `<img>` cannot
 * pick its own source from a media query, and the navy half of the palette is
 * very nearly invisible against the dark canvas — a single file would mean the
 * mark quietly disappearing for anyone with a dark system theme.
 *
 * `size` is the rendered height; the width follows the artwork's 160x122.
 * Both are declared so the header does not reflow once the image lands.
 */
const MARK_RATIO = 160 / 122;

export function Mark({ size = 26 }: { size?: number }) {
  const width = Math.round(size * MARK_RATIO);
  return (
    <picture>
      <source srcSet="/logo-mark-dark.png" media="(prefers-color-scheme: dark)" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-mark.png"
        alt=""
        aria-hidden="true"
        width={width}
        height={size}
        style={{ width, height: size }}
      />
    </picture>
  );
}

/**
 * The full lockup — emblem, wordmark and tagline as one piece of artwork.
 *
 * Used where the brand is the only thing on screen worth looking at: the
 * signed-out pages. Inside the app the nav uses `Mark` beside live text, so the
 * wordmark is not rendered twice.
 *
 * `variant` exists because two places must NOT follow the system theme.
 *
 *   auth   — the signed-out brand panel is a deep navy gradient in *both*
 *            themes, so the automatic pair puts navy on navy for anyone in
 *            light mode. It also needs artwork lifted further than the ordinary
 *            dark variant, which is tuned for a near-black canvas: against navy
 *            the wordmark otherwise sits at about three-and-a-half to one
 *            against its own background.
 *   light  — paper is white whatever the screen is. A dark-theme user printing
 *            a plan would otherwise get the pale artwork on a white page.
 */
const LOCKUP_RATIO = 464 / 360;

export function Lockup({
  width = 200,
  variant = 'auto',
}: {
  width?: number;
  variant?: 'auto' | 'onBrandPanel' | 'light';
}) {
  const height = Math.round(width / LOCKUP_RATIO);
  const alt = 'FinManAI — smart financial intelligence';
  const box = { width, height };

  if (variant !== 'auto') {
    const src = variant === 'onBrandPanel' ? '/logo-panel.png' : '/logo.png';
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} width={width} height={height} style={box} />;
  }

  return (
    <picture>
      <source srcSet="/logo-dark.png" media="(prefers-color-scheme: dark)" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt={alt} width={width} height={height} style={box} />
    </picture>
  );
}

/* ------------------------------------------------------------------ *
 * Page scaffolding
 * ------------------------------------------------------------------ */

export function Page({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto ${wide ? 'max-w-6xl' : 'max-w-3xl'} px-5 pb-28 pt-9 sm:pt-12`}>
      {children}
    </div>
  );
}

/**
 * The page heading.
 *
 * `eyebrow` carries the context a title cannot hold without becoming a
 * sentence — which profile version, which client, which date. `actions` sits on
 * the same line on wide screens and wraps beneath on narrow ones, so the
 * primary action for a page is always in the same place.
 */
export function PageTitle({
  title,
  eyebrow,
  meta,
  actions,
}: {
  title: string;
  eyebrow?: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {eyebrow && (
          <p
            className="mb-2 text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--brand-fg)' }}
          >
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-semibold tracking-tight sm:text-[2rem]">{title}</h1>
        {meta && (
          <p className="mt-2.5 text-sm leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            {meta}
          </p>
        )}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2.5">{actions}</div>}
    </div>
  );
}

export function Section({
  title,
  subtitle,
  children,
  actions,
  id,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="mt-12 scroll-mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          {/* A short brand rule rather than a coloured heading: it marks where a
              section starts without tinting the words themselves. */}
          <span
            aria-hidden="true"
            className="inline-block h-4 w-1 shrink-0 rounded-full"
            style={{
              backgroundImage:
                'linear-gradient(var(--brand-grad-from), var(--brand-grad-to))',
            }}
          />
          {title}
        </h2>
        {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
      </div>
      {subtitle && (
        <p
          className="mt-2 max-w-2xl pl-[1.375rem] text-sm leading-relaxed"
          style={{ color: 'var(--text-muted)' }}
        >
          {subtitle}
        </p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * A notice. `tone` is about consequence, not decoration:
 *   info    — something to know
 *   warn    — something to do soon
 *   blocked — something that stops the product behaving as it normally would
 *   good    — a confirmation
 *
 * The icon is not ornament. These stack on the dashboard, and a column of
 * differently-coloured boxes is hard to triage at a glance if colour is the
 * only difference — which it is, for anyone who cannot separate the reds from
 * the ambers.
 */
const NOTICE_TOKEN = { info: 'info', warn: 'warn', blocked: 'bad', good: 'good' } as const;

export function Notice({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'warn' | 'blocked' | 'good';
  title: string;
  children?: React.ReactNode;
}) {
  const token = NOTICE_TOKEN[tone];
  return (
    <div
      className="flex gap-3.5 rounded-lg border p-4 text-sm leading-relaxed"
      style={{
        background: `var(--${token}-bg)`,
        borderColor: `var(--${token}-border)`,
        color: `var(--${token}-fg)`,
      }}
    >
      <NoticeIcon tone={tone} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {children && (
          <div className="mt-1.5 [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

function NoticeIcon({ tone }: { tone: 'info' | 'warn' | 'blocked' | 'good' }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'mt-0.5 shrink-0',
    'aria-hidden': true,
  };
  if (tone === 'good') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </svg>
    );
  }
  if (tone === 'blocked') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5M12 16.2v.3" />
      </svg>
    );
  }
  if (tone === 'warn') {
    return (
      <svg {...common}>
        <path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.4h15.6a2 2 0 0 0 1.7-3l-7.8-13.5a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9.5v4M12 16.9v.3" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.6v.3" />
    </svg>
  );
}

/** A headline figure. `emphasis` marks the one number the section is about. */
export function Stat({
  label,
  value,
  emphasis,
  hint,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
        {label}
      </dt>
      <dd
        className={
          emphasis
            ? 'mt-1.5 text-[1.75rem] font-semibold leading-none tracking-tight'
            : 'mt-1.5 text-xl font-medium leading-none'
        }
        style={emphasis ? { color: 'var(--brand-fg)' } : undefined}
      >
        {value}
      </dd>
      {hint && (
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A band or severity pill.
 *
 * The mapping from the engine's vocabulary to three visual tones lives here so
 * every page bands a ratio identically. "fair" reads as a warning rather than a
 * pass, deliberately — it is the level at which someone should act.
 */
const TONE: Record<string, 'good' | 'warn' | 'bad' | 'info'> = {
  excellent: 'good', good: 'good', on_track: 'good', achievable: 'good', comfortable: 'good',
  fair: 'warn', stretch: 'warn', manageable: 'warn', needs_more_saving: 'warn',
  poor: 'bad', critical: 'bad', not_achievable: 'bad', painful: 'bad', catastrophic: 'bad',
};

export function Pill({ label }: { label: string }) {
  const token = TONE[label] ?? 'info';
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-2 pr-2.5 text-xs font-semibold capitalize"
      style={{ background: `var(--${token}-bg)`, color: `var(--${token}-fg)` }}
    >
      {/* A dot as well as a colour, so the three bands are distinguishable when
          the colours are not. */}
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: 'currentColor' }}
      />
      {label.replace(/_/g, ' ')}
    </span>
  );
}

/**
 * What to show where there is nothing to show.
 *
 * An empty table with a header row reads as a failure. This says what would be
 * here and offers the one action that puts something in it.
 */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg border border-dashed px-6 py-10 text-center"
      style={{ borderColor: 'var(--border-strong)' }}
    >
      <p className="font-medium">{title}</p>
      {children && (
        <div
          className="mx-auto mt-2 max-w-md text-sm leading-relaxed"
          style={{ color: 'var(--text-muted)' }}
        >
          {children}
        </div>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** A label/value row list — the shape most of this product's facts take. */
export function KeyValue({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y" style={{ borderColor: 'var(--border)' }}>
      {rows.map(([label, value], i) => (
        <div key={`${label}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
          <dt className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {label}
          </dt>
          <dd className="text-sm font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
