/**
 * Seed the database with the nine engine personas.
 *
 * You get a realistic dataset on day one — including the awkward cases the
 * engine is built to handle correctly: a household in deficit, a 58-year-old
 * badly overweight equity, someone who refuses equity entirely.
 *
 * Run: npm run db:seed
 */

import { PrismaClient } from '@prisma/client';
import { ALL_PERSONAS } from '../../engine/fixtures/personas.ts';
import { hashPassword } from '../../core/src/password.ts';
import { encryptField } from '../../core/src/field-crypto.ts';
import { hashObject, appendEvent } from '../../core/src/audit.ts';
import type { AuditEvent } from '../../core/src/audit.ts';
import { keyRingFrom } from '../../core/src/field-crypto.ts';
import { requireTestDatabase } from '../scripts/guard-test-db.ts';

// Hard stop before anything is written. See guard-test-db.ts.
requireTestDatabase('the seed');

const prisma = new PrismaClient();

const SEED_PASSWORD = 'seed-account-not-for-production';

function ring() {
  const active = process.env.FIELD_KEY_ACTIVE ?? 'v1';
  const key = process.env[`FIELD_KEY_${active.toUpperCase()}`];
  if (!key) {
    throw new Error(
      `FIELD_KEY_${active.toUpperCase()} is not set. Generate one with:\n` +
        `  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return keyRingFrom({ [active]: key }, active);
}

async function main() {
  // These accounts are email-verified, have 2FA disabled, and share a password
  // that is printed to the console and committed to the repo. Creating them
  // against a real database would be a live account-takeover path, so refuse —
  // the same guard scripts/verify-email.ts uses.
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed demo accounts in production.');
    process.exit(1);
  }

  const keys = ring();
  const passwordHash = await hashPassword(SEED_PASSWORD);
  // Continue the existing chain rather than assuming an empty one. Seeding a
  // database that already has audit events (from a smoke run, say) would
  // otherwise recompute sequence 1 and collide on the unique constraint.
  const lastRow = await prisma.auditEvent.findFirst({ orderBy: { sequence: 'desc' } });
  let previous: AuditEvent | null = lastRow
    ? {
        sequence: lastRow.sequence,
        userId: lastRow.userId,
        actorId: lastRow.actorId,
        action: lastRow.action as AuditEvent['action'],
        entityType: lastRow.entityType,
        entityId: lastRow.entityId,
        metadata: lastRow.metadata ? JSON.parse(lastRow.metadata) : undefined,
        createdAt: lastRow.createdAt.toISOString(),
        ipHash: lastRow.ipHash,
        prevHash: lastRow.prevHash,
        hash: lastRow.hash,
      }
    : null;

  for (const persona of ALL_PERSONAS) {
    const email = `${persona.key}@seed.finmanai.local`;

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash,
        emailVerified: new Date(),
        // Seed accounts skip TOTP so the flow is testable without a phone.
        // Never do this outside development.
        totpEnabled: false,
      },
    });

    const profileId = crypto.randomUUID();
    const data = { ...persona.profile, profileId };
    const dataHash = hashObject(data);

    const existing = await prisma.profile.findFirst({ where: { userId: user.id, isActive: true } });
    if (existing?.dataHash === dataHash) {
      console.log(`= ${persona.key} unchanged`);
      continue;
    }

    await prisma.profile.updateMany({ where: { userId: user.id }, data: { isActive: false } });
    await prisma.profile.create({
      data: {
        id: profileId,
        userId: user.id,
        version: (existing?.version ?? 0) + 1,
        isActive: true,
        planningMode: persona.profile.planningMode,
        dataEncrypted: encryptField(JSON.stringify(data), keys, `profile:${profileId}`),
        dataHash,
        keyVersion: keys.activeVersion,
        createdBy: user.id,
      },
    });

    await prisma.consent.create({
      data: {
        userId: user.id,
        consentVersion: 'v1.0',
        processFinancialInformation: true,
        generatePersonalisedRecommendations: true,
        informationAccurate: true,
        riskDisclosuresAccepted: true,
        storeRecommendationHistory: true,
        remindersAndNotifications: false,
      },
    });

    // Keep the audit chain intact even in seeded data — otherwise the first
    // verifyChain() run in development reports a break and everyone learns to
    // ignore it, which is exactly the habit you do not want.
    const event = appendEvent(
      {
        action: 'profile.committed',
        userId: user.id,
        actorId: user.id,
        entityType: 'Profile',
        entityId: profileId,
        metadata: { seeded: true, persona: persona.key },
        createdAt: new Date().toISOString(),
        ipHash: null,
      },
      previous,
    );
    await prisma.auditEvent.create({
      data: {
        sequence: event.sequence,
        userId: event.userId,
        actorId: event.actorId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        metadata: JSON.stringify(event.metadata),
        createdAt: new Date(event.createdAt),
        prevHash: event.prevHash,
        hash: event.hash,
      },
    });
    previous = event;

    console.log(`+ ${persona.key} → ${email}`);
  }

  console.log(`\nAll seed accounts use the password: ${SEED_PASSWORD}`);
  console.log('Development only. These accounts have 2FA disabled.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
