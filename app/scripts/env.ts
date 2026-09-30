/**
 * Load `.env` for a script run outside Next.
 *
 * Next loads `.env` itself; a script run directly from node does not, and the
 * failure mode is nasty — `keyRing()` throws, or worse, a script connects to
 * the wrong database because `DATABASE_URL` fell back to a default somewhere.
 * Prisma happens to load `.env` as a side effect of importing its client, but
 * relying on a side effect of an unrelated import is how this breaks silently
 * the day that changes.
 *
 * `process.loadEnvFile` is built into Node 22.6+, which this repository already
 * requires — so this stays consistent with the no-dependency rule.
 *
 * Import this FIRST in any script, before anything that reads process.env.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const envPath = join(appRoot, '.env');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
} else {
  console.warn(
    `\x1b[33m!\x1b[0m No .env found at ${envPath}. Copy .env.example and fill it in — ` +
      `this script will fail rather than fall back to insecure defaults.`,
  );
}
