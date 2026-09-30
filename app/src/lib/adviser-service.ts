/**
 * The adviser side of the relationship: the review queue, notes, and the
 * decision to release a plan.
 *
 * The organising idea is that an RIA is personally accountable for advice given
 * under their name. That has two consequences built here:
 *
 *   1. **A plan is generated, then released.** In advisory mode the engine's
 *      output is not automatically the adviser's advice. Someone signs off on
 *      it. This is the difference between a tool that produces documents and a
 *      person who is answerable for them.
 *   2. **Notes are part of the record.** What the adviser was thinking when
 *      they released a plan is retained with the plan for the full retention
 *      window, encrypted, because a note about a client's finances is client
 *      financial data however informally it was written.
 *
 * In `diagnostic_only` mode nothing here gates anything: a diagnostic report is
 * not advice, so there is no one to sign it off. The approval requirement turns
 * on with advisory mode, alongside everything else that does.
 */

import { encryptField, decryptField } from '../../../core/src/field-crypto.ts';
import { reviewState } from './reprofile.ts';
import { keyRing, advisoryMode } from './keys.ts';
import { recordAudit } from './audit.ts';
import type { AuditContext } from './audit.ts';
import { prisma } from './db.ts';

const noteAad = (noteId: string) => `note:${noteId}`;

/* ------------------------------------------------------------------ */
/* The queue                                                           */
/* ------------------------------------------------------------------ */

export type QueueEntry = {
  clientId: string;
  email: string;
  status: string;
  profileVersion: number | null;
  reviewState: 'none' | 'current' | 'due_soon' | 'overdue';
  daysSinceReview: number | null;
  /** True once the plan may no longer be shown to the client as live advice. */
  materiallyOverdue: boolean;
  /** The plan was built on assumptions that have since been superseded. */
  assumptionsStale: boolean;
  latestPlanId: string | null;
  latestPlanAt: string | null;
  awaitingApproval: boolean;
  /** Sort key. Highest first — what to look at this morning. */
  urgency: number;
};

/**
 * SEBI grades the lien deposit by client count. The console warns as a
 * threshold approaches rather than after it is crossed, because the deposit has
 * to be arranged before the 151st client, not discovered afterwards.
 */
export const DEPOSIT_BANDS: { upTo: number; deposit: string }[] = [
  { upTo: 150, deposit: '₹1,00,000' },
  { upTo: 300, deposit: '₹2,00,000' },
  { upTo: 1000, deposit: '₹5,00,000' },
  { upTo: Infinity, deposit: '₹10,00,000' },
];

export function depositBand(activeClients: number): {
  deposit: string;
  nextThreshold: number | null;
  nextDeposit: string | null;
  warning: string | null;
} {
  const index = DEPOSIT_BANDS.findIndex((b) => activeClients <= b.upTo);
  const band = DEPOSIT_BANDS[index];
  const next = DEPOSIT_BANDS[index + 1] ?? null;
  const headroom = band.upTo === Infinity ? Infinity : band.upTo - activeClients;

  return {
    deposit: band.deposit,
    nextThreshold: next ? band.upTo + 1 : null,
    nextDeposit: next?.deposit ?? null,
    warning:
      next && headroom <= 15
        ? `You are ${headroom} client${headroom === 1 ? '' : 's'} from the ${band.upTo + 1}-client threshold, ` +
          `where the IAASB deposit rises from ${band.deposit} to ${next.deposit}. Arrange it before you take them on.`
        : null,
  };
}

/**
 * Clients needing attention, most urgent first.
 *
 * Urgency is a small integer rather than a score with decimals, because the
 * only decision it drives is the order of a list and a false sense of precision
 * would invite tuning it instead of reading it.
 */
