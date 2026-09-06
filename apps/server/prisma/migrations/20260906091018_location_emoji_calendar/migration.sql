-- AlterTable
ALTER TABLE "Entry" ADD COLUMN     "location" TEXT;

-- AlterTable
ALTER TABLE "ResultRevision" ADD COLUMN     "snapLocation" TEXT;

-- AlterTable
ALTER TABLE "WeeklyResult" ADD COLUMN     "calendarInvitedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CalendarConfig" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "emails" TEXT NOT NULL DEFAULT '[]',
    "durationMins" INTEGER NOT NULL DEFAULT 120,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConfig_coupleId_key" ON "CalendarConfig"("coupleId");

-- AddForeignKey
ALTER TABLE "CalendarConfig" ADD CONSTRAINT "CalendarConfig_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple"("id") ON DELETE CASCADE ON UPDATE CASCADE;
