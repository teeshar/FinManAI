/**
 * Refuse to run destructive or data-creating tests against a real database.
 *
 * This exists because of a mistake that is very easy to make and unpleasant to
 * undo: `npm run smoke` signs up accounts, commits profiles and generates
 * plans. Pointed at the live database it fills a five-year, append-only,
 * retention-governed store with junk that **cannot simply be deleted** — plans
 * are immutable, and removing rows from the middle of a hash-chained audit log
 * breaks `verifyChain()` permanently. There is no tidy recovery. So the guard
 * is a hard stop rather than a warning.
 *
 * A database is treated as safe if its name contains "test". Anything else has
 * to be waved through explicitly, per-run, with I_KNOW_THIS_IS_NOT_A_TEST_DB=1.
 */

import '../scripts/env.ts';

export function requireTestDatabase(what: string): void {
  const url = process.env.DATABASE_URL ?? '';
  const database = /\/([^/?]+)(\?|$)/.exec(url)?.[1] ?? 'unknown';

  if (/test/i.test(database)) return;

  if (process.env.I_KNOW_THIS_IS_NOT_A_TEST_DB === '1') {
    console.warn(
      `\x1b[33m!\x1b[0m ${what} is running against "${database}", which is not a test database. ` +
        `Proceeding because I_KNOW_THIS_IS_NOT_A_TEST_DB=1.\n`,
    );
    return;
  }

  console.error(
    `\n\x1b[31mRefusing to run ${what} against "${database}".\x1b[0m\n\n` +
      `${what} creates accounts, profiles and plans. Plans are append-only and the audit log is\n` +
      `hash-chained, so this data cannot be cleanly removed afterwards — deleting rows from the\n` +
      `middle of the chain breaks verifyChain() permanently.\n\n` +
      `Switch to the test database first:\n` +
      `  npm run db:use test\n` +
      `  # restart npm run dev, then re-run\n\n` +
      `If "${database}" really is disposable, override for this run:\n` +
      `  I_KNOW_THIS_IS_NOT_A_TEST_DB=1 npm run smoke\n`,
  );
  process.exit(1);
}
