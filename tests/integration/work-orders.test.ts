import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createDemoApp,
  demoWorkOrders,
  demoLeads,
} from '../support/work-order-demo.js';
import { workOrderService } from '../../apps/api/src/modules/work-orders/application/service.js';
import { createWorkOrderDatabase } from '../../apps/api/src/modules/work-orders/infrastructure/repository.js';
import {
  workOrderSchema,
  successResponseSchema,
  sessionSchema,
} from '@gc/contracts';
import { createRuntimeApp } from '../../apps/api/src/runtime.js';

const url = process.env['GC_DATABASE_URL'];
if (!url) throw new Error('Task-owned database required');
const demo = createDemoApp(url);
const actor = {
  id: 'project-test',
  name: '项目部演示',
  permissions: ['work-orders:read', 'work-orders:create'],
} satisfies import('@gc/contracts').Principal;
beforeAll(async () => {
  await demo.database.client.workOrder.deleteMany();
});
afterAll(async () => {
  await demo.database.close();
});

it('persists independent local orders and refuses concurrent duplicate numbers', async () => {
  const service = workOrderService({
    repository: demo.database.repository,
    source: { productionLeads: () => Promise.resolve(demoLeads) },
    newId: randomUUID,
    now: () => new Date().toISOString(),
  });
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => service.create(actor, demoWorkOrders[0])),
  );
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  for (const result of results)
    if (result.status === 'rejected')
      expect(result.reason).toMatchObject({
        code: 'WORK_ORDER_NUMBER_EXISTS',
        status: 409,
      });
  await service.create(actor, demoWorkOrders[1]);
  const reconnected = createWorkOrderDatabase(url);
  try {
    const records = await reconnected.repository.list();
    expect(records).toHaveLength(2);
    for (const input of demoWorkOrders)
      expect(
        records.find((record) => record.number === input.number),
      ).toMatchObject(input);
  } finally {
    await reconnected.close();
  }
});
it('rolls back interrupted writes and enforces one equipment item in the database', async () => {
  const data = {
    id: randomUUID(),
    number: 'rollback-order',
    customer: '示例客户',
    quantity: 1,
    dueDate: new Date('2026-11-20T00:00:00Z'),
    productionLeadId: 'qms-lead-a',
    createdBy: actor.id,
  };
  await expect(
    demo.database.client.$transaction(async (transaction) => {
      await transaction.workOrder.create({ data });
      throw new Error('Interrupted operation');
    }),
  ).rejects.toThrow('Interrupted operation');
  expect(
    await demo.database.client.workOrder.count({
      where: { number: 'rollback-order' },
    }),
  ).toBe(0);
  await expect(
    demo.database.client.workOrder.create({ data: { ...data, quantity: 2 } }),
  ).rejects.toThrow();
});
it('checks identity, same-origin writes and strict input over HTTP', async () => {
  const origin = 'http://localhost';
  const post = (path: string, body: unknown, cookie?: string) =>
    demo.app.request(`${origin}/api${path}`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  expect((await post('/work-orders', demoWorkOrders[0])).status).toBe(403);
  const reader = await post('/demo/session', { identityId: 'demo-reader' });
  const cookie = reader.headers.get('set-cookie')?.split(';')[0];
  expect(cookie).toBeTruthy();
  expect(
    (
      await post(
        '/work-orders',
        {
          ...demoWorkOrders[0],
          permissions: ['work-orders:read', 'work-orders:create'],
        },
        cookie,
      )
    ).status,
  ).toBe(403);
  const listing = await demo.app.request(`${origin}/api/work-orders`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  expect(listing.status).toBe(200);
  expect(
    successResponseSchema(workOrderSchema.array()).parse(await listing.json())
      .data,
  ).toHaveLength(2);
  expect(
    (
      await demo.app.request(`${origin}/api/demo/session`, {
        method: 'POST',
        body: '{}',
        headers: {
          Origin: 'http://other.invalid',
          'Content-Type': 'application/json',
        },
      })
    ).status,
  ).toBe(403);
  const project = await post('/demo/session', { identityId: 'demo-project' });
  const projectCookie = project.headers.get('set-cookie')?.split(';')[0];
  expect(
    (
      await post(
        '/work-orders',
        { ...demoWorkOrders[0], createdBy: 'forged' },
        projectCookie,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await post(
        '/work-orders',
        {
          ...demoWorkOrders[0],
          number: 'FORGED-LEAD',
          productionLeadId: 'qms-lead-a',
        },
        projectCookie,
      )
    ).status,
  ).toBe(400);
});
it('uses the deployed composition with the same persistent business behavior', async () => {
  const runtime = createRuntimeApp(
    {
      databaseUrl: url,
      publicOrigin: 'https://gc.example.test',
    },
    {
      personnel: {
        productionLeads: () =>
          Promise.reject(new Error('Personnel unavailable')),
      },
    },
  );
  try {
    const response = await runtime.app.request('/api/session');
    expect(
      successResponseSchema(sessionSchema).parse(await response.json()).data
        .mode,
    ).toBe('production');
    expect((await runtime.app.request('/api/demo/identities')).status).toBe(
      404,
    );
    expect(
      (
        await runtime.app.request('/api/demo/session', {
          method: 'POST',
          headers: { Origin: 'https://gc.example.test' },
        })
      ).status,
    ).toBe(404);
    const created = await runtime.app.request('/api/work-orders', {
      method: 'POST',
      headers: {
        Origin: 'https://gc.example.test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...demoWorkOrders[0],
        number: 'PRODUCTION-COMPOSITION',
      }),
    });
    expect(created.status).toBe(403);
  } finally {
    await runtime.database.close();
  }
});
it('creates unassigned orders even when personnel are unavailable', async () => {
  const login = await demo.app.request('http://localhost/api/demo/session', {
    method: 'POST',
    headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: JSON.stringify({ identityId: 'demo-project' }),
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  const headers = cookie ? { Cookie: cookie } : {};
  demo.setSourceAvailable(false);
  try {
    expect(
      (await demo.app.request('http://localhost/api/work-orders', { headers }))
        .status,
    ).toBe(200);
    expect(
      (
        await demo.app.request('http://localhost/api/work-orders/sources', {
          headers,
        })
      ).status,
    ).toBe(503);
    expect(
      (
        await demo.app.request('http://localhost/api/work-orders', {
          method: 'POST',
          headers: {
            ...headers,
            Origin: 'http://localhost',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...demoWorkOrders[0], number: 'GD-03' }),
        })
      ).status,
    ).toBe(201);
    const created = await demo.database.client.workOrder.findUnique({
      where: { number: 'GD-03' },
    });
    expect(created?.productionLeadId).toBeNull();
  } finally {
    demo.setSourceAvailable(true);
  }
});
