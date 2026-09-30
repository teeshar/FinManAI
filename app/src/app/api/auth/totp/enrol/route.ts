/**
 * POST /api/auth/totp/enrol
 *
 * Issues a secret, a provisioning URI, and the QR code itself. The secret is
 * stored encrypted but `totpEnabled` stays false until a code is confirmed —
 * otherwise a half-finished enrolment locks the user out of their own account.
 *
 * The QR is rendered here rather than in the browser so the secret is drawn
 * once, server-side, and no QR library ships in the client bundle. It is an
 * inline SVG data URI: nothing is fetched from a third party, which matters
 * because the thing being drawn is a credential.
 */

import QRCode from 'qrcode';
import { generateSecret, provisioningUri } from '../../../../../../../core/src/totp.ts';
import { encryptField, decryptField } from '../../../../../../../core/src/field-crypto.ts';
import { keyRing } from '../../../../../lib/keys.ts';
import { prisma } from '../../../../../lib/db.ts';
import { requireUser } from '../../../../../lib/auth.ts';
import { handle, ok, fail } from '../../../../../lib/http.ts';

export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    if (user.totpEnabled) return fail('Two-factor authentication is already enabled.', 409);

    // Reuse a pending secret instead of minting a new one on every call.
    // The enrolment page requests this from an effect, and React StrictMode
    // invokes effects twice in development — regenerating would leave the QR
    // code the user just scanned pointing at a secret the server has already
    // replaced, so every code they type would be rejected. The same applies to
    // an ordinary page refresh.
    const aad = `user:${user.id}:totp`;
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { totpSecretEncrypted: true },
    });

    let secret: string | null = null;
    if (row?.totpSecretEncrypted) {
      // A secret encrypted under a retired key is unusable for enrolment;
      // fall through and issue a fresh one rather than failing the request.
      try {
        secret = decryptField(row.totpSecretEncrypted, keyRing(), aad);
      } catch {
        secret = null;
      }
    }

    if (!secret) {
      secret = generateSecret();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          totpSecretEncrypted: encryptField(secret, keyRing(), aad),
          totpEnabled: false,
        },
      });
    }

    const uri = provisioningUri(secret, user.email);

    return ok({
      secret, // shown once, for manual entry if the QR cannot be scanned
      uri,
      // Medium correction level: an authenticator QR is scanned from a screen a
      // few inches away, not off a poster, so the extra redundancy of a higher
      // level only makes the pattern denser and harder to read.
      qrSvg: await QRCode.toString(uri, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 220,
      }),
    });
  });
}
