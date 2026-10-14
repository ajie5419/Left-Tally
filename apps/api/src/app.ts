import { Hono } from 'hono';
import {
  healthOpenApi,
  fail,
  type BusinessErrorCodeType,
  type FailureResponse,
  type JsonValue,
} from '@gc/contracts';
import { healthRoutes } from './routes/health.js';

export type BusinessHttpStatus = 400 | 403 | 404 | 409;

export const BusinessErrorHttpStatusMap: Record<
  BusinessErrorCodeType,
  BusinessHttpStatus
> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONCURRENCY_CONFLICT: 409,
};

export class BusinessException extends Error {
  readonly code: BusinessErrorCodeType;
  readonly status: BusinessHttpStatus;
  readonly details?: JsonValue | undefined;

  constructor(
    code: BusinessErrorCodeType,
    message: string,
    details?: JsonValue,
    statusOverride?: BusinessHttpStatus,
  ) {
    const trimmed = message.trim();
    const resolvedMessage =
      trimmed.length > 0
        ? trimmed
        : `Business operation failed with code '${code}'`;
    super(resolvedMessage);
    this.name = 'BusinessException';
    this.code = code;
    this.status = statusOverride ?? BusinessErrorHttpStatusMap[code];
    this.details = details;
  }

  toResponse(timestamp: string): FailureResponse {
    return fail(this.code, this.message, this.details, timestamp);
  }
}

export function createServerApp(): Hono {
  return new Hono()
    .onError((err, context) => {
      const now = new Date().toISOString();
      if (err instanceof BusinessException) {
        try {
          return context.json(err.toResponse(now), err.status);
        } catch (handlerError) {
          console.error('[BUSINESS_EXCEPTION_RESPONSE_FALLBACK]', handlerError);
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
