/**
 * POST /api/auth/totp/confirm
 *
 * Completes enrolment. Only here does `totpEnabled` become true, and only here
 * are recovery codes issued — shown exactly once, stored hashed.
 */

import { verifyTotp, generateRecoveryCodes } from '../../../../../../../core/src/totp.ts';
import { decryptField } from '../../../../../../../core/src/field-crypto.ts';
import { keyRing } from '../../../../../lib/keys.ts';
import { prisma } from '../../../../../lib/db.ts';
import { recordAudit } from '../../../../../lib/audit.ts';
import { requireUser, requestIp } from '../../../../../lib/auth.ts';
import { handle, ok, fail, readJson } from '../../../../../lib/http.ts';

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const { code } = (await readJson(req)) as { code?: string };
    if (!code) return fail('Enter the 6-digit code from your authenticator app.');

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    if (!row?.totpSecretEncrypted) return fail('Start enrolment first.', 409);

    const secret = decryptField(row.totpSecretEncrypted, keyRing(), `user:${user.id}:totp`);
    const result = verifyTotp(secret, code, Math.floor(Date.now() / 1000));
    if (!result.valid) {
      return fail('That code is not right. Check your phone’s clock and try again.', 401);
    }

    const recovery = generateRecoveryCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpEnabled: true,
        totpLastCounter: result.counter,
        recoveryCodeHashes: JSON.stringify(recovery.hashes),
      },
    });

    await recordAudit('user.totp_enrolled', 'User', user.id, {
      userId: user.id, actorId: user.id, ip: await requestIp(),
    });

    return ok({
      status: 'enabled',
      recoveryCodes: recovery.plaintext,
      warning: 'Save these now. They are shown once and cannot be recovered.',
    });
  });
}
