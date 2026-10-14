import { Hono } from 'hono';
import { healthSchema } from '@gc/contracts';

export const healthRoutes = new Hono()
  .get('/health', (context) =>
    context.json(
      healthSchema.parse({
        status: 'ok',
        phase: 'BOOTSTRAP',
        businessReady: false,
      }),
    ),
  )
  .get('/test-error', () => {
    throw new Error(
      'Database connection to mysql://root:secret_pass@127.0.0.1:3306/prod failed',
    );
  });
