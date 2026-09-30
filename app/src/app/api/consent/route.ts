/**
 * POST /api/consent — record consent, with the exact version agreed to.
 */

import { consentSchema, CONSENT_VERSION } from '../../../lib/validation.ts';
import { prisma } from '../../../lib/db.ts';
import { recordAudit } from '../../../lib/audit.ts';
import { requireUser, requestIp, requestIpHash } from '../../../lib/auth.ts';
import { handle, ok, fail, readJson } from '../../../lib/http.ts';
import { headers } from 'next/headers';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const parsed = consentSchema.safeParse({
      ...(await readJson(req) as object),
      acceptedAt: new Date().toISOString(),
      consentVersion: CONSENT_VERSION,
    });

    if (!parsed.success) {
      return fail('Please review the consents.', 422, {
        errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }

    const h = await headers();
    const consent = await prisma.consent.create({
      data: {
        userId: user.id,
        consentVersion: CONSENT_VERSION,
        processFinancialInformation: parsed.data.processFinancialInformation,
        generatePersonalisedRecommendations: parsed.data.generatePersonalisedRecommendations,
        informationAccurate: parsed.data.informationAccurate,
        riskDisclosuresAccepted: parsed.data.riskDisclosuresAccepted,
        storeRecommendationHistory: parsed.data.storeRecommendationHistory,
        remindersAndNotifications: parsed.data.remindersAndNotifications,
        nomineeName: parsed.data.nomineeName ?? null,
        emergencyContact: parsed.data.emergencyContact ?? null,
        ipHash: await requestIpHash(),
        userAgent: h.get('user-agent'),
      },
    });

    await recordAudit('consent.recorded', 'Consent', consent.id, {
      userId: user.id, actorId: user.id, ip: await requestIp(),
    }, { consentVersion: CONSENT_VERSION });

    return ok({ status: 'recorded' });
  });
}
