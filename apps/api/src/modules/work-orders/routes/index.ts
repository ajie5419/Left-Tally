import { Hono, type Context } from 'hono';
import { ok } from '@gc/contracts';
import { WorkOrderError } from '../application/ports.js';
import type { WorkOrderService } from '../application/service.js';
import {
  verifiedPrincipal,
  assertWriteOrigin,
  type SessionOptions,
} from '../../../session.js';

export interface WorkOrderRoutes extends SessionOptions {
  service: WorkOrderService;
}
async function jsonInput(context: Context): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new WorkOrderError('VALIDATION_FAILED', '请求内容无效，请重新填写');
  }
}
export function workOrderRoutes(options: WorkOrderRoutes) {
  const routes = new Hono();
  const timestamp = () => new Date(options.now()).toISOString();
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    assertWriteOrigin(options, c.req.raw);
    await next();
  });
  routes.get('/session', async (c) =>
    c.json(
      ok(
        {
          mode: options.mode,
          principal: await verifiedPrincipal(options, c),
          loginUrl: options.loginUrl,
        },
        timestamp(),
      ),
    ),
  );
  routes.get('/work-orders/sources', async (c) =>
    c.json(
      ok(
        await options.service.sources(await verifiedPrincipal(options, c)),
        timestamp(),
      ),
    ),
  );
  routes.get('/work-orders', async (c) =>
    c.json(
      ok(
        await options.service.list(await verifiedPrincipal(options, c)),
        timestamp(),
      ),
    ),
  );
  routes.post('/work-orders', async (c) =>
    c.json(
      ok(
        await options.service.create(
          await verifiedPrincipal(options, c),
          await jsonInput(c),
        ),
        timestamp(),
      ),
      201,
    ),
  );
  return routes;
}
