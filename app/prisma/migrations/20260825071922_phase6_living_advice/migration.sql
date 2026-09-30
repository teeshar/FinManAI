-- CreateTable
CREATE TABLE "ProfileReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "changes" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT NOT NULL,

    CONSTRAINT "ProfileReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanNote" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "adviserId" TEXT NOT NULL,
    "bodyEncrypted" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanApproval" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "adviserId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssumptionsProposal" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "fromVersion" TEXT NOT NULL,
    "proposedVersion" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stagedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "AssumptionsProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProfileReview_userId_reviewedAt_idx" ON "ProfileReview"("userId", "reviewedAt");

-- CreateIndex
CREATE INDEX "PlanNote_planId_createdAt_idx" ON "PlanNote"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanApproval_planId_decidedAt_idx" ON "PlanApproval"("planId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Outbox_dedupeKey_key" ON "Outbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "Outbox_sentAt_createdAt_idx" ON "Outbox"("sentAt", "createdAt");

-- CreateIndex
CREATE INDEX "AssumptionsProposal_status_stagedAt_idx" ON "AssumptionsProposal"("status", "stagedAt");

-- AddForeignKey
ALTER TABLE "ProfileReview" ADD CONSTRAINT "ProfileReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileReview" ADD CONSTRAINT "ProfileReview_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanNote" ADD CONSTRAINT "PlanNote_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanApproval" ADD CONSTRAINT "PlanApproval_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
