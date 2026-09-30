/**
 * Print the current TOTP code for a secret — so you can test the login flow
 * from a terminal without reaching for your phone.
 *
 * The wrinkle this handles: a code is only valid for the remainder of its
 * 30-second window. Handing someone a code with four seconds left, which they
 * then paste into a form, produces "that code is invalid" — and the obvious
 * conclusion is that TOTP is broken rather than that the window rolled over.
 * So when a code is about to expire, the next one is printed alongside it.
 *
 * Usage:
 *   node --experimental-strip-types scripts/totp-code.ts <BASE32_SECRET>
 *   node --experimental-strip-types scripts/totp-code.ts <BASE32_SECRET> --watch
 */

import { generateTotp } from '../../core/src/totp.ts';

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const secret = args.find((a) => !a.startsWith('--'));

if (!secret) {
  console.error(
    'Usage: node --experimental-strip-types scripts/totp-code.ts <BASE32_SECRET> [--watch]\n' +
      '\nThe key is on the 2FA enrolment page, under "Can\'t scan it? Enter the key by hand".',
  );
  process.exit(1);
}

/** Below this, a code will likely expire before it can be pasted. */
const TOO_TIGHT_SECONDS = 10;
const PERIOD = 30;

function show(): void {
  const now = Math.floor(Date.now() / 1000);
  const secondsLeft = PERIOD - (now % PERIOD);

  // stdout carries only the code, so `CODE=$(npm run --silent totp -- KEY)`
  // still works. Everything else goes to stderr.
  console.log(generateTotp(secret!, now));

  if (secondsLeft <= TOO_TIGHT_SECONDS) {
    console.error(
      `(this one expires in ${secondsLeft}s — probably too soon to paste)\n` +
        `next:  ${generateTotp(secret!, now + PERIOD)}   (use this one; valid from ${secondsLeft}s, for 30s)`,
    );
  } else {
    console.error(`(valid for ${secondsLeft}s)`);
  }
}

show();

if (watch) {
  console.error('\nWatching. Ctrl-C to stop.\n');
  // Tick on the window boundary rather than every 30s from now, so the printed
  // code always matches what an authenticator app would be showing.
  const scheduleNext = () => {
    const msToBoundary = (PERIOD - (Math.floor(Date.now() / 1000) % PERIOD)) * 1000;
    setTimeout(() => {
      show();
      scheduleNext();
    }, msToBoundary + 100);
  };
  scheduleNext();
}
