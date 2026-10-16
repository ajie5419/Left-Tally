import type { ProductionAdapters } from './runtime-config.js';
import { BusinessException } from './business-error.js';

/** Personnel integration remains unavailable until its own local business source is implemented. */
export function createProductionAdapters(): ProductionAdapters {
  return {
    personnel: {
      productionLeads: () =>
        Promise.reject(
          new BusinessException('SOURCE_UNAVAILABLE', '人员信息尚未接入'),
        ),
    },
  };
}
