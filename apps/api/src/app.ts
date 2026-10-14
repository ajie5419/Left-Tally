import { Hono } from 'hono';
import { healthOpenApi, BusinessException, fail } from '@gc/contracts';
import { healthRoutes } from './routes/health.js';

export const app = new Hono()
  .onError((err, context) => {
    if (err instanceof BusinessException) {
      return context.json(err.toResponse(), err.status);
    }
    return context.json(
      fail(
        'INTERNAL_SERVER_ERROR',
        err instanceof Error ? err.message : 'Unknown error',
      ),
      500,
    );
  })
  .route('/', healthRoutes)
  .get('/openapi.json', (context) => context.json(healthOpenApi));
