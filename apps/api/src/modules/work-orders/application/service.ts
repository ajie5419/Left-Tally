import {
  createWorkOrderSchema,
  workOrderSourcesSchema,
  workOrderSchema,
} from '@gc/contracts';
import {
  WorkOrderError,
  type WorkOrderActor,
  type WorkOrderDependencies,
} from './ports.js';

function requireActor(
  actor: WorkOrderActor | null,
): asserts actor is WorkOrderActor {
  if (!actor) throw new WorkOrderError('FORBIDDEN', '请先登录');
}
export class WorkOrderService {
  constructor(private readonly deps: WorkOrderDependencies) {}
  async sources(actor: WorkOrderActor | null) {
    requireActor(actor);
    if (!actor.permissions.includes('work-orders:read'))
      throw new WorkOrderError('FORBIDDEN', '没有查看工单的权限');
    try {
      return workOrderSourcesSchema.parse({
        productionLeads: await this.deps.source.productionLeads(),
      });
    } catch {
      throw new WorkOrderError('SOURCE_UNAVAILABLE', '无法读取负责人，请重试');
    }
  }
  async list(actor: WorkOrderActor | null) {
    requireActor(actor);
    if (!actor.permissions.includes('work-orders:read'))
      throw new WorkOrderError('FORBIDDEN', '没有查看工单的权限');
    const records = await this.deps.repository.list();
    // Public DTOs deliberately exclude internal actor and persistence fields.
    return records.map((record) =>
      workOrderSchema.parse({
        id: record.id,
        number: record.number,
        customer: record.customer,
        quantity: record.quantity,
        dueDate: record.dueDate,
        project: record.project,
        division: record.division,
        productionLeadId: record.productionLeadId,
        createdAt: record.createdAt,
      }),
    );
  }
  async create(actor: WorkOrderActor | null, input: unknown) {
    requireActor(actor);
    if (!actor.permissions.includes('work-orders:create'))
      throw new WorkOrderError('FORBIDDEN', '只有项目部可以新建工单');
    const parsed = createWorkOrderSchema.safeParse(input);
    if (!parsed.success)
      throw new WorkOrderError(
        'VALIDATION_FAILED',
        '请检查必填项、字段长度、有效交期及数量（每张工单为 1 台）',
      );
    const record = {
      id: this.deps.newId(),
      ...parsed.data,
      productionLeadId: null,
      createdBy: actor.id,
      createdAt: this.deps.now(),
    };
    if (!(await this.deps.repository.insert(record)))
      throw new WorkOrderError(
        'WORK_ORDER_NUMBER_EXISTS',
        '工单号已存在，请使用不同工单号',
      );
    return { id: record.id };
  }
}
export function workOrderService(deps: WorkOrderDependencies) {
  return new WorkOrderService(deps);
}
