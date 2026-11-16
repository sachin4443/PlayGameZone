-- CreateEnum
CREATE TYPE "AccountRequestType" AS ENUM ('MOBILE_CHANGE', 'ACCOUNT_DELETE');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "RoleName" ADD VALUE 'ROOT_OWNER';

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "fixedPrize" INTEGER,
ADD COLUMN     "isPractice" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prizePoolId" TEXT;

-- AlterTable
ALTER TABLE "GameRoom" ADD COLUMN     "prizePoolId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "failedPinAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isBot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "permsCustomized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinHash" TEXT,
ADD COLUMN     "pinLockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StaffPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "actions" TEXT[],

    CONSTRAINT "StaffPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AccountRequestType" NOT NULL,
    "newMobile" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "adminRemark" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrizePool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modeId" INTEGER NOT NULL,
    "players" INTEGER NOT NULL,
    "entryPoints" INTEGER NOT NULL,
    "prizePoints" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrizePool_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffPermission_userId_module_key" ON "StaffPermission"("userId", "module");

-- CreateIndex
CREATE INDEX "AccountRequest_status_createdAt_idx" ON "AccountRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AccountRequest_userId_idx" ON "AccountRequest"("userId");

-- CreateIndex
CREATE INDEX "PrizePool_isActive_sortOrder_idx" ON "PrizePool"("isActive", "sortOrder");

-- AddForeignKey
ALTER TABLE "StaffPermission" ADD CONSTRAINT "StaffPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountRequest" ADD CONSTRAINT "AccountRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizePool" ADD CONSTRAINT "PrizePool_modeId_fkey" FOREIGN KEY ("modeId") REFERENCES "GameMode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRoom" ADD CONSTRAINT "GameRoom_prizePoolId_fkey" FOREIGN KEY ("prizePoolId") REFERENCES "PrizePool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_prizePoolId_fkey" FOREIGN KEY ("prizePoolId") REFERENCES "PrizePool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PrizePool" ADD CONSTRAINT "PrizePool_players" CHECK ("players" BETWEEN 2 AND 4);
ALTER TABLE "PrizePool" ADD CONSTRAINT "PrizePool_prize_within_pool" CHECK ("prizePoints" >= 0 AND "prizePoints" <= "entryPoints" * "players");
-- A mobile number can have at most one pending change request pointing at it.
CREATE UNIQUE INDEX "AccountRequest_pending_newMobile" ON "AccountRequest" ("newMobile") WHERE "status" = 'PENDING' AND "newMobile" IS NOT NULL;
