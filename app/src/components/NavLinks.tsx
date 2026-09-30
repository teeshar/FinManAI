'use client';

/**
 * The nav's links, with the current one marked.
 *
 * A client component only because it needs `usePathname` — the header itself
 * stays a server component so the user's role never crosses into the bundle.
 *
 * There was no current-page indication at all before this: three links that
 * looked identical whichever of them you were reading. `aria-current` carries
 * it for screen readers, the underline for everyone else, and the weight change
 * for anyone who cannot see the underline's colour.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';

export function NavLinks({ links }: { links: { href: Route; label: string }[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 overflow-x-auto text-sm">
      {links.map((l) => {
        // Prefix match so /plan/<id> still marks "Your plan" as current; exact
        // match alone would leave the header looking unvisited on most screens.
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className="relative whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors"
            style={{
              color: active ? 'var(--text)' : 'var(--text-muted)',
              fontWeight: active ? 600 : 400,
            }}
          >
            {l.label}
            {active && (
              <span
                aria-hidden="true"
                className="absolute inset-x-2.5 -bottom-[1.15rem] h-0.5 rounded-full"
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, var(--brand-grad-from), var(--brand-grad-to))',
                }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
