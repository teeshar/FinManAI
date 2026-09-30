/**
 * Queue and deliver the annual-review reminders.
 *
 * Two steps, deliberately separate: `queueDueReminders()` decides who is owed a
 * reminder and writes rows; `flushOutbox()` delivers them. Splitting it means a
 * mail outage loses nothing — the queue survives, and the next run delivers.
 *
 * Safe to run more than once a day. The dedupe key carries the period, so a
 * second run in the same month queues nothing.
 *
 * Usage:
 *   node --experimental-strip-types scripts/send-reminders.ts
 *   node --experimental-strip-types scripts/send-reminders.ts --queue-only
 *   node --experimental-strip-types scripts/send-reminders.ts --flush-only
 *
 * Crontab, every weekday at 09:00 IST:
 *   0 9 * * 1-5 cd /srv/finmanai/app && npm run --silent send:reminders
 */

import './env.ts';
import { queueDueReminders } from '../src/lib/reminders.ts';
import { flushOutbox, transportFromEnv } from '../src/lib/mailer.ts';
import { recordAudit } from '../src/lib/audit.ts';
import { prisma } from '../src/lib/db.ts';

const queueOnly = process.argv.includes('--queue-only');
const flushOnly = process.argv.includes('--flush-only');

if (!flushOnly) {
  const run = await queueDueReminders();
  console.log(
    `Scanned ${run.scanned} client(s): queued ${run.queued.length}, ` +
      `skipped ${run.skippedNoConsent} who have not consented to reminders.`,
  );

  // The reminder is a contact with a client about their advice. That it was
  // sent — and to whom — belongs in the record.
  for (const q of run.queued) {
    await recordAudit('reminder.queued', 'Outbox', null, {
      userId: q.userId,
      actorId: null,
    }, { kind: q.kind });
  }
}

if (!queueOnly) {
  const transport = transportFromEnv();
  const result = await flushOutbox(transport);
  console.log(`Delivered ${result.sent} via "${transport.name}", ${result.failed} failed.`);
  for (const e of result.errors) console.error(`  ${e}`);

  if (result.sent > 0) {
    await recordAudit('reminder.sent', 'Outbox', null, { userId: null, actorId: null }, {
      count: result.sent,
      transport: transport.name,
    });
  }

  if (result.failed > 0) {
    await prisma.$disconnect();
    // Non-zero so a scheduler notices. The messages stay queued and retry.
    process.exit(1);
  }
}

await prisma.$disconnect();
