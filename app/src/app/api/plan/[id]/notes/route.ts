/**
 * Adviser notes on a plan.
 *
 * GET  — the notes, decrypted, for anyone authorised to read the plan.
 * POST — add one. Advisers only: a note is the adviser's reasoning, and a
 *        client writing into that record would make it useless as evidence of
 *        what the adviser was thinking.
 *
 * Notes are retained with the plan for the full retention window. They are not
 * scratch paper.
 */

import { addPlanNote, planNotes } from '../../../../../lib/adviser-service.ts';
import { requirePlan } from '../../../../../lib/plan-access.ts';
import { requireVerifiedUser, requireRole, requestIp } from '../../../../../lib/auth.ts';
import { handle, ok, fail, readJson } from '../../../../../lib/http.ts';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireVerifiedUser();
    const plan = await requirePlan((await params).id, actor);
    return ok({ notes: await planNotes(plan.id) });
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const adviser = await requireRole('ADVISER', 'ADMIN');
    const plan = await requirePlan((await params).id, adviser);

    const body = (await readJson(req)) as { body?: string };
    const text = (body.body ?? '').trim();
    if (!text) return fail('A note needs something in it.');
    if (text.length > 5000) return fail('Notes are capped at 5,000 characters.');

    const id = await addPlanNote(plan.id, adviser.id, text, {
      userId: plan.subjectUserId,
      actorId: adviser.id,
      ip: await requestIp(),
    });

    return ok({ status: 'added', noteId: id }, 201);
  });
}
