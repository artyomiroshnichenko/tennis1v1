-- AlterTable
ALTER TABLE "MatchPlayer" ADD COLUMN "guestNickname" TEXT;

-- AlterTable
ALTER TABLE "MatchPlayer" ALTER COLUMN "userId" DROP NOT NULL;
