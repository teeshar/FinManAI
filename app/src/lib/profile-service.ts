/**
 * Draft → validate → commit → version.
 *
 * The one path in Phase 2 that must not be got wrong, because everything
 * downstream — every plan, every suitability record, every audit answer —
 * depends on the profile being exactly what it says it was.
 */

import { commitProfile, verifySnapshot, detectMaterialChanges } from '../../../core/src/profile-store.ts';
import type { ProfileSnapshot } from '../../../core/src/profile-store.ts';
import { encryptField, decryptField, keyVersionOf } from '../../../core/src/field-crypto.ts';
import { keyRing } from './keys.ts';
import { recordAudit } from './audit.ts';
import type { AuditContext } from './audit.ts';
import { prisma } from './db.ts';
import { financialProfileSchema } from './validation.ts';

/** AAD binds ciphertext to its row. A profile cannot be moved between users. */
const profileAad = (profileId: string) => `profile:${profileId}`;

/** The step-8 consent block, as validated by `consentSchema`. */
type ConsentBlock = {
  consentVersion: string;
  acceptedAt: string;
  processFinancialInformation: boolean;
  generatePersonalisedRecommendations: boolean;
  informationAccurate: boolean;
  riskDisclosuresAccepted: boolean;
  storeRecommendationHistory: boolean;
  remindersAndNotifications: boolean;
  nomineeName?: string;
  emergencyContact?: string;
};
const draftAad = (userId: string, step: number) => `draft:${userId}:${step}`;

/* ------------------------------------------------------------------ */
/* Drafts — mutable, disposable, not a record of advice                */
/* ------------------------------------------------------------------ */

export async function saveDraftStep(
  userId: string,
  step: number,
  data: unknown,
  ctx: AuditContext,
): Promise<void> {
  const encrypted = encryptField(JSON.stringify(data), keyRing(), draftAad(userId, step));

  await prisma.profileDraft.upsert({
    where: { userId_step: { userId, step } },
    create: { userId, step, data: encrypted },
    update: { data: encrypted },
  });

  // Metadata records WHICH step, never what is in it.
  await recordAudit('profile.draft_saved', 'ProfileDraft', `${userId}:${step}`, ctx, { step });
}

