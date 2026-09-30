import { Lockup } from '../../components/Shell';

/**
 * The signed-out shell.
 *
 * Still one decision per screen — sign in, confirm a code, save your recovery
 * codes — so the form itself stays narrow and uncluttered. What changed is what
 * surrounds it. This is the only part of the product where the brand is the
 * content: everything past the door is a financial document, and colour there
 * is doing semantic work that decoration would compete with.
 *
 * On wide screens the brand panel carries the lockup and says plainly what the
 * product does, which is the question a first-time visitor actually has in
 * front of a login form. Below `lg` it is dropped rather than stacked — on a
 * phone it would push the form below the fold, and nobody scrolls past a
 * value proposition to reach a password field.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-bg auth-mesh min-h-dvh lg:grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)]">
      <aside className="auth-aside hidden lg:flex lg:flex-col lg:justify-between lg:p-14 xl:p-16">
        <div className="relative z-10">
          <Lockup width={210} variant="onBrandPanel" />
        </div>

        <div className="relative z-10 max-w-md">
          <h2 className="text-[1.75rem] font-semibold leading-tight tracking-tight">
            A plan, not a product pitch.
          </h2>
          <ul className="mt-7 space-y-5 text-[0.9375rem] leading-relaxed" style={{ color: '#cfe6e8' }}>
            <li className="flex gap-3">
              <Tick />
              <span>
                The whole picture first — income, debts, cover, dependants, tax — then what to fix,
                in the order it should be fixed.
              </span>
            </li>
            <li className="flex gap-3">
              <Tick />
              <span>
                Every recommendation carries the reason it was chosen, written against the numbers
                you gave us.
              </span>
            </li>
            <li className="flex gap-3">
              <Tick />
              <span>
                If a goal will not fit, you are told so and offered the real options — never a
                number that quietly assumes it does.
              </span>
            </li>
          </ul>
        </div>

        <p className="relative z-10 text-xs leading-relaxed" style={{ color: '#a8ccd2' }}>
          Recommendations are made at category level — &ldquo;a large-cap index fund&rdquo; — never a
          named scheme.
        </p>
      </aside>

      <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12 lg:min-h-0 lg:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Lockup width={168} />
          </div>

          <div className="auth-card p-6 sm:p-8">{children}</div>

          <p className="mt-6 text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
            Your financial information is encrypted before it is stored, and two-factor
            authentication is required before any of it can be reached.
          </p>
        </div>
      </main>
    </div>
  );
}

/** A tick, drawn rather than fetched — it sits on the brand panel's gradient. */
function Tick() {
  return (
    <svg
      width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      className="mt-0.5 shrink-0" style={{ color: '#6fdcc4' }} aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
