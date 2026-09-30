/**
 * Annual review reminders.
 *
 * SEBI requires the risk profile to be reviewed at least annually. That is not
 * an administrative deadline — it is the acknowledgement that suitability moves.
 * A household's income, dependants and goals all change, and a plan built on
 * last year's answers may be advising a family that no longer exists.
 *
 * Three touches, and then monthly: thirty days before, on the day, and once a
 * month after. Monthly rather than weekly because a reminder people learn to
 * ignore is worse than one they notice, and because the honest message after
 * the first month is not *urgent* — it is *your plan is no longer current
 * advice*, which is a thing to say once a month, calmly, until it is fixed.
 *
 * Only clients who consented to reminders are mailed. That consent is one of
 * the six §15 flags and it is revocable, so it is checked at send time rather
 * than assumed from signup.
 */

import { REPROFILE_WARNING_DAYS } from '../../../core/src/profile-store.ts';
import { reviewState } from './reprofile.ts';
import { enqueue } from './mailer.ts';
import type { MailKind } from './mailer.ts';
import { prisma } from './db.ts';

const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';

/** The period stamp in a dedupe key. Monthly, so a reminder repeats at most once a month. */
const period = (now: Date) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

function dueSoonMessage(days: number): { subject: string; body: string } {
  return {
    subject: 'Your annual financial review is due soon',
    body:
      `Your risk profile is due for its annual review in ${days} days.\n\n` +
      `It takes a few minutes: we show you what you told us last year, you confirm what is still ` +
      `true and change what is not. If nothing has changed, saying so is the whole task.\n\n` +
      `Review it here: ${appUrl()}/reprofile\n\n` +
      `Why we ask: recommendations are only suitable for the situation they were built for. ` +
      `Income, family and goals move, and advice that does not move with them stops being advice.`,
  };
}

function overdueMessage(days: number): { subject: string; body: string } {
  return {
    subject: 'Your financial plan is no longer current',
    body:
      `Your risk profile was last reviewed ${days} days ago, so it is now past its annual review.\n\n` +
      `Your plan has not gone anywhere and nothing has been deleted — but we can no longer present ` +
      `it as current advice, because we cannot vouch for inputs a year old. It will be shown as a ` +
      `historical record until you review it.\n\n` +
      `Bring it up to date: ${appUrl()}/reprofile`,
  };
}

/**
 * The account-verification email.
 *
 * Lives here with the other message bodies rather than inline in the signup
 * route, so every piece of mail the product sends can be read in one place and
 * kept in one voice.
 */
export function verificationMessage(token: string): { subject: string; body: string } {
  return {
    subject: 'Confirm your email address',
    body:
      `Confirm your email address to finish setting up your FinManAI account:\n\n` +
      `  ${appUrl()}/verify-email?token=${token}\n\n` +
      `The link is good for 24 hours.\n\n` +
      `You will be asked to set up two-factor authentication next. That step is not optional: ` +
      `this account holds your complete financial position, and a password on its own is not ` +
      `enough to protect it.\n\n` +
      `If you did not create this account, ignore this email — nothing has been set up.`,
  };
}

/**
 * Sent when someone tries to sign up with an address that already has an
 * account.
 *
 * The signup endpoint deliberately gives the same answer either way, so it
 * cannot be used to discover which addresses are registered. The cost of that
 * is a dead end: the person is told to check their email, and nothing arrives,
 * because there was no new account to verify. They conclude the mail is broken.
 *
 * Mailing the address itself resolves it without giving anything away — only
 * the genuine owner of the mailbox ever sees this, and what they see is the
 * truth about their own account.
 */
export function alreadyRegisteredMessage(verified: boolean): { subject: string; body: string } {
  return {
    subject: 'You already have a FinManAI account',
    body:
      `Someone just tried to create an account with this email address, and one already exists.\n\n` +
      (verified
        ? `Nothing has changed. To get in, sign in instead:\n\n  ${appUrl()}/login\n\n` +
          `If you have forgotten your password, or you originally signed in with Google, use the ` +
          `Google button on that page.\n\n`
        : `Your address has not been confirmed yet. Use the link in the original confirmation ` +
          `email, or start again here:\n\n  ${appUrl()}/signup\n\n`) +
      `If this was not you, you can ignore this — no account was created and nothing was changed.`,
  };
}

export type ReminderRun = {
  scanned: number;
  queued: { userId: string; kind: MailKind }[];
  skippedNoConsent: number;
};

/**
 * Scan every client and queue what is due.
 *
 * Idempotent by construction: the dedupe key carries the calendar month, so
 * running this twice in a day queues nothing the second time.
 */
export async function queueDueReminders(now = new Date()): Promise<ReminderRun> {
  const users = await prisma.user.findMany({
    where: { role: 'CLIENT', deletedAt: null, emailVerified: { not: null } },
    select: {
      id: true,
      email: true,
      consents: {
        where: { revokedAt: null },
        orderBy: { acceptedAt: 'desc' },
        take: 1,
        select: { remindersAndNotifications: true },
      },
    },
  });

  const run: ReminderRun = { scanned: users.length, queued: [], skippedNoConsent: 0 };

  for (const user of users) {
    const state = await reviewState(user.id, now.toISOString());
    if (!state.status || state.status.state === 'current') continue;

    // Consent to be contacted is revocable, so it is checked here rather than
    // inferred from the fact that they once signed up.
    if (!user.consents[0]?.remindersAndNotifications) {
      run.skippedNoConsent++;
      continue;
    }

    const overdue = state.status.state === 'overdue';
    const kind: MailKind = overdue ? 'reprofile_overdue' : 'reprofile_due';
    const content = overdue
      ? overdueMessage(state.status.daysSinceProfile)
      : dueSoonMessage(state.status.dueInDays);

    // Before the date, one reminder only — keyed to the due window rather than
    // the month, so the 30-day warning cannot fire twice.
    const key = overdue
      ? `${kind}:${user.id}:${period(now)}`
      : `${kind}:${user.id}:${state.lastReviewedAt?.slice(0, 10)}`;

    const queued = await enqueue({
      userId: user.id,
      kind,
      toEmail: user.email,
      subject: content.subject,
      body: content.body,
      dedupeKey: key,
    });

    if (queued) run.queued.push({ userId: user.id, kind });
  }

  return run;
}

export { REPROFILE_WARNING_DAYS };
