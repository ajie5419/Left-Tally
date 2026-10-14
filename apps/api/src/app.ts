import { Hono, type Context } from 'hono';
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

function extractExceptionHeaders(res: Response | undefined): Headers {
  const headers = new Headers();
  if (!res) {
    return headers;
  }
  for (const [key, value] of res.headers) {
    const lower = key.toLowerCase();
    if (lower === 'content-type' || lower === 'content-length') {
      continue;
    }
    if (lower === 'set-cookie') {
      headers.append(key, value);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

function handleHttpException(
  err: HTTPException,
  context: Context,
  now: string,
): Response {
  const status = err.status;
  const isServerError = status >= 500;
  if (isServerError) {
    const errorName = err.name.trim().length > 0 ? err.name : 'HTTPException';
    console.error(`[UNHANDLED_EXCEPTION] ${errorName}`);
  }
  const message = isServerError
    ? 'An unexpected internal error occurred'
    : err.message.trim().length > 0
      ? err.message
      : `HTTP request failed with status ${String(status)}`;
  const code = resolveHttpErrorCode(status);
  const responseHeaders = extractExceptionHeaders(err.res);
  return context.json(fail(code, message, undefined, now), {
    status,
    headers: responseHeaders,
  });
}

export function createServerApp(): Hono {
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
