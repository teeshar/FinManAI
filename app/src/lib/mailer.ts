/**
 * Outgoing mail.
 *
 * Two decisions, both about honesty rather than deliverability:
 *
 * **Queue, then send.** A request must not fail because a mail server is slow,
 * and — more importantly — a reminder we *believe* we sent but did not is worse
 * than one visibly stuck in a queue. Every message is a row before it is a
 * network call, so "did this client get their annual review reminder" has an
 * answer that is not a guess.
 *
 * **Deduplicate at enqueue time.** A cron that runs twice, or a deploy that
 * replays a job, must not mail the same person the same reminder twice. The
 * dedupe key carries the period — `reprofile_due:<userId>:2027-03` — so the
 * reminder can legitimately repeat next month but never within one.
 *
 * The transport is an interface with a console implementation. Real delivery is
 * an SMTP or provider adapter dropped in here; nothing else in the application
 * needs to know which is in use, and the console one is what development uses
 * so that a missing API key never silently swallows mail.
 */

import nodemailer from 'nodemailer';
import { prisma } from './db.ts';

export type MailKind = 'reprofile_due' | 'reprofile_overdue' | 'plan_ready' | 'verify_email';

export type Message = {
  userId: string | null;
  kind: MailKind;
  toEmail: string;
  subject: string;
  body: string;
  /** One message per key, ever. Include the period for anything recurring. */
  dedupeKey: string;
};

export interface MailTransport {
  readonly name: string;
  send(message: { toEmail: string; subject: string; body: string }): Promise<void>;
}

/**
 * Development transport. Prints the message and nothing else.
 *
 * Deliberately loud: a reminder system that appears to work in development and
 * silently does nothing in production is a class of bug that surfaces only when
 * a client says "you never told me".
 */
export const consoleTransport: MailTransport = {
  name: 'console',
  async send({ toEmail, subject, body }) {
    console.log(
      `\n───── mail ─────\nTo: ${toEmail}\nSubject: ${subject}\n\n${body}\n────────────────\n`,
    );
  },
};

/**
 * Real delivery, over SMTP.
 *
 * One transport covers both cases people actually need: a local catcher
 * (Mailpit, MailHog) on port 1025 with no auth, and a real provider — Gmail
 * with an app password, SES, Resend, Postmark — on 587 with auth. The only
 * difference is what is in `.env`.
 *
 * `secure` is false on 587 by design: that port begins in plaintext and is
 * upgraded by STARTTLS, which nodemailer does automatically. Port 465 is the
 * implicit-TLS one, so `secure` follows the port unless overridden. Getting
 * this backwards is the single most common reason SMTP "hangs" — it is a TLS
 * handshake against a server that is not speaking TLS yet.
 */
function smtpTransport(): MailTransport {
  const host = process.env.SMTP_HOST;
  if (!host) {
    throw new Error(
      'MAIL_TRANSPORT="smtp" but SMTP_HOST is not set. See RUNBOOK-OPERATIONS.md — ' +
        'or set MAIL_TRANSPORT="console" to print mail instead.',
    );
  }

  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;

  const transporter = nodemailer.createTransport({
    host,
    port,
    // 465 is implicit TLS; 587 and 1025 start plaintext and upgrade.
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    // A local catcher has no credentials, and passing empty ones makes it
    // refuse the connection rather than accept it anonymously.
    auth: user && pass ? { user, pass } : undefined,
    // Fail rather than hold a request thread open against a dead server.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  return {
    name: `smtp:${host}:${port}`,
    async send({ toEmail, subject, body }) {
      await transporter.sendMail({
        from: process.env.MAIL_FROM ?? 'FinManAI <no-reply@finmanai.local>',
        to: toEmail,
        subject,
        text: body,
      });
    },
  };
}

/**
 * The configured transport.
 *
 * An unknown value throws at startup rather than falling back to console. A
 * mail system that appears to work and silently discards everything is the
 * failure mode that surfaces only when a client says "you never told me".
 */
export function transportFromEnv(): MailTransport {
  const configured = process.env.MAIL_TRANSPORT ?? 'console';
  if (configured === 'console') return consoleTransport;
  if (configured === 'smtp') return smtpTransport();
  throw new Error(
    `MAIL_TRANSPORT="${configured}" is not a transport. Use "console" or "smtp", or add ` +
      `the adapter in src/lib/mailer.ts — and keep the queue-then-send shape.`,
  );
}

/** Enqueue. Returns false when this exact message was already queued. */
export async function enqueue(message: Message): Promise<boolean> {
  const existing = await prisma.outbox.findUnique({ where: { dedupeKey: message.dedupeKey } });
  if (existing) return false;

  await prisma.outbox.create({
    data: {
      userId: message.userId,
      kind: message.kind,
      toEmail: message.toEmail,
      subject: message.subject,
      body: message.body,
      dedupeKey: message.dedupeKey,
    },
  });
  return true;
}

export type FlushResult = { sent: number; failed: number; errors: string[] };

/**
 * Deliver everything queued.
 *
 * A failure is recorded on the row and left in the queue rather than dropped:
 * the next run retries it, and a message that keeps failing is visible as a
 * rising `attempts` count instead of disappearing.
 */
export async function flushOutbox(
  transport: MailTransport = transportFromEnv(),
  batchSize = 50,
): Promise<FlushResult> {
  const pending = await prisma.outbox.findMany({
    where: { sentAt: null },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });

  const result: FlushResult = { sent: 0, failed: 0, errors: [] };

  for (const row of pending) {
    try {
      await transport.send({ toEmail: row.toEmail, subject: row.subject, body: row.body });
      await prisma.outbox.update({
        where: { id: row.id },
        data: { sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
      result.sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.outbox.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 }, lastError: message },
      });
      result.failed++;
      // The address is not logged — an email address is personal data and this
      // output lands in operational logs.
      result.errors.push(`${row.kind} (${row.id}): ${message}`);
    }
  }

  return result;
}

/**
 * Queue a message and try to deliver it now, without making the caller wait.
 *
 * The queue-then-send rule exists so a request never fails because a mail
 * server is slow. But a verification email nobody sends until the next cron run
 * is useless — the person is sitting on the "check your email" screen. So the
 * row is written synchronously, which is the part that must not be lost, and
 * delivery is kicked off without awaiting it.
 *
 * If that delivery fails the row simply stays queued and the next
 * `send-reminders` run retries it. Nothing is dropped; at worst it is late.
 *
 * One caveat worth knowing: on a serverless platform, work started after the
 * response may be killed before it finishes. There the scheduled flush is not a
 * fallback but the actual delivery path, and that is fine — the queue is the
 * record either way.
 */
export async function deliverSoon(message: Message): Promise<void> {
  const queued = await enqueue(message);
  if (!queued) return;

  void flushOutbox().catch((err) => {
    // Never throw into the caller: the message is safely queued, and the
    // scheduled flush will pick it up.
    console.error(
      '[mail] immediate delivery failed; the message stays queued for retry:',
      err instanceof Error ? err.message : err,
    );
  });
}
