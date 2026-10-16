import { it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createWorkOrderSchema } from '@gc/contracts';
import { workOrderService } from '../../apps/api/src/modules/work-orders/application/service.js';
import {
  demoWorkOrders,
  demoLeads,
  demoIdentities,
} from '../support/work-order-demo.js';
import type { WorkOrderRecord } from '../../apps/api/src/modules/work-orders/application/ports.js';

function fixture() {
  const records: WorkOrderRecord[] = [];
  const leads = structuredClone(demoLeads);
  const service = workOrderService({
    source: { productionLeads: () => Promise.resolve(leads) },
    repository: {
      list: () => Promise.resolve(records),
      insert: (record) => {
        records.push(record);
        return Promise.resolve(true);
      },
    },
    newId: randomUUID,
    now: () => '2026-10-15T00:00:00.000Z',
  });
  return { records, leads, service };
}
it('normalizes optional text and rejects invalid field values without coercion', () => {
  const input = {
    ...demoWorkOrders[0],
    number: ' GD-01 ',
    project: '  ',
    division: undefined,
  };
  expect(createWorkOrderSchema.parse(input)).toMatchObject({
    number: 'GD-01',
    project: null,
    division: null,
  });
  for (const invalid of [
    { number: ' ' },
    { number: 'x'.repeat(129) },
    { customer: '' },
    { customer: 'x'.repeat(201) },
    { quantity: 0 },
    { quantity: 2 },
    { quantity: 1.1 },
    { quantity: '1' },
    { dueDate: '2026-02-30' },
    { dueDate: '0001-01-01' },
    { dueDate: '2026-11-20T00:00:00Z' },
    { division: 'x'.repeat(129) },
    { createdBy: 'forged' },
    { qmsWorkOrderId: 'external' },
    { productionLeadId: 'qms-lead-a' },
  ])
    expect(
      createWorkOrderSchema.safeParse({ ...demoWorkOrders[0], ...invalid })
        .success,
    ).toBe(false);
});
it('rejects unauthorized creation and allows creation before production assignment', async () => {
  const { service, records, leads } = fixture();
  const input = demoWorkOrders[0];
  await expect(service.create(null, input)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(
    service.create(demoIdentities[1] ?? null, input),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  for (const lead of leads) lead.active = false;
  expect(records).toEqual([]);
  await service.create(demoIdentities[0] ?? null, input);
  expect(records[0]?.productionLeadId).toBeNull();
});
it('creates local work orders and exposes only the public DTO', async () => {
  const { service, records } = fixture();
  await service.create(demoIdentities[0] ?? null, demoWorkOrders[0]);
  expect(records).toHaveLength(1);
  const list = await service.list(demoIdentities[1] ?? null);
  expect(list[0]).toMatchObject(demoWorkOrders[0] ?? {});
  expect(list[0]).not.toHaveProperty('createdBy');
});
