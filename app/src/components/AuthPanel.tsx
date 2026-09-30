'use client';

/**
 * Sign in and create an account, on one screen.
 *
 * These used to be two pages, and only one of them linked to the other: signup
 * offered "Already have an account? Sign in", but the sign-in page offered no
 * way back. Since `/` redirects a signed-out visitor to `/login`, a genuinely
 * new person landed on a form they could not use, with no visible route to the
 * one they needed. They are not going to guess at `/signup`.
 *
 * So both are always on screen. The tab is the whole navigation, the URL still
 * distinguishes them so `/signup` and `/login` both deep-link correctly, and
 * switching costs nothing — the email someone has already typed carries across,
 * because retyping it is exactly the friction that made them give up the first
 * time.
 *
 * One asymmetry is deliberate: signing in has a second stage (the 2FA code).
 * While that stage is showing, the tabs disappear. A half-finished
 * authentication is not something to let someone wander away from by accident —
 * the challenge ticket expires in five minutes.
 */

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'signin' | 'signup';

export function AuthPanel({
  initialMode,
  googleEnabled,
  initialError,
}: {
  initialMode: Mode;
  googleEnabled: boolean;
  initialError?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);

  // Shared so switching tabs does not throw away what has been typed.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [stage, setStage] = useState<'credentials' | 'totp'>('credentials');
  const [challenge, setChallenge] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');

  // The OAuth callback redirects back here with ?error= when it refuses a
  // sign-in, so the reason is shown where the person is looking rather than as
  // JSON at a URL in their address bar.
  const [error, setError] = useState(initialError ?? '');
  const [busy, setBusy] = useState(false);
  const [signedUp, setSignedUp] = useState(false);

  const switchTo = (next: Mode) => {
    setMode(next);
    setError('');
    // Keep the URL honest so a refresh, a bookmark or the back button all land
    // on the tab the person is actually looking at.
    window.history.replaceState(null, '', next === 'signup' ? '/signup' : '/login');
  };

  const post = async (path: string, body: unknown) => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, body: await res.json() };
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'signup') {
        const { ok, body } = await post('/api/auth/signup', { email, password });
        if (!ok) return setError(body.error);
        setSignedUp(true);
        return;
      }

      if (stage === 'credentials') {
        const { ok, body } = await post('/api/auth/login', { email, password });
        if (!ok) return setError(body.error);
        if (body.status === 'totp_required') {
          setChallenge(body.challenge);
          setStage('totp');
        } else if (body.status === 'enrol_totp') {
          router.push('/totp/enrol');
        }
        return;
      }

      const { ok, body } = await post('/api/auth/totp/verify', {
        challenge,
        ...(useRecovery ? { recoveryCode: code } : { code }),
      });
      if (!ok) return setError(body.error);
      router.push('/');
    } finally {
      setBusy(false);
    }
  };

  /* ---------------------------------------------------------------- */

  if (signedUp) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-3 leading-relaxed opacity-80">
          If that address does not already have an account, we have sent a verification link. It
          expires in 24 hours.
        </p>
        <p className="mt-4 text-sm leading-relaxed opacity-70">
          We deliberately do not confirm whether an address is registered — that would let anyone
          test which emails have accounts here.
        </p>
        <button
          type="button"
          onClick={() => {
            setSignedUp(false);
            switchTo('signin');
          }}
          className="btn btn-secondary mt-6 w-full"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  const onTotp = stage === 'totp';

  return (
    <div>
      {onTotp ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">One more step</h1>
          <p className="mt-3 text-sm leading-relaxed opacity-80">
            {useRecovery
              ? 'Enter one of the recovery codes you saved when you set up two-factor authentication.'
              : 'Enter the 6-digit code from your authenticator app.'}
          </p>
        </>
      ) : (
        <>
          {/* Both options, always visible. This is the navigation. */}
          <div
            role="tablist"
            aria-label="Sign in or create an account"
            className="flex gap-1 rounded-lg p-1"
            style={{ background: 'var(--surface-sunk)' }}
          >
            {([
              ['signin', 'Sign in'],
              ['signup', 'Create account'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={mode === value}
                onClick={() => switchTo(value)}
                className="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors"
                /* The selected tab is brand-coloured rather than just raised:
                   on a card the raise alone was a very quiet signal for what is
                   the only navigation on the screen. */
                style={
                  mode === value
                    ? {
                        background: 'var(--surface)',
                        color: 'var(--brand-fg)',
                        boxShadow: '0 1px 2px rgba(16,42,80,.10), 0 0 0 1px var(--brand-ring)',
                      }
                    : { color: 'var(--text-muted)' }
                }
              >
                {label}
              </button>
            ))}
          </div>

          <h1 className="mt-7 text-2xl font-semibold tracking-tight">
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </h1>
          {/* The copy has to match what is actually on screen: promising Google
              on a deployment where it is not configured is worse than silence. */}
          <p className="mt-2.5 text-sm leading-relaxed opacity-80">
            {googleEnabled
              ? mode === 'signin'
                ? 'Continue with Google, or use the email and password you set up.'
                : 'Continuing with Google is the quickest route — it needs no password and no authenticator app.'
              : mode === 'signin'
                ? 'Your password alone will not sign you in — we will ask for your authenticator code next.'
                : 'You will set up two-factor authentication next. It is required before we hold any of your financial information.'}
          </p>

          {googleEnabled && (
            <>
              {/*
                A plain link, not a fetch. The flow is a top-level browser
                redirect to Google and back; doing it from script would put the
                consent screen inside a fetch that cannot render it.
              */}
              <a href="/api/auth/google/start" className="btn btn-secondary mt-6 w-full">
                <GoogleMark />
                Continue with Google
              </a>

              <div className="mt-6 flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
                <span className="text-xs uppercase tracking-wider opacity-60">or</span>
                <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
              </div>
            </>
          )}
        </>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border p-3 text-sm leading-relaxed"
          style={{ background: 'var(--bad-bg)', borderColor: 'var(--bad-border)', color: 'var(--bad-fg)' }}
        >
          {error}
        </p>
      )}

      <form method="post" onSubmit={submit} className="mt-6 space-y-4">
        {onTotp ? (
          <Field
            id="code"
            label={useRecovery ? 'Recovery code' : 'Authentication code'}
            type="text"
            value={code}
            onChange={setCode}
            autoComplete="one-time-code"
            inputMode={useRecovery ? 'text' : 'numeric'}
            autoFocus
          />
        ) : (
          <>
            <Field
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="username"
            />
            <div>
              <Field
                id="password"
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={mode === 'signup' ? 12 : undefined}
              />
              {mode === 'signup' && (
                <p className="mt-1.5 text-sm leading-relaxed opacity-70">
                  At least 12 characters. Length protects you far more than mixing in symbols does —
                  a memorable phrase of four words beats <span className="font-mono">P@ssw0rd!</span>
                </p>
              )}
            </div>
          </>
        )}

        <button type="submit" disabled={busy} className="btn btn-brand w-full">
          {busy
            ? 'Please wait…'
            : onTotp
              ? 'Sign in'
              : mode === 'signup'
                ? 'Create account'
                : 'Continue'}
        </button>
      </form>

      {onTotp && (
        <div className="mt-5 flex flex-wrap justify-between gap-3 text-sm">
          <button
            type="button"
            onClick={() => {
              setUseRecovery((v) => !v);
              setCode('');
              setError('');
            }}
            className="underline opacity-80"
          >
            {useRecovery ? 'Use my authenticator app instead' : 'I have lost my phone'}
          </button>
          <button
            type="button"
            onClick={() => {
              setStage('credentials');
              setCode('');
              setChallenge('');
              setError('');
            }}
            className="underline opacity-70"
          >
            Start over
          </button>
        </div>
      )}
    </div>
  );
}

