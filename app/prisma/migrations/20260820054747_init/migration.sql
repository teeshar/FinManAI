-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLIENT', 'ADVISER', 'COMPLIANCE', 'ADMIN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CLIENT',
    "totpSecretEncrypted" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpLastCounter" INTEGER,
    "recoveryCodeHashes" TEXT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockoutCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "firstFailureAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdviserClient" (
    "id" TEXT NOT NULL,
    "adviserId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AdviserClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "planningMode" TEXT NOT NULL,
    "dataEncrypted" TEXT NOT NULL,
    "dataHash" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "profileHash" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "assumptionsVersion" TEXT NOT NULL,
    "advisoryMode" TEXT NOT NULL,
    "outputEncrypted" TEXT NOT NULL,
    "outputHash" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "narrative" TEXT,
    "narrativeSource" TEXT NOT NULL,
    "narrativeModel" TEXT,
    "narrativePromptHash" TEXT,
    "narrativeRejection" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedBy" TEXT NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "processFinancialInformation" BOOLEAN NOT NULL,
    "generatePersonalisedRecommendations" BOOLEAN NOT NULL,
    "informationAccurate" BOOLEAN NOT NULL,
    "riskDisclosuresAccepted" BOOLEAN NOT NULL,
    "storeRecommendationHistory" BOOLEAN NOT NULL,
    "remindersAndNotifications" BOOLEAN NOT NULL,
    "nomineeName" TEXT,
    "emergencyContact" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ipHash" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAgreement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mitcVersion" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feeModel" TEXT NOT NULL,
    "feeAmountPaise" INTEGER NOT NULL,
    "ipHash" TEXT,

    CONSTRAINT "ClientAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "userId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AdviserClient_adviserId_status_idx" ON "AdviserClient"("adviserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AdviserClient_adviserId_clientId_key" ON "AdviserClient"("adviserId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileDraft_userId_step_key" ON "ProfileDraft"("userId", "step");

-- CreateIndex
CREATE INDEX "Profile_userId_isActive_idx" ON "Profile"("userId", "isActive");

-- CreateIndex
CREATE INDEX "Profile_keyVersion_idx" ON "Profile"("keyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_version_key" ON "Profile"("userId", "version");

-- CreateIndex
CREATE INDEX "Plan_profileId_generatedAt_idx" ON "Plan"("profileId", "generatedAt");

-- CreateIndex
CREATE INDEX "Consent_userId_revokedAt_idx" ON "Consent"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "ClientAgreement_userId_idx" ON "ClientAgreement"("userId");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_sequence_key" ON "AuditEvent"("sequence");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdviserClient" ADD CONSTRAINT "AdviserClient_adviserId_fkey" FOREIGN KEY ("adviserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdviserClient" ADD CONSTRAINT "AdviserClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileDraft" ADD CONSTRAINT "ProfileDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAgreement" ADD CONSTRAINT "ClientAgreement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
