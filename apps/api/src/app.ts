import { Hono } from 'hono';
import { healthOpenApi } from '@gc/contracts';
import { healthRoutes } from './routes/health.js';

export const app = new Hono()
  .route('/', healthRoutes)
  .get('/openapi.json', (context) => context.json(healthOpenApi));
