import type { Principal, ProductionLead, WorkOrder } from '@gc/contracts';

export interface WorkOrderRecord extends WorkOrder {
  createdBy: string;
}
export interface WorkOrderRepository {
  list(): Promise<WorkOrderRecord[]>;
  insert(record: WorkOrderRecord): Promise<boolean>;
}
export interface WorkOrderSource {
  productionLeads(): Promise<ProductionLead[]>;
}
export interface WorkOrderDependencies {
  repository: WorkOrderRepository;
  source: WorkOrderSource;
  newId(): string;
  now(): string;
}
export type WorkOrderActor = Principal;
export { BusinessException as WorkOrderError } from '../../../business-error.js';
