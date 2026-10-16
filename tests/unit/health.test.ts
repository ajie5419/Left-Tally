import { describe, expect, it, vi } from 'vitest';
import { secureHeaders } from 'hono/secure-headers';
import {
  app,
  createServerApp,
  BusinessException,
  BusinessErrorHttpStatusMap,
  HTTPException,
} from '../../apps/api/src/app';
import {
  healthSchema,
  healthOpenApi,
  successResponseSchema,
  failureResponseSchema,
  ok,
  fail,
  BusinessErrorCode,
  z,
} from '@gc/contracts';

describe('public bootstrap contract', () => {
  it('returns only validated liveness without claiming business readiness', async () => {
    const response = await app.request('/health');
    const body: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(healthSchema.parse(body)).toEqual({
      status: 'ok',
      phase: 'BOOTSTRAP',
      businessReady: false,
    });
  });

  it('rejects invented readiness and extra identity fields', () => {
    expect(
      healthSchema.safeParse({
        status: 'ok',
        phase: 'CORE',
        businessReady: true,
      }).success,
    ).toBe(false);
    expect(
      healthSchema.safeParse({
        status: 'ok',
        phase: 'BOOTSTRAP',
        businessReady: false,
        role: 'admin',
      }).success,
    ).toBe(false);
  });

  it('publishes the actual contract and does not invent business routes', async () => {
    const response = await app.request('/openapi.json');
    const body: unknown = await response.json();
    expect(body).toEqual(healthOpenApi);
    const missing = await app.request('/work-orders');
    expect(missing.status).toBe(404);
    expect(failureResponseSchema.parse(await missing.json())).toMatchObject({
      success: false,
      code: 'NOT_FOUND',
      message: 'Route not found',
    });
    expect((await app.request('/health', { method: 'POST' })).status).toBe(404);
  });
});

describe('successResponseSchema', () => {
  const validIso = '2026-10-14T10:00:00.000Z';

  it('parses valid data matching schema and explicit ISO timestamp', () => {
    const schema = successResponseSchema(
      z.object({ id: z.number(), name: z.string() }),
    );
    const input = {
      success: true,
      data: { id: 1, name: 'item' },
      timestamp: validIso,
    };
    const parsed = schema.parse(input);
    expect(parsed).toEqual(input);
  });

  it('strips undeclared data fields while strict schema rejects them', () => {
    const looseDataSchema = z.object({ id: z.number() });
    const looseResponseSchema = successResponseSchema(looseDataSchema);
    const parsed = looseResponseSchema.parse({
      success: true,
      data: { id: 42, extra: 'dropped' },
      timestamp: validIso,
    });
    expect(parsed.data).toEqual({ id: 42 });

    const strictDataSchema = z.object({ id: z.number() }).strict();
    const strictResponseSchema = successResponseSchema(strictDataSchema);
    expect(
      strictResponseSchema.safeParse({
        success: true,
        data: { id: 42, extra: 'forbidden' },
        timestamp: validIso,
      }).success,
    ).toBe(false);
  });

  it('rejects non-true success, mismatched data types, and invalid timestamps', () => {
    const schema = successResponseSchema(z.string());
    expect(
      schema.safeParse({
        success: false,
        data: 'test',
        timestamp: validIso,
      }).success,
    ).toBe(false);

    expect(
      schema.safeParse({
        success: true,
        data: 12345,
        timestamp: validIso,
      }).success,
    ).toBe(false);

    expect(
      schema.safeParse({
        success: true,
        data: 'test',
        timestamp: 'invalid-datetime',
      }).success,
    ).toBe(false);

    expect(
      successResponseSchema(z.any()).safeParse({
        success: true,
        data: 10n,
        timestamp: validIso,
      }).success,
    ).toBe(false);

    expect(
      successResponseSchema(z.any()).safeParse({
        success: true,
        data: Number.NaN,
        timestamp: validIso,
      }).success,
    ).toBe(false);
  });
});

