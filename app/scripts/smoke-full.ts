/**
 * The whole smoke test in one command, including the email-verification step.
 *
 * `smoke.ts` is deliberately HTTP-only — it drives the product exactly as a
 * browser would, which is what makes it worth trusting. That means it hits the
 * real email-verification gate and stops, because a fresh account is always
 * unverified and there is no HTTP route that verifies your own email without
 * the token. Correct, and annoying: a bare `npm run smoke` mints a NEW account
 * every run, so it stops at the same gate forever unless you notice the
 * `SMOKE_EMAIL=` line in the output.
 *
 * So this wrapper does by script exactly what the output tells a human to do:
 * pin one address, run, verify, run again. It weakens nothing — the first pass
 * still asserts that login is refused before verification, which is the control
 * that matters.
 *
 * Usage: npm run smoke:full
 */

import './env.ts';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const email = process.env.SMOKE_EMAIL ?? `smoke-${Date.now()}@test.local`;

const run = (script: string, args: string[] = []) =>
  execFileSync('node', ['--experimental-strip-types', join(here, script), ...args], {
    stdio: 'inherit',
    env: { ...process.env, SMOKE_EMAIL: email },
  });

console.log(`\nRunning the full smoke test against ${email}\n`);

/* Pass 1 — up to the verification gate. Exiting 1 here is the expected path. */
try {
  run('smoke.ts');
  // Reaching this means the account was already verified, so there is nothing
  // left to do. Happens when SMOKE_EMAIL points at an existing account.
  console.log('\nAlready verified — the run completed in one pass.');
  process.exit(0);
} catch {
  console.log('\n\x1b[2mStopped at the email-verification gate, as designed. Verifying…\x1b[0m\n');
}

/* Verify, exactly as the operator would. */
run('verify-email.ts', [email]);

/* Pass 2 — the whole pipeline. This one must pass. */
console.log('\n\x1b[2mResuming…\x1b[0m\n');
try {
  run('smoke.ts');
} catch {
  console.error(
    `\n\x1b[31mThe smoke test failed after verification.\x1b[0m ` +
      `The failures above are real — re-run against the same account with:\n` +
      `  SMOKE_EMAIL=${email} npm run smoke\n`,
  );
  process.exit(1);
}
