-- Adicionar colunas ao modelo User
ALTER TABLE `User` 
ADD COLUMN `referralCode` VARCHAR(191) NULL UNIQUE,
ADD COLUMN `referredBy` VARCHAR(191) NULL,
ADD COLUMN `referralRewards` INT NOT NULL DEFAULT 0;

-- Criar tabela Subscription
CREATE TABLE `Subscription` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `planType` VARCHAR(191) NOT NULL,
  `billingPeriod` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `mpPreferenceId` VARCHAR(191) NULL,
  `mpSubscriptionId` VARCHAR(191) NULL,
  `currentPeriodEnd` DATETIME(3) NULL,
  `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT false,
  `referralCode` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Subscription_userId_key` (`userId`),
  INDEX `Subscription_userId_idx` (`userId`),
  INDEX `Subscription_status_idx` (`status`),
  INDEX `Subscription_mpSubscriptionId_idx` (`mpSubscriptionId`),
  CONSTRAINT `Subscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Criar tabela Payment
CREATE TABLE `Payment` (
  `id` VARCHAR(191) NOT NULL,
  `subscriptionId` VARCHAR(191) NOT NULL,
  `mpPaymentId` VARCHAR(191) NOT NULL,
  `mpPreferenceId` VARCHAR(191) NULL,
  `amount` DOUBLE NOT NULL,
  `currency` VARCHAR(191) NOT NULL DEFAULT 'BRL',
  `status` VARCHAR(191) NOT NULL,
  `paymentMethod` VARCHAR(191) NULL,
  `paymentType` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Payment_mpPaymentId_key` (`mpPaymentId`),
  INDEX `Payment_subscriptionId_idx` (`subscriptionId`),
  INDEX `Payment_mpPaymentId_idx` (`mpPaymentId`),
  INDEX `Payment_status_idx` (`status`),
  CONSTRAINT `Payment_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Criar tabela Referral
CREATE TABLE `Referral` (
  `id` VARCHAR(191) NOT NULL,
  `referrerId` VARCHAR(191) NOT NULL,
  `referredId` VARCHAR(191) NOT NULL,
  `referralCode` VARCHAR(191) NOT NULL,
  `rewardApplied` BOOLEAN NOT NULL DEFAULT false,
  `rewardAmount` DOUBLE NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Referral_referrerId_referredId_key` (`referrerId`, `referredId`),
  INDEX `Referral_referrerId_idx` (`referrerId`),
  INDEX `Referral_referredId_idx` (`referredId`),
  INDEX `Referral_referralCode_idx` (`referralCode`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