describe('failureResponseSchema', () => {
  const validIso = '2026-10-14T10:00:00.000Z';

  it('parses valid failure response and verifies optional details', () => {
    const parsedWithDetails = failureResponseSchema.parse({
      success: false,
      code: 'VALIDATION_FAILED',
      message: 'Invalid request body',
      details: { reason: 'empty' },
      timestamp: validIso,
    });
    expect(parsedWithDetails).toEqual({
      success: false,
      code: 'VALIDATION_FAILED',
      message: 'Invalid request body',
      details: { reason: 'empty' },
      timestamp: validIso,
    });

    const parsedWithoutDetails = failureResponseSchema.parse({
      success: false,
      code: 'NOT_FOUND',
      message: 'Resource not found',
      timestamp: validIso,
    });
    expect(parsedWithoutDetails.details).toBeUndefined();
  });

  it('rejects non-false success, empty code, empty message, and invalid timestamps', () => {
    expect(
      failureResponseSchema.safeParse({
        success: true,
        code: 'ERR',
        message: 'msg',
        timestamp: validIso,
      }).success,
    ).toBe(false);

    expect(
      failureResponseSchema.safeParse({
        success: false,
        code: '',
        message: 'msg',
        timestamp: validIso,
      }).success,
    ).toBe(false);

    expect(
      failureResponseSchema.safeParse({
        success: false,
        code: 'ERR',
        message: '',
        timestamp: validIso,
      }).success,
    ).toBe(false);

    expect(
      failureResponseSchema.safeParse({
        success: false,
        code: 'ERR',
        message: 'msg',
        timestamp: '2026-99-99',
      }).success,
    ).toBe(false);
  });

  it('enforces details to strictly conform to jsonValueSchema', () => {
    expect(
      failureResponseSchema.safeParse({
        success: false,
        code: 'ERR',
        message: 'msg',
        details: { num: Number.NaN },
        timestamp: validIso,
      }).success,
    ).toBe(false);

    expect(
      failureResponseSchema.safeParse({
        success: false,
        code: 'ERR',
        message: 'msg',
        details: { inf: Infinity },
        timestamp: validIso,
      }).success,
    ).toBe(false);
  });
});

describe('ok and fail helper functions', () => {
  const validIso = '2026-10-14T10:00:00.000Z';

  it('ok builds valid SuccessResponse and enforces ISO timestamp and JSON validation', () => {
    const res = ok({ id: 101, title: 'Item' }, validIso);
    expect(res).toEqual({
      success: true,
      data: { id: 101, title: 'Item' },
      timestamp: validIso,
    });

    expect(() => ok({ id: 1 }, 'not-an-iso-string')).toThrowError(
      /timestamp must be an ISO datetime string/,
    );
    expect(() => ok(10n, validIso)).toThrow();
    expect(() => ok(Number.NaN, validIso)).toThrow();
  });

  it('fail builds valid FailureResponse and validates code, message, details, and timestamp', () => {
    const failure = fail(
      BusinessErrorCode.VALIDATION_FAILED,
      'Invalid input parameter',
      { field: 'status' },
      validIso,
    );
    expect(failure).toEqual({
      success: false,
      code: 'VALIDATION_FAILED',
      message: 'Invalid input parameter',
      details: { field: 'status' },
      timestamp: validIso,
    });
  });
});

