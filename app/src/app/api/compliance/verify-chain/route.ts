/**
 * GET /api/compliance/verify-chain
 *
 * Walks the whole audit chain and confirms every link. Run this on a schedule,
 * not just before an audit — if a row is ever altered you want to find out in
 * days, not at the annual review.
 */

import { verifyAuditChain } from '../../../../lib/audit.ts';
import { requireRole } from '../../../../lib/auth.ts';
import { handle, ok } from '../../../../lib/http.ts';

export async function GET() {
  return handle(async () => {
    await requireRole('COMPLIANCE', 'ADMIN');
    const result = await verifyAuditChain();
    return ok(result);
  });
}
