import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  healthOpenApi,
  fail,
  type BusinessErrorCodeType,
  type FailureResponse,
  type JsonValue,
} from '@gc/contracts';
import { healthRoutes } from './routes/health.js';

export type BusinessHttpStatus = 400 | 403 | 404;

export const BusinessErrorHttpStatusMap: Readonly<
  Record<BusinessErrorCodeType, BusinessHttpStatus>
> = Object.freeze({
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
});

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
      if (err instanceof HTTPException) {
        if (err.res) {
          return err.getResponse();
        }
        const statusText = String(err.status);
        const message =
          err.message.trim().length > 0
            ? err.message
            : `HTTP request failed with status ${statusText}`;
        const code =
          err.status === 400
            ? 'VALIDATION_FAILED'
            : err.status === 403
              ? 'FORBIDDEN'
              : err.status === 404
                ? 'NOT_FOUND'
                : `HTTP_${statusText}`;
        return context.json(fail(code, message, undefined, now), err.status);
      }
      const errorName = err instanceof Error ? err.name : 'UnknownError';
      console.error(`[UNHANDLED_EXCEPTION] ${errorName}`);
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
export { HTTPException };
