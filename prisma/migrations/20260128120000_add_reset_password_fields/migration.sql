-- AlterTable
ALTER TABLE `User` ADD COLUMN `resetCode` VARCHAR(191) NULL,
    ADD COLUMN `resetCodeExpiresAt` DATETIME(3) NULL;
