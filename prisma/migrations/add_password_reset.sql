-- CreateTable: PasswordReset
-- Sistema de recuperação de senha com código de 6 dígitos

CREATE TABLE IF NOT EXISTS `PasswordReset` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL COMMENT 'Código de 6 dígitos',
    `expiresAt` DATETIME(3) NOT NULL COMMENT 'Data de expiração (15 minutos após criação)',
    `used` BOOLEAN NOT NULL DEFAULT false COMMENT 'Se o código já foi usado',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PasswordReset_userId_idx`(`userId`),
    INDEX `PasswordReset_code_idx`(`code`),
    INDEX `PasswordReset_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PasswordReset` ADD CONSTRAINT `PasswordReset_userId_fkey` 
    FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
