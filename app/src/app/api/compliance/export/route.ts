/**
 * GET /api/compliance/export?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * What the annual compliance audit needs, in one call: the audit chain with its
 * verification result, plan metadata, consent records and signed agreements.
 *
 * Deliberately excludes plan and profile CONTENTS. An auditor needs to see that
 * advice was given, when, on what basis, and that the records are intact — not
 * to receive every client's decrypted financial position in a JSON file.
 */

import { prisma } from '../../../../lib/db.ts';
import { verifyAuditChain, recordAudit } from '../../../../lib/audit.ts';
import { requireRole, requestIp } from '../../../../lib/auth.ts';
import { handle, ok, fail } from '../../../../lib/http.ts';
import { RETENTION_YEARS } from '../../../../../../core/src/audit.ts';

export async function GET(req: Request) {
  return handle(async () => {
    const actor = await requireRole('COMPLIANCE', 'ADMIN');
    const url = new URL(req.url);

    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!from || !to) return fail('Specify both from and to dates (YYYY-MM-DD).');

    const start = new Date(from);
    const end = new Date(`${to}T23:59:59.999Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return fail('Invalid date range.');
    }

    const range = { gte: start, lte: end };

    const [chain, events, plans, consents, agreements] = await Promise.all([
      verifyAuditChain(),
      prisma.auditEvent.findMany({ where: { createdAt: range }, orderBy: { sequence: 'asc' } }),
      prisma.plan.findMany({
        where: { generatedAt: range },
        select: {
          id: true, generatedAt: true, generatedBy: true, advisoryMode: true,
          engineVersion: true, assumptionsVersion: true, profileHash: true,
          narrativeSource: true, narrativeModel: true, narrativePromptHash: true,
          narrativeRejection: true,
          profile: { select: { userId: true, version: true, dataHash: true } },
        },
      }),
      prisma.consent.findMany({ where: { acceptedAt: range } }),
      prisma.clientAgreement.findMany({ where: { signedAt: range } }),
    ]);

    await recordAudit('compliance.exported', 'AuditEvent', null, {
      userId: null, actorId: actor.id, ip: await requestIp(),
    }, { from, to, events: events.length, plans: plans.length });

    return ok({
      generatedAt: new Date().toISOString(),
      period: { from, to },
      retentionYears: RETENTION_YEARS,

      // The headline an auditor looks for first.
      chainIntegrity: chain,

      counts: {
        auditEvents: events.length,
        plans: plans.length,
        consents: consents.length,
        agreements: agreements.length,
      },

      // Every plan must trace to the profile version that produced it.
      unverifiablePlans: plans
        .filter((p) => p.profileHash !== p.profile.dataHash)
        .map((p) => ({ planId: p.id, profileVersion: p.profile.version })),

      // SEBI requires the extent of AI use to be disclosable.
      aiUsage: {
        plansWithLlmNarrative: plans.filter((p) => p.narrativeSource === 'llm').length,
        plansWithFallbackNarrative: plans.filter((p) => p.narrativeSource === 'fallback').length,
        narrativesRejectedByValidator: plans.filter((p) => p.narrativeRejection).length,
        modelsUsed: [...new Set(plans.map((p) => p.narrativeModel).filter(Boolean))],
      },

      advisoryModeBreakdown: {
        advisory: plans.filter((p) => p.advisoryMode === 'advisory').length,
        diagnosticOnly: plans.filter((p) => p.advisoryMode === 'diagnostic_only').length,
      },

      auditEvents: events.map((e) => ({
        sequence: e.sequence, action: e.action, entityType: e.entityType,
        entityId: e.entityId, userId: e.userId, actorId: e.actorId,
        createdAt: e.createdAt, hash: e.hash,
      })),
    });
  });
}
