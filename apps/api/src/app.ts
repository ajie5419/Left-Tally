import { Hono } from 'hono';
import { healthOpenApi, BusinessException, fail } from '@gc/contracts';
import { healthRoutes } from './routes/health.js';

export function createServerApp(): Hono {
  return new Hono()
    .onError((err, context) => {
      const now = new Date().toISOString();
      if (err instanceof BusinessException) {
        return context.json(err.toResponse(now), err.status);
      }
      console.error('[UNHANDLED_EXCEPTION]', err);
      return context.json(
        fail(
          'INTERNAL_SERVER_ERROR',
          'An unexpected internal error occurred',
          undefined,
          now,
        ),
        500,
      );
    })
    .route('/', healthRoutes)
    .get('/openapi.json', (context) => context.json(healthOpenApi));
}

export const app = createServerApp();