export async function loadDraft(userId: string): Promise<Record<number, unknown>> {
  const rows = await prisma.profileDraft.findMany({ where: { userId } });
  const out: Record<number, unknown> = {};
  for (const row of rows) {
    out[row.step] = JSON.parse(decryptField(row.data, keyRing(), draftAad(userId, row.step)));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Commit — immutable, versioned                                       */
/* ------------------------------------------------------------------ */

export type CommitResult =
  | { status: 'committed'; snapshot: ProfileSnapshot; materialChanges: string[] }
  | { status: 'unchanged' }
  | { status: 'invalid'; errors: string[] };

/**
 * Assemble the draft steps into a complete profile, validate it, and write a
 * new immutable version.
 *
 * Returns `unchanged` when the data is byte-identical to the active version —
 * otherwise the history fills with noise and a genuine change becomes hard to
 * find during an audit.
 */
export async function commitProfileFromDraft(
  userId: string,
  ctx: AuditContext,
): Promise<CommitResult> {
  const draft = await loadDraft(userId);

  // Steps are merged in order; later steps never silently overwrite earlier
  // ones because each owns a disjoint set of top-level keys.
  const assembled = Object.keys(draft)
    .map(Number)
    .sort((a, b) => a - b)
    .reduce<Record<string, unknown>>((acc, step) => ({ ...acc, ...(draft[step] as object) }), {});

  const previousRow = await prisma.profile.findFirst({
    where: { userId, isActive: true },
    orderBy: { version: 'desc' },
  });

  // profileId and channel are server-owned — no wizard step collects them.
  // profileId must stay stable across versions: minting a fresh one each
  // commit would make every re-commit look like a change and defeat the
  // `unchanged` check below.
  const previousData = previousRow
    ? (JSON.parse(
        decryptField(previousRow.dataEncrypted, keyRing(), profileAad(previousRow.id)),
      ) as Record<string, unknown>)
    : null;

  const withServerFields = {
    ...assembled,
    profileId: (previousData?.profileId as string | undefined) ?? crypto.randomUUID(),
    channel:
      assembled.channel ??
      (ctx.actorId && ctx.actorId !== userId
        ? { channel: 'adviser', adviserId: ctx.actorId }
        : { channel: 'd2c' }),
  };

  const parsed = financialProfileSchema.safeParse(withServerFields);
  if (!parsed.success) {
    return {
      status: 'invalid',
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }

  const previous: ProfileSnapshot | null = previousRow
    ? {
        id: previousRow.id,
        userId: previousRow.userId,
        version: previousRow.version,
        isActive: previousRow.isActive,
        data: previousData!,
        dataHash: previousRow.dataHash,
        createdAt: previousRow.createdAt.toISOString(),
        createdBy: previousRow.createdBy,
      }
    : null;

  const id = crypto.randomUUID();
  const snapshot = commitProfile({
    id,
    userId,
    data: parsed.data,
    createdBy: ctx.actorId ?? userId,
    nowISO: new Date().toISOString(),
    previous,
  });

  if (!snapshot) return { status: 'unchanged' };

  const materialChanges = detectMaterialChanges(
    previous?.data as Record<string, unknown> | null,
    parsed.data as Record<string, unknown>,
  );

  const ring = keyRing();
  const encrypted = encryptField(JSON.stringify(parsed.data), ring, profileAad(id));

  await prisma.$transaction(async (tx) => {
    // Only one active version at a time; older ones remain readable forever.
    if (previousRow) {
      await tx.profile.updateMany({ where: { userId, isActive: true }, data: { isActive: false } });
    }
    await tx.profile.create({
      data: {
        id,
        userId,
        version: snapshot.version,
        isActive: true,
        planningMode: (parsed.data as { planningMode: string }).planningMode,
        dataEncrypted: encrypted,
        dataHash: snapshot.dataHash,
        keyVersion: ring.activeVersion,
        createdBy: snapshot.createdBy,
      },
    });
    // The draft is deliberately NOT deleted. It is what the wizard reloads when
    // a user reopens onboarding to amend an answer, and clearing it would make
    // every re-commit assemble an empty profile instead of reporting
    // `unchanged`.

    // The consent captured in step 8 is only evidence if it is stored as a
    // consent record — plan generation gates on this table, not on the profile
    // blob. Written in the same transaction so a profile version can never
    // exist without the consent that authorised it.
    const consent = (parsed.data as { consent: ConsentBlock }).consent;
    await tx.consent.create({
      data: {
        userId,
        consentVersion: consent.consentVersion,
        processFinancialInformation: consent.processFinancialInformation,
        generatePersonalisedRecommendations: consent.generatePersonalisedRecommendations,
        informationAccurate: consent.informationAccurate,
        riskDisclosuresAccepted: consent.riskDisclosuresAccepted,
        storeRecommendationHistory: consent.storeRecommendationHistory,
        remindersAndNotifications: consent.remindersAndNotifications,
        nomineeName: consent.nomineeName ?? null,
        emergencyContact: consent.emergencyContact ?? null,
        acceptedAt: new Date(consent.acceptedAt),
      },
    });
  });

  await recordAudit('profile.committed', 'Profile', id, ctx, {
    version: snapshot.version,
    dataHash: snapshot.dataHash,
    materialChanges,
  });

  return { status: 'committed', snapshot, materialChanges };
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export async function loadActiveProfile(
  userId: string,
  ctx: AuditContext,
): Promise<ProfileSnapshot | null> {
  const row = await prisma.profile.findFirst({
    where: { userId, isActive: true },
    orderBy: { version: 'desc' },
  });
  if (!row) return null;

  const snapshot: ProfileSnapshot = {
    id: row.id,
    userId: row.userId,
    version: row.version,
    isActive: row.isActive,
    data: JSON.parse(decryptField(row.dataEncrypted, keyRing(), profileAad(row.id))),
    dataHash: row.dataHash,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };

  // If this fails the row was altered outside the application. Fail loudly:
  // serving advice from a profile we cannot vouch for is worse than an error.
  if (!verifySnapshot(snapshot)) {
    throw new Error(
      `Profile ${row.id} failed its integrity check — stored hash does not match its contents. ` +
        `Do not serve advice from this profile. Investigate before proceeding.`,
    );
  }

  // An adviser reading a client's data is itself an auditable event.
  if (ctx.actorId && ctx.actorId !== userId) {
    await recordAudit('adviser.viewed_client', 'Profile', row.id, ctx, { version: row.version });
  }

  return snapshot;
}

/* ------------------------------------------------------------------ */
/* Key rotation                                                        */
/* ------------------------------------------------------------------ */

/**
 * Re-encrypt rows still using a retired key. Run after adding a new active key.
 * The plaintext, and therefore `dataHash`, never changes — so plans that
 * reference these profiles remain verifiable across a rotation.
 */
export async function rotateProfileKeys(batchSize = 100): Promise<number> {
  const ring = keyRing();
  const stale = await prisma.profile.findMany({
    where: { keyVersion: { not: ring.activeVersion } },
    take: batchSize,
  });

  for (const row of stale) {
    const plaintext = decryptField(row.dataEncrypted, ring, profileAad(row.id));
    const reEncrypted = encryptField(plaintext, ring, profileAad(row.id));
    await prisma.profile.update({
      where: { id: row.id },
      data: { dataEncrypted: reEncrypted, keyVersion: keyVersionOf(reEncrypted) ?? ring.activeVersion },
    });
  }

  return stale.length;
}
