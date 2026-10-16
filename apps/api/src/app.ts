import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { healthOpenApi, fail } from '@gc/contracts';
import { healthRoutes } from './routes/health.js';
import { BusinessException } from './business-error.js';
import { businessOpenApi } from './openapi.js';
export {
  BusinessException,
  BusinessErrorHttpStatusMap,
  type BusinessHttpStatus,
} from './business-error.js';

function handleBusinessException(
  err: BusinessException,
  context: Context,
  now: string,
): Response {
  try {
    return context.json(err.toResponse(now), err.status);
  } catch (handlerError) {
    const fallbackErrorName =
      handlerError instanceof Error ? handlerError.name : 'UnknownError';
    console.error(
      `[BUSINESS_EXCEPTION_RESPONSE_FALLBACK] ${fallbackErrorName}`,
    );
    return context.json(
      fail(
        err.code,
        `Business operation failed with code '${err.code}'`,
        undefined,
        now,
      ),
      err.status,
    );
  }
}

function resolveHttpErrorCode(status: number): string {
  if (status === 400) {
    return 'VALIDATION_FAILED';
  }
  if (status === 403) {
    return 'FORBIDDEN';
  }
  if (status === 404) {
    return 'NOT_FOUND';
  }
  return status >= 500 ? 'INTERNAL_SERVER_ERROR' : `HTTP_${String(status)}`;
}

function handleHttpException(
  err: HTTPException,
  context: Context,
  now: string,
): Response {
  if (err.res) {
    const response = err.getResponse();
    /**
     * getResponse() does not include Context headers. Use Hono's response
     * factory without rewriting the body or maintaining protocol header lists.
     * Explicit responses are public output, including intentional 5xx bodies.
     */
    return context.newResponse(response.body, response);
  }
  const status = err.status;
  const isServerError = status >= 500;
  if (isServerError) {
    console.error('[UNHANDLED_EXCEPTION] HTTPException');
  }
  const message = isServerError
    ? 'An unexpected internal error occurred'
    : err.message.trim().length > 0
      ? err.message
      : `HTTP request failed with status ${String(status)}`;
  const code = resolveHttpErrorCode(status);
  return context.json(fail(code, message, undefined, now), status);
}

export function createServerApp(businessRoutes?: Hono): Hono {
  return new Hono()
    .notFound((context) => {
      const now = new Date().toISOString();
      return context.json(
        fail('NOT_FOUND', 'Route not found', undefined, now),
        404,
      );
    })
    .onError((err, context) => {
      const now = new Date().toISOString();
      if (err instanceof BusinessException) {
        return handleBusinessException(err, context, now);
      }
      if (err instanceof HTTPException) {
        return handleHttpException(err, context, now);
      }
      console.error('[UNHANDLED_EXCEPTION] Error');
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
    .route('/api', businessRoutes ?? new Hono())
    .get('/openapi.json', (context) =>
      context.json(businessRoutes ? businessOpenApi : healthOpenApi),
    );
}

export const app = createServerApp();
export { HTTPException };
