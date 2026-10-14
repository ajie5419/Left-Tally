import { describe, expect, it } from 'vitest';
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
    expect((await app.request('/work-orders')).status).toBe(404);
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
    expect(res401.headers.get('content-type')).toContain('application/json');
    const body401 = failureResponseSchema.parse(await res401.json());
    expect(body401.code).toBe('HTTP_401');

    const res408 = await testApp.request('/test-http-error-408');
    expect(res408.status).toBe(408);
    const body408 = failureResponseSchema.parse(await res408.json());
    expect(body408.code).toBe('HTTP_408');
    expect(body408.message).toBe('Request timed out');
  });

  it('preserves protocol headers (Allow, Proxy-Authenticate, Set-Cookie) while discarding representation headers', async () => {
    const testApp = createServerApp().get('/test-protocol-headers', (c) => {
      c.header('Set-Cookie', 'session=active; Path=/');
      const errorResponse = new Response('Method Not Allowed', {
        status: 405,
        headers: [
          ['Allow', 'GET, HEAD'],
          ['Proxy-Authenticate', 'Basic realm="test"'],
          ['Set-Cookie', 'csrf_token=abc; SameSite=Strict'],
          ['Set-Cookie', 'warning=rejected; Path=/'],
          ['Content-Type', 'text/html'],
          ['Content-Length', '18'],
          ['Transfer-Encoding', 'chunked'],
          ['ETag', 'W/"old-entity-tag"'],
          ['Last-Modified', 'Wed, 14 Oct 2026 10:00:00 GMT'],
          ['Digest', 'sha-256=stale-digest'],
          ['Content-Digest', 'sha-256=:stale-content-digest:'],
        ],
      });
      throw new HTTPException(405, { res: errorResponse });
    });

    const res = await testApp.request('/test-protocol-headers');
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
    expect(res.headers.get('proxy-authenticate')).toBe('Basic realm="test"');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('transfer-encoding')).toBeNull();
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('last-modified')).toBeNull();
    expect(res.headers.get('digest')).toBeNull();
    expect(res.headers.get('content-digest')).toBeNull();
    const cookies = res.headers.getSetCookie();
    expect(cookies).toEqual([
      'session=active; Path=/',
      'csrf_token=abc; SameSite=Strict',
      'warning=rejected; Path=/',
    ]);
  });

  it('masks 5xx server exceptions and keeps database and credential details confidential', async () => {
    const testApp = createServerApp().get('/test-secret-leak', () => {
      throw new Error(
        'Prisma connection error to mysql://root:secret@10.0.0.1:3306/db',
      );
    });

    const response = await testApp.request('/test-secret-leak');
    expect(response.status).toBe(500);

    const parsed = failureResponseSchema.parse(await response.json());
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('INTERNAL_SERVER_ERROR');
    expect(parsed.message).toBe('An unexpected internal error occurred');
    expect(JSON.stringify(parsed)).not.toContain('mysql://');
    expect(JSON.stringify(parsed)).not.toContain('secret');
  });
});

describe('BusinessErrorCode enum and status mapping', () => {
  it('strictly defines and freezes error codes and status mapping', () => {
    expect(Object.keys(BusinessErrorCode).sort()).toEqual([
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_FAILED',
    ]);
    expect(BusinessErrorCode.FORBIDDEN).toBe('FORBIDDEN');
    expect(BusinessErrorCode.NOT_FOUND).toBe('NOT_FOUND');
    expect(BusinessErrorCode.VALIDATION_FAILED).toBe('VALIDATION_FAILED');
    expect(Object.isFrozen(BusinessErrorCode)).toBe(true);

    expect(Object.isFrozen(BusinessErrorHttpStatusMap)).toBe(true);
    expect(BusinessErrorHttpStatusMap.VALIDATION_FAILED).toBe(400);
    expect(BusinessErrorHttpStatusMap.FORBIDDEN).toBe(403);
    expect(BusinessErrorHttpStatusMap.NOT_FOUND).toBe(404);
  });
});
