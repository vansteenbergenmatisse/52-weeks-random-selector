-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Couple" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Couple_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "emoji" TEXT NOT NULL DEFAULT '🎲',
    "colorKey" TEXT NOT NULL DEFAULT 'charcoal',
    "targetPerPerson" INTEGER NOT NULL DEFAULT 26,
    "autoSelect" BOOLEAN NOT NULL DEFAULT false,
    "scheduleWeekday" INTEGER NOT NULL DEFAULT 0,
    "scheduleTime" TEXT NOT NULL DEFAULT '20:00',
    "scheduleTimezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "notifyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notifyWeekday" INTEGER,
    "notifyTime" TEXT,
    "notifyTimezone" TEXT,
    "cycleStartDate" TIMESTAMP(3),
    "cycleIndex" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "emoji" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "tmdbId" INTEGER,
    "posterPath" TEXT,
    "backdropPath" TEXT,
    "releaseYear" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyPeriod" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "cycleIndex" INTEGER NOT NULL,
    "weekIndex" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyResult" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "currentRevisionNumber" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultRevision" (
    "id" TEXT NOT NULL,
    "weeklyResultId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "entryId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'web',
    "reason" TEXT NOT NULL DEFAULT 'spin',
    "createdByUserId" TEXT,
    "snapTitle" TEXT NOT NULL,
    "snapDescription" TEXT,
    "snapEmoji" TEXT,
    "snapContributor" TEXT NOT NULL,
    "snapPosterPath" TEXT,
    "snapBackdropPath" TEXT,
    "rejectedEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppSession" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "phone" TEXT,
    "lastQr" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppConfig" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT NOT NULL,
    "deliveryMode" TEXT NOT NULL DEFAULT 'individuals',
    "groupId" TEXT,
    "recipients" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT NOT NULL,
    "collectionId" TEXT,
    "weeklyResultId" TEXT,
    "revisionNumber" INTEGER,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "body" TEXT NOT NULL,
    "waMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedInboundEvent" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "handledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedInboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'done',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_coupleId_userId_key" ON "Membership"("coupleId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_coupleId_idx" ON "Invitation"("coupleId");

-- CreateIndex
CREATE INDEX "Collection_coupleId_idx" ON "Collection"("coupleId");

-- CreateIndex
CREATE INDEX "Entry_collectionId_idx" ON "Entry"("collectionId");

-- CreateIndex
CREATE INDEX "Entry_contributorId_idx" ON "Entry"("contributorId");

-- CreateIndex
CREATE INDEX "WeeklyPeriod_collectionId_idx" ON "WeeklyPeriod"("collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPeriod_collectionId_cycleIndex_weekIndex_key" ON "WeeklyPeriod"("collectionId", "cycleIndex", "weekIndex");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyResult_periodId_key" ON "WeeklyResult"("periodId");

-- CreateIndex
CREATE INDEX "WeeklyResult_collectionId_idx" ON "WeeklyResult"("collectionId");

-- CreateIndex
CREATE INDEX "ResultRevision_weeklyResultId_idx" ON "ResultRevision"("weeklyResultId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultRevision_weeklyResultId_revisionNumber_key" ON "ResultRevision"("weeklyResultId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSession_coupleId_key" ON "WhatsAppSession"("coupleId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConfig_coupleId_key" ON "WhatsAppConfig"("coupleId");

-- CreateIndex
CREATE INDEX "OutboundMessage_coupleId_idx" ON "OutboundMessage"("coupleId");

-- CreateIndex
CREATE INDEX "OutboundMessage_status_idx" ON "OutboundMessage"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedInboundEvent_eventKey_key" ON "ProcessedInboundEvent"("eventKey");

-- CreateIndex
CREATE INDEX "ProcessedInboundEvent_coupleId_idx" ON "ProcessedInboundEvent"("coupleId");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_jobKey_key" ON "JobRun"("jobKey");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPeriod" ADD CONSTRAINT "WeeklyPeriod_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyResult" ADD CONSTRAINT "WeeklyResult_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "WeeklyPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRevision" ADD CONSTRAINT "ResultRevision_weeklyResultId_fkey" FOREIGN KEY ("weeklyResultId") REFERENCES "WeeklyResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRevision" ADD CONSTRAINT "ResultRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultRevision" ADD CONSTRAINT "ResultRevision_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSession" ADD CONSTRAINT "WhatsAppSession_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppConfig" ADD CONSTRAINT "WhatsAppConfig_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedInboundEvent" ADD CONSTRAINT "ProcessedInboundEvent_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple"("id") ON DELETE CASCADE ON UPDATE CASCADE;
