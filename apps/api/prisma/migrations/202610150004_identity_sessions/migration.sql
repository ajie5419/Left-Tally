-- CreateTable
CREATE TABLE `IdentitySession` (
    `idHash` CHAR(64) NOT NULL,
    `credential` TEXT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `IdentitySession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`idHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

