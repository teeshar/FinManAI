/**
 * POST /api/agreement/sign
 *
 * The standardised Most Important Terms & Conditions, mandatory in client
 * agreements since 17 February 2025.
 *
 * We store a hash of the exact document served, not just a version string, so
 * we can prove precisely what the client saw — a version number proves only
 * what we say they saw.
 */

import { prisma } from '../../../../lib/db.ts';
import { recordAudit } from '../../../../lib/audit.ts';
import { requireVerifiedUser, requestIp, requestIpHash } from '../../../../lib/auth.ts';
import { handle, ok, fail, readJson } from '../../../../lib/http.ts';
import { createHash } from 'node:crypto';

// Not exported: Next route modules only permit specific export names.
const MITC_VERSION = 'v1.0';

/**
 * SEBI caps individual/HUF advisory fees. Enforced here, not configurable.
 *
 * The MVP charges NOTHING. That is a deliberate regulatory choice, not an
 * oversight: SEBI's definition of investment advice turns on advice given
 * "for consideration", and ₹50 is consideration exactly as ₹50,000 is. A free
 * pilot in diagnostic_only mode keeps the whole exercise outside the perimeter
 * until registration lands. Set a fee only after that.
 */
const FEE_CAP_PAISE = {
  fixedAnnual: 15_100_000, // ₹1,51,000 per family per year
  auaShare: 0.025, // 2.5% of assets under advice
} as const;

/** Charging anything before RIA registration makes the advice regulated. */
const MVP_FEE_PAISE = 0;

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireVerifiedUser();
    const body = (await readJson(req)) as {
      documentHash?: string;
      feeModel?: 'fixed' | 'aua';
      feeAmountPaise?: number;
      accepted?: boolean;
    };

    if (!body.accepted) return fail('You must accept the terms to continue.', 422);
    if (!body.documentHash) return fail('Missing the document hash.', 400);
    if (body.feeModel !== 'fixed' && body.feeModel !== 'aua') {
      return fail('Fee model must be either fixed or assets-based.', 422);
    }

    const fee = body.feeAmountPaise ?? MVP_FEE_PAISE;
    if (!Number.isInteger(fee) || fee < 0) return fail('Fee must be a whole number of paise.', 422);

    // The cap is a hard limit, not a default a salesperson can override.
    if (fee > 0 && process.env.ADVISORY_MODE !== 'advisory') {
      return fail(
        'A fee cannot be charged while the service is running in diagnostic-only mode. ' +
          'Any fee makes this regulated investment advice under the SEBI Investment Adviser Regulations.',
        409,
      );
    }

    if (body.feeModel === 'fixed' && fee > FEE_CAP_PAISE.fixedAnnual) {
      return fail(
        `The fixed advisory fee cannot exceed ₹1,51,000 per family per year under SEBI rules.`,
        422,
      );
    }

    const existing = await prisma.clientAgreement.findFirst({
      where: { userId: user.id },
      orderBy: { signedAt: 'desc' },
    });
    if (existing && existing.mitcVersion === MITC_VERSION) {
      return ok({ status: 'already_signed', signedAt: existing.signedAt });
    }

    const agreement = await prisma.clientAgreement.create({
      data: {
        userId: user.id,
        mitcVersion: MITC_VERSION,
        documentHash: body.documentHash,
        feeModel: body.feeModel,
        feeAmountPaise: fee,
        ipHash: await requestIpHash(),
      },
    });

    await recordAudit('agreement.signed', 'ClientAgreement', agreement.id, {
      userId: user.id, actorId: user.id, ip: await requestIp(),
    }, {
      mitcVersion: MITC_VERSION,
      feeModel: body.feeModel,
      documentHash: createHash('sha256').update(body.documentHash).digest('hex').slice(0, 16),
    });

    return ok({ status: 'signed', signedAt: agreement.signedAt });
  });
}
