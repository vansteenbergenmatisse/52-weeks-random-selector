-- Re-key WhatsAppSession from couple-level to per-user. Existing session rows are
-- disposable (WHATSAPP_ENABLED ran the fixture adapter, so nothing was really
-- paired) and cannot be mapped to a user, so old rows are dropped. Each partner
-- re-links their own phone after this migration.

-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN "senderUserId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WhatsAppSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "coupleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "phone" TEXT,
    "lastQr" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppSession_coupleId_fkey" FOREIGN KEY ("coupleId") REFERENCES "Couple" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WhatsAppSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- (no data copied — old couple-keyed rows are discarded)
DROP TABLE "WhatsAppSession";
ALTER TABLE "new_WhatsAppSession" RENAME TO "WhatsAppSession";
CREATE UNIQUE INDEX "WhatsAppSession_userId_key" ON "WhatsAppSession"("userId");
CREATE INDEX "WhatsAppSession_coupleId_idx" ON "WhatsAppSession"("coupleId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
