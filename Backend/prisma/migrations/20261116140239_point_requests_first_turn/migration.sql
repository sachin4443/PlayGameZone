-- CreateEnum
CREATE TYPE "PointRequestType" AS ENUM ('ADD', 'WITHDRAW');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TxType" ADD VALUE 'POINTS_REQUEST';
ALTER TYPE "TxType" ADD VALUE 'WITHDRAW_HOLD';
ALTER TYPE "TxType" ADD VALUE 'WITHDRAW';
ALTER TYPE "TxType" ADD VALUE 'WITHDRAW_RELEASE';

-- AlterTable
ALTER TABLE "GameRoom" ADD COLUMN     "firstTurnSetBy" TEXT,
ADD COLUMN     "firstTurnUserId" TEXT;

-- CreateTable
CREATE TABLE "PointRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PointRequestType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "adminRemark" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PointRequest_status_createdAt_idx" ON "PointRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PointRequest_userId_createdAt_idx" ON "PointRequest"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "PointRequest" ADD CONSTRAINT "PointRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PointRequest" ADD CONSTRAINT "PointRequest_amount_positive" CHECK ("amount" > 0);
-- At most one open request of each kind per player.
CREATE UNIQUE INDEX "PointRequest_one_pending_per_type" ON "PointRequest" ("userId", "type") WHERE "status" = 'PENDING';