/** Google's mark, drawn inline — nothing is fetched from a third party. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.3z" />
      <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.1H4.3v5.7C7.9 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.6 28.2c-.5-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2v-5.7H4.3C2.8 17 2 20.4 2 24s.8 7 2.3 9.9l7.3-5.7z" />
      <path fill="#EA4335" d="M24 10.7c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.1 30 2 24 2 15.4 2 7.9 6.9 4.3 14.1l7.3 5.7c1.7-5.2 6.6-9.1 12.4-9.1z" />
    </svg>
  );
}

function Field(props: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric';
  minLength?: number;
  autoFocus?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = props.type === 'password';
  const hintId = useId();

  return (
    <div>
      <label htmlFor={props.id} className="block text-sm font-medium">
        {props.label}
      </label>
      <div className="relative mt-1.5">
        <input
          id={props.id}
          name={props.id}
          /*
           * `name` and `autoComplete` stay fixed while the type flips, so a
           * password manager keeps recognising the field when it is revealed.
           * Swapping the name — a common way to build this — makes 1Password and
           * Chrome stop offering to fill it.
           */
          type={isPassword && revealed ? 'text' : props.type}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          autoComplete={props.autoComplete}
          inputMode={props.inputMode}
          minLength={props.minLength}
          autoFocus={props.autoFocus}
          aria-describedby={isPassword ? hintId : undefined}
          required
          className={`field ${isPassword ? 'pr-11' : ''}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            /*
             * `aria-pressed` rather than a changing label alone, so a screen
             * reader announces the state rather than only the action. The
             * button is deliberately focusable: someone who cannot see the
             * field is exactly who most needs to check what they typed.
             */
            aria-pressed={revealed}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 flex items-center rounded-r-md px-3 transition-opacity hover:opacity-100"
            style={{ color: 'var(--text-muted)', opacity: 0.75 }}
          >
            <EyeIcon off={revealed} />
          </button>
        )}
      </div>
      {isPassword && (
        <p id={hintId} className="sr-only">
          {revealed ? 'Your password is visible on screen.' : 'Your password is hidden.'}
        </p>
      )}
    </div>
  );
}

/**
 * An eye, struck through when the password is visible.
 *
 * The struck-through state means "showing" rather than "hidden", which is the
 * convention people expect from their browser and password manager: the icon
 * depicts what pressing it will do next.
 */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.75" />
      {off && <line x1="4" y1="20" x2="20" y2="4" />}
    </svg>
  );
}
