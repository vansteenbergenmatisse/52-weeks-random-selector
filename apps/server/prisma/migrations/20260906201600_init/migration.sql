-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Couple" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coupleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coupleId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "usedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invitation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "cycleStartDate" DATETIME,
    "cycleIndex" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Collection_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "contributorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "emoji" TEXT,
    "location" TEXT,
    "cost" TEXT,
    "prep" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "tmdbId" INTEGER,
    "imdbId" TEXT,
    "posterPath" TEXT,
    "backdropPath" TEXT,
    "releaseYear" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Entry_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Entry_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklyPeriod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "cycleIndex" INTEGER NOT NULL,
    "weekIndex" INTEGER NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyPeriod_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklyResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "currentRevisionNumber" INTEGER NOT NULL DEFAULT 1,
    "completedAt" DATETIME,
    "calendarInvitedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WeeklyResult_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "WeeklyPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResultRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "snapLocation" TEXT,
    "snapImdbId" TEXT,
    "rejectedEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResultRevision_weeklyResultId_fkey" FOREIGN KEY ("weeklyResultId") REFERENCES "WeeklyResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResultRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ResultRevision_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coupleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "phone" TEXT,
    "lastQr" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppSession_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coupleId" TEXT NOT NULL,
    "deliveryMode" TEXT NOT NULL DEFAULT 'individuals',
    "groupId" TEXT,
    "recipients" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppConfig_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CalendarConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coupleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "emails" TEXT NOT NULL DEFAULT '[]',
    "durationMins" INTEGER NOT NULL DEFAULT 120,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CalendarConfig_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coupleId" TEXT NOT NULL,
    "collectionId" TEXT,
    "weeklyResultId" TEXT,
    "revisionNumber" INTEGER,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "chatId" TEXT,
    "body" TEXT NOT NULL,
    "waMessageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "OutboundMessage_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutboundMessage_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessedInboundEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coupleId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "handledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessedInboundEvent_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'done',
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
CREATE UNIQUE INDEX "CalendarConfig_coupleId_key" ON "CalendarConfig"("coupleId");

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