describe('global error handling and HTTP status mapping', () => {
  it('maps BusinessException to corresponding HTTP status and failure structure', async () => {
    const testApp = createServerApp().get('/test-biz-error', () => {
      throw new BusinessException(
        BusinessErrorCode.VALIDATION_FAILED,
        'Field validation failed',
        { reason: 'missing' },
      );
    });

    const response = await testApp.request('/test-biz-error');
    expect(response.status).toBe(400);

    const body: unknown = await response.json();
    const parsed = failureResponseSchema.parse(body);
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('VALIDATION_FAILED');
    expect(parsed.message).toBe('Field validation failed');
    expect(parsed.details).toEqual({ reason: 'missing' });
  });

  it('preserves Hono HTTPException statuses in the error handler', async () => {
    const testApp = createServerApp()
      .get('/test-http-error-401', () => {
        throw new HTTPException(401, {
          res: new Response('Unauthorized', {
            headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
          }),
        });
      })
      .get('/test-http-error-408', () => {
        throw new HTTPException(408, { message: 'Request timed out' });
      });

    const res401 = await testApp.request('/test-http-error-401');
    expect(res401.status).toBe(401);
    expect(res401.headers.get('www-authenticate')).toBe(
      'Bearer error="invalid_token"',
    );
    expect(res401.headers.get('content-type')).toContain('text/plain');
    expect(await res401.text()).toBe('Unauthorized');

    const res408 = await testApp.request('/test-http-error-408');
    expect(res408.status).toBe(408);
    const body408 = failureResponseSchema.parse(await res408.json());
    expect(body408.code).toBe('HTTP_408');
    expect(body408.message).toBe('Request timed out');
  });

  it('preserves the native body, protocol, security and representation headers with context cookies', async () => {
    const testApp = createServerApp().get('/test-protocol-headers', (c) => {
      c.header('Set-Cookie', 'session=active; Path=/');
      const errorResponse = new Response('Method Not Allowed', {
        status: 405,
        headers: [
          ['Allow', 'GET, HEAD'],
          ['Proxy-Authenticate', 'Basic realm="test"'],
          ['Content-Security-Policy', "default-src 'self'"],
          ['Content-Security-Policy-Report-Only', "default-src 'none'"],
          ['Set-Cookie', 'csrf_token=abc; SameSite=Strict'],
          ['Set-Cookie', 'warning=rejected; Path=/'],
          ['Content-Type', 'text/html'],
          ['Content-Length', '18'],
          ['Content-Disposition', 'attachment; filename="error.txt"'],
          ['ETag', 'W/"error-entity-tag"'],
          ['Last-Modified', 'Wed, 14 Oct 2026 10:00:00 GMT'],
          ['Digest', 'sha-256=error-digest'],
          ['Content-Digest', 'sha-256=:error-content-digest:'],
        ],
      });
      throw new HTTPException(405, { res: errorResponse });
    });

    const res = await testApp.request('/test-protocol-headers');
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
    expect(res.headers.get('proxy-authenticate')).toBe('Basic realm="test"');
    expect(res.headers.get('content-security-policy')).toBe(
      "default-src 'self'",
    );
    expect(res.headers.get('content-security-policy-report-only')).toBe(
      "default-src 'none'",
    );
    expect(res.headers.get('content-type')).toBe('text/html');
    expect(res.headers.get('content-length')).toBe('18');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="error.txt"',
    );
    expect(res.headers.get('etag')).toBe('W/"error-entity-tag"');
    expect(res.headers.get('last-modified')).toBe(
      'Wed, 14 Oct 2026 10:00:00 GMT',
    );
    expect(res.headers.get('digest')).toBe('sha-256=error-digest');
    expect(res.headers.get('content-digest')).toBe(
      'sha-256=:error-content-digest:',
    );
    expect(await res.text()).toBe('Method Not Allowed');
    const cookies = res.headers.getSetCookie();
    expect(cookies).toEqual([
      'session=active; Path=/',
      'csrf_token=abc; SameSite=Strict',
      'warning=rejected; Path=/',
    ]);
  });

  it('preserves custom Content-Range and bodies without making status-specific header rules', async () => {
    const testApp = createServerApp()
      .get('/test-range-416', () => {
        const res416 = new Response('Range Not Satisfiable', {
          status: 416,
          headers: [['Content-Range', 'bytes */5000']],
        });
        throw new HTTPException(416, { res: res416 });
      })
      .get('/test-range-400', () => {
        const res400 = new Response('Bad Request', {
          status: 400,
          headers: [['Content-Range', 'bytes 0-10/5000']],
        });
        throw new HTTPException(400, { res: res400 });
      });

    const res416 = await testApp.request('/test-range-416');
    expect(res416.status).toBe(416);
    expect(res416.headers.get('content-range')).toBe('bytes */5000');
    expect(await res416.text()).toBe('Range Not Satisfiable');

    const res400 = await testApp.request('/test-range-400');
    expect(res400.status).toBe(400);
    expect(res400.headers.get('content-range')).toBe('bytes 0-10/5000');
    expect(await res400.text()).toBe('Bad Request');
  });

  it('masks 5xx server exceptions and keeps database and credential details confidential', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const testApp = createServerApp().get('/test-secret-leak', () => {
      const error = new Error(
        'Prisma connection error to mysql://user:synthetic-secret@invalid/db',
      );
      error.name = 'mysql://synthetic-secret';
      throw error;
    });

    const response = await testApp.request('/test-secret-leak');
    expect(response.status).toBe(500);

    const parsed = failureResponseSchema.parse(await response.json());
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('INTERNAL_SERVER_ERROR');
    expect(parsed.message).toBe('An unexpected internal error occurred');
    expect(JSON.stringify(parsed)).not.toContain('mysql://');
    expect(JSON.stringify(parsed)).not.toContain('secret');
    expect(log).toHaveBeenCalledExactlyOnceWith('[UNHANDLED_EXCEPTION] Error');
    log.mockRestore();
  });

  it.each([
    { code: BusinessErrorCode.FORBIDDEN, status: 403 },
    { code: BusinessErrorCode.NOT_FOUND, status: 404 },
  ])('keeps the business JSON contract for $code', async ({ code, status }) => {
    const testApp = createServerApp().get('/test-business', () => {
      throw new BusinessException(code, 'Public business reason');
    });
    const response = await testApp.request('/test-business');
    expect(response.status).toBe(status);
    expect(failureResponseSchema.parse(await response.json())).toMatchObject({
      success: false,
      code,
      message: 'Public business reason',
    });
  });

  it('masks HTTPException 5xx messages without an explicit public Response', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const testApp = createServerApp().get('/test-http-internal', () => {
      const error = new HTTPException(503, {
        message: 'mysql://synthetic-secret',
      });
      error.name = 'mysql://synthetic-secret';
      throw error;
    });
    const response = await testApp.request('/test-http-internal');
    expect(response.status).toBe(503);
    expect(failureResponseSchema.parse(await response.json())).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred',
    });
    expect(log).toHaveBeenCalledExactlyOnceWith(
      '[UNHANDLED_EXCEPTION] HTTPException',
    );
    log.mockRestore();
  });

  it('keeps intentional public 5xx binary responses and uses the exception status', async () => {
    const testApp = createServerApp().get('/test-native-binary', () => {
      throw new HTTPException(503, {
        res: new Response(new Uint8Array([0, 255, 128, 10]), {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Retry-After': '60',
            'X-Public-Reason': 'maintenance',
          },
        }),
      });
    });
    const response = await testApp.request('/test-native-binary');
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toBe(
      'application/octet-stream',
    );
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('x-public-reason')).toBe('maintenance');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0, 255, 128, 10]),
    );
  });

  it.each([400, 403, 404])(
    'keeps the existing JSON mapping for HTTP %s without a custom Response',
    async (status) => {
      const testApp = createServerApp().get('/test-http-json', () => {
        if (status === 403) throw new HTTPException(403);
        if (status === 404) throw new HTTPException(404);
        throw new HTTPException(400);
      });
      const response = await testApp.request('/test-http-json');
      expect(response.status).toBe(status);
      expect(failureResponseSchema.parse(await response.json())).toMatchObject({
        code:
          status === 400
            ? 'VALIDATION_FAILED'
            : status === 403
              ? 'FORBIDDEN'
              : 'NOT_FOUND',
        message: `HTTP request failed with status ${String(status)}`,
      });
    },
  );

  it('falls back safely when business details are invalid at runtime', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const testApp = createServerApp().get('/test-invalid-business', () => {
      throw new BusinessException('VALIDATION_FAILED', 'Public reason', {
        invalid: Number.NaN,
        sensitive: 'synthetic-secret',
      });
    });
    const response = await testApp.request('/test-invalid-business');
    expect(response.status).toBe(400);
    const body = failureResponseSchema.parse(await response.json());
    expect(body).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: "Business operation failed with code 'VALIDATION_FAILED'",
    });
    expect(body).not.toHaveProperty('details');
    expect(JSON.stringify(body)).not.toContain('sensitive');
    expect(log).toHaveBeenCalledExactlyOnceWith(
      '[BUSINESS_EXCEPTION_RESPONSE_FALLBACK] ZodError',
    );
    log.mockRestore();
  });

  it('records pinned Hono cookie precedence when middleware materializes c.res before an error', async () => {
    const testApp = createServerApp()
      .use('/test-materialized', async (context, next) => {
        context.header('Set-Cookie', 'context=one; Path=/');
        context.res.headers.set('X-Materialized', 'yes');
        await next();
      })
      .get('/test-materialized', () => {
        throw new HTTPException(416, {
          res: new Response('Native body', {
            headers: [
              ['Set-Cookie', 'native=two; Path=/'],
              ['Content-Range', 'bytes */5000'],
            ],
          }),
        });
      });
    const response = await testApp.request('/test-materialized');
    expect(response.status).toBe(416);
    expect(response.headers.get('x-materialized')).toBe('yes');
    expect(response.headers.get('content-range')).toBe('bytes */5000');
    expect(await response.text()).toBe('Native body');
    expect(response.headers.getSetCookie()).toEqual(['context=one; Path=/']);
  });

  it.each(['native', 'business', 'unknown'])(
    'runs security middleware after %s errors and preserves prepared headers and cookies',
    async (kind) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      const testApp = createServerApp()
        .use(
          '/test-middleware',
          secureHeaders({ contentSecurityPolicy: { defaultSrc: ["'none'"] } }),
        )
        .use('/test-middleware', async (context, next) => {
          context.header('X-Request-Id', 'request-123');
          context.header('Set-Cookie', 'before=one; Path=/', { append: true });
          context.header('Set-Cookie', 'before=two; Path=/', { append: true });
          await next();
          context.header('X-After-Error', 'executed');
          context.header('Set-Cookie', 'after=three; Path=/', { append: true });
        })
        .get('/test-middleware', () => {
          if (kind === 'business') {
            throw new BusinessException('FORBIDDEN', 'Public reason');
          }
          if (kind === 'unknown') {
            throw new Error('synthetic-secret');
          }
          throw new HTTPException(416, {
            res: new Response('Native range response', {
              headers: [
                ['Content-Range', 'bytes */5000'],
                ['Set-Cookie', 'native=four; Path=/'],
                ['Set-Cookie', 'native=five; Path=/'],
                ['Content-Security-Policy', "default-src 'self'"],
                ['X-Content-Type-Options', 'unsafe-test-value'],
              ],
            }),
          });
        });
      const response = await testApp.request('/test-middleware');
      expect(response.status).toBe(
        kind === 'native' ? 416 : kind === 'business' ? 403 : 500,
      );
      expect(response.headers.get('x-request-id')).toBe('request-123');
      expect(response.headers.get('x-after-error')).toBe('executed');
      expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'none'",
      );
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.getSetCookie()).toEqual([
        'before=one; Path=/',
        'before=two; Path=/',
        ...(kind === 'native'
          ? ['native=four; Path=/', 'native=five; Path=/']
          : []),
        'after=three; Path=/',
      ]);
      if (kind === 'native') {
        expect(response.headers.get('content-range')).toBe('bytes */5000');
        expect(await response.text()).toBe('Native range response');
      } else {
        expect(
          failureResponseSchema.safeParse(await response.json()).success,
        ).toBe(true);
      }
      log.mockRestore();
    },
  );
});

