CREATE TABLE `WorkOrderLink` (
  `id` VARCHAR(36) NOT NULL,
  `qmsWorkOrderId` VARCHAR(128) NOT NULL,
  `productionLeadId` VARCHAR(128) NOT NULL,
  `createdBy` VARCHAR(128) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `WorkOrderLink_qmsWorkOrderId_key` (`qmsWorkOrderId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin ENGINE=InnoDB;
