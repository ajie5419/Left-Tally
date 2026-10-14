import { Hono } from 'hono';
import { healthSchema } from '@gc/contracts';

export const healthRoutes = new Hono().get('/health', (context) =>
  context.json(
    healthSchema.parse({
      status: 'ok',
      phase: 'BOOTSTRAP',
      businessReady: false,
    }),
  ),
);
