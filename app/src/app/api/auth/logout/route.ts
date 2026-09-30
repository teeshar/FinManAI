import { endSession, currentUser, requestIp } from '../../../../lib/auth.ts';
import { recordAudit } from '../../../../lib/audit.ts';
import { handle, ok } from '../../../../lib/http.ts';

export async function POST() {
  return handle(async () => {
    const user = await currentUser();
    if (user) {
      await recordAudit('user.logout', 'Session', user.sessionId, {
        userId: user.id, actorId: user.id, ip: await requestIp(),
      });
    }
    await endSession();
    return ok({ status: 'signed_out' });
  });
}
