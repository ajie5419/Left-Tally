-- Project staff create orders before the production department assigns responsibility.
ALTER TABLE `WorkOrder` MODIFY `productionLeadId` VARCHAR(128) NULL;