describe('BusinessErrorCode enum and status mapping', () => {
  it('strictly defines and freezes error codes and status mapping', () => {
    expect(Object.keys(BusinessErrorCode).sort()).toEqual([
      'ACCOUNT_LAST_ADMIN',
      'ACCOUNT_USERNAME_EXISTS',
      'FORBIDDEN',
      'INVALID_CREDENTIALS',
      'NOT_FOUND',
      'SOURCE_UNAVAILABLE',
      'VALIDATION_FAILED',
      'WORK_ORDER_NUMBER_EXISTS',
    ]);
    expect(BusinessErrorCode.FORBIDDEN).toBe('FORBIDDEN');
    expect(BusinessErrorCode.NOT_FOUND).toBe('NOT_FOUND');
    expect(BusinessErrorCode.VALIDATION_FAILED).toBe('VALIDATION_FAILED');
    expect(Object.isFrozen(BusinessErrorCode)).toBe(true);

    expect(Object.isFrozen(BusinessErrorHttpStatusMap)).toBe(true);
    expect(BusinessErrorHttpStatusMap.VALIDATION_FAILED).toBe(400);
    expect(BusinessErrorHttpStatusMap.FORBIDDEN).toBe(403);
    expect(BusinessErrorHttpStatusMap.NOT_FOUND).toBe(404);
    expect(BusinessErrorHttpStatusMap.WORK_ORDER_NUMBER_EXISTS).toBe(409);
    expect(BusinessErrorHttpStatusMap.ACCOUNT_USERNAME_EXISTS).toBe(409);
    expect(BusinessErrorHttpStatusMap.INVALID_CREDENTIALS).toBe(403);
    expect(BusinessErrorHttpStatusMap.ACCOUNT_LAST_ADMIN).toBe(409);
    expect(BusinessErrorHttpStatusMap.SOURCE_UNAVAILABLE).toBe(503);
  });
});
