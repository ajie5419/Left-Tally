import { Hono } from 'hono';
import type { SessionOptions } from '../../apps/api/src/session.js';
import { DemoSessions } from '../../apps/api/src/modules/work-orders/routes/demo-sessions.js';
import { demoLoginRoutes } from '../../apps/api/src/modules/work-orders/routes/demo-login.js';
import { randomUUID } from 'node:crypto';
import type { Principal, CreateWorkOrder, ProductionLead } from '@gc/contracts';
import { createServerApp } from '../../apps/api/src/app.js';
import { workOrderService } from '../../apps/api/src/modules/work-orders/application/service.js';
import { workOrderRoutes } from '../../apps/api/src/modules/work-orders/routes/index.js';
import { createWorkOrderDatabase } from '../../apps/api/src/modules/work-orders/infrastructure/repository.js';

export const demoIdentities: Principal[] = [
  {
    id: 'demo-project',
    name: '项目部演示账号',
    permissions: ['work-orders:read', 'work-orders:create'],
  },
  {
    id: 'demo-reader',
    name: '技术部只读演示账号',
    permissions: ['work-orders:read'],
  },
];
export const demoWorkOrders: CreateWorkOrder[] = [
  {
    number: 'GD-01',
    customer: '示例客户',
    project: '某桥梁设备合同',
    division: '示例事业部',
    quantity: 1,
    dueDate: '2026-11-20',
  },
  {
    number: 'GD-02',
    customer: '示例客户',
    project: '某桥梁设备合同',
    division: null,
    quantity: 1,
    dueDate: '2026-11-25',
  },
];
export const demoLeads: ProductionLead[] = [
  { id: 'qms-lead-a', name: '生产项目负责人甲（演示）', active: true },
  { id: 'qms-lead-b', name: '生产项目负责人乙（演示）', active: true },
];
export function createDemoApp(databaseUrl: string) {
  const database = createWorkOrderDatabase(databaseUrl);
  let sourceAvailable = true;
  const source = {
    productionLeads: () =>
      sourceAvailable
        ? Promise.resolve(structuredClone(demoLeads))
        : Promise.reject(new Error('Demo personnel unavailable')),
  };
  const service = workOrderService({
    repository: database.repository,
    source,
    newId: randomUUID,
    now: () => new Date().toISOString(),
  });
  const sessions = new DemoSessions(demoIdentities, Date.now);
  const options: SessionOptions = {
    mode: 'demo',
    loginUrl: null,
    now: Date.now,
    identity: {
      resolve: (request: Request) => {
        const cookie = request.headers
          .get('cookie')
          ?.split(';')
          .map((part) => part.trim())
          .find((part) => part.startsWith('gc_demo_session='))
          ?.slice('gc_demo_session='.length);
        return Promise.resolve(sessions.actor(cookie));
      },
    },
  };
  const routes = new Hono()
    .route('/', workOrderRoutes({ ...options, service }))
    .route('/', demoLoginRoutes(sessions, options));
  return {
    app: createServerApp(routes),
    database,
    setSourceAvailable: (available: boolean) => {
      sourceAvailable = available;
    },
  };
}