export async function adviserQueue(adviserId: string): Promise<{
  entries: QueueEntry[];
  activeClients: number;
  deposit: ReturnType<typeof depositBand>;
}> {
  const links = await prisma.adviserClient.findMany({
    where: { adviserId, revokedAt: null },
    include: { client: { select: { id: true, email: true } } },
  });

  const advisory = advisoryMode() === 'advisory';
  const entries: QueueEntry[] = [];

  for (const link of links) {
    const state = await reviewState(link.client.id);

    let awaitingApproval = false;
    if (advisory && state.latestPlan) {
      const approval = await prisma.planApproval.findFirst({
        where: { planId: state.latestPlan.id },
        orderBy: { decidedAt: 'desc' },
      });
      awaitingApproval = approval?.decision !== 'approved';
    }

    const reviewLabel = state.status?.state ?? 'none';
    const urgency =
      (state.materiallyOverdue ? 8 : 0) +
      (reviewLabel === 'overdue' ? 4 : reviewLabel === 'due_soon' ? 2 : 0) +
      (awaitingApproval ? 3 : 0) +
      (state.assumptionsDrift ? 1 : 0) +
      (link.status === 'invited' ? 1 : 0);

    entries.push({
      clientId: link.client.id,
      email: link.client.email,
      status: link.status,
      profileVersion: state.profileVersion,
      reviewState: reviewLabel as QueueEntry['reviewState'],
      daysSinceReview: state.status?.daysSinceProfile ?? null,
      materiallyOverdue: state.materiallyOverdue,
      assumptionsStale: state.assumptionsDrift !== null,
      latestPlanId: state.latestPlan?.id ?? null,
      latestPlanAt: state.latestPlan?.generatedAt ?? null,
      awaitingApproval,
      urgency,
    });
  }

  entries.sort((a, b) => b.urgency - a.urgency || a.email.localeCompare(b.email));

  const activeClients = links.filter((l) => l.status === 'active').length;
  return { entries, activeClients, deposit: depositBand(activeClients) };
}

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

export async function addPlanNote(
  planId: string,
  adviserId: string,
  body: string,
  ctx: AuditContext,
): Promise<string> {
  const id = crypto.randomUUID();
  const ring = keyRing();

  await prisma.planNote.create({
    data: {
      id,
      planId,
      adviserId,
      bodyEncrypted: encryptField(body, ring, noteAad(id)),
      keyVersion: ring.activeVersion,
    },
  });

  // The note's CONTENTS never reach the audit metadata — that table is the one
  // thing not encrypted, because it must stay queryable for an audit.
  await recordAudit('plan.note_added', 'PlanNote', id, ctx, { planId, length: body.length });
  return id;
}

export type PlanNoteView = { id: string; adviserId: string; body: string; createdAt: string };

export async function planNotes(planId: string): Promise<PlanNoteView[]> {
  const rows = await prisma.planNote.findMany({
    where: { planId },
    orderBy: { createdAt: 'asc' },
  });
  const ring = keyRing();
  return rows.map((r) => ({
    id: r.id,
    adviserId: r.adviserId,
    body: decryptField(r.bodyEncrypted, ring, noteAad(r.id)),
    createdAt: r.createdAt.toISOString(),
  }));
}

/* ------------------------------------------------------------------ */
/* Release                                                             */
/* ------------------------------------------------------------------ */

export type ApprovalState = {
  /** False when this deployment does not require approval at all. */
  required: boolean;
  decision: 'approved' | 'withheld' | null;
  decidedAt: string | null;
  reason: string | null;
};

/**
 * The current release state of a plan.
 *
 * `required: false` in diagnostic mode is not a loophole — it is the honest
 * answer. A diagnostic report makes no recommendation, so there is nothing for
 * an adviser to put their name to.
 */
export async function approvalState(planId: string): Promise<ApprovalState> {
  if (advisoryMode() !== 'advisory') {
    return { required: false, decision: null, decidedAt: null, reason: null };
  }
  const row = await prisma.planApproval.findFirst({
    where: { planId },
    orderBy: { decidedAt: 'desc' },
  });
  return {
    required: true,
    decision: (row?.decision as 'approved' | 'withheld' | undefined) ?? null,
    decidedAt: row?.decidedAt.toISOString() ?? null,
    reason: row?.reason ?? null,
  };
}

export async function decidePlan(
  planId: string,
  adviserId: string,
  decision: 'approved' | 'withheld',
  reason: string | null,
  ctx: AuditContext,
): Promise<void> {
  // Append, never update. A withheld-then-approved sequence is part of the
  // record; a mutable column would erase the fact that anyone hesitated.
  await prisma.planApproval.create({ data: { planId, adviserId, decision, reason } });
  await recordAudit(
    decision === 'approved' ? 'plan.approved' : 'plan.withheld',
    'Plan',
    planId,
    ctx,
    { decision, hasReason: reason !== null },
  );
}
