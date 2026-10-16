-- Generated from the Prisma schema by `prisma migrate diff --from-empty --to-schema`.
-- Full migration-directory diff awaits an isolated MySQL shadow database.
CREATE TABLE `LocalAccount` (
    `id` CHAR(36) NOT NULL,
    `username` VARCHAR(64) NOT NULL,
    `usernameNormalized` VARCHAR(64) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `passwordHash` TEXT NOT NULL,
    `canRead` BOOLEAN NOT NULL DEFAULT false,
    `canCreate` BOOLEAN NOT NULL DEFAULT false,
    `accountAdmin` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `authVersion` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LocalAccount_usernameNormalized_key`(`usernameNormalized`),
    INDEX `LocalAccount_active_accountAdmin_idx`(`active`, `accountAdmin`),
    UNIQUE INDEX `LocalAccount_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `LocalSession` (
    `idHash` CHAR(64) NOT NULL,
    `accountId` CHAR(36) NOT NULL,
    `authVersion` INTEGER NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LocalSession_accountId_idx`(`accountId`),
    INDEX `LocalSession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`idHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `LocalSession` ADD CONSTRAINT `LocalSession_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `LocalAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
