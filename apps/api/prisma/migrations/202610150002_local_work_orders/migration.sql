CREATE TABLE `WorkOrder` (
    `id` VARCHAR(36) NOT NULL,
    `number` VARCHAR(128) NOT NULL,
    `customer` VARCHAR(200) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `dueDate` DATE NOT NULL,
    `project` VARCHAR(200) NULL,
    `division` VARCHAR(128) NULL,
    `productionLeadId` VARCHAR(128) NOT NULL,
    `createdBy` VARCHAR(128) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `WorkOrder_number_key` (`number`),
    PRIMARY KEY (`id`),
    CONSTRAINT `WorkOrder_quantity_one` CHECK (`quantity` = 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin ENGINE=InnoDB;
