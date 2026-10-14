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
  z,
  successResponseSchema,
  failureResponseSchema,
  ok,
  fail,
  BusinessErrorCode,
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
    const missingRouteRes = await app.request('/work-orders');
    expect(missingRouteRes.status).toBe(404);
    const missingRouteBody = failureResponseSchema.parse(
      await missingRouteRes.json(),
    );
    expect(missingRouteBody.code).toBe('NOT_FOUND');
    expect(missingRouteBody.message).toBe('Route not found');

    const invalidMethodRes = await app.request('/health', { method: 'POST' });
    expect(invalidMethodRes.status).toBe(404);
    const invalidMethodBody = failureResponseSchema.parse(
      await invalidMethodRes.json(),
    );
    expect(invalidMethodBody.code).toBe('NOT_FOUND');
    expect(invalidMethodBody.message).toBe('Route not found');
  });
});

describe('successResponseSchema', () => {
  const validIso = '2026-10-14T10:00:00.000Z';

  it('parses valid data matching schema and explicit ISO timestamp', () => {
    const schema = successResponseSchema(
      z.object({ id: z.number(), name: z.string() }),
    );
    const parsed = schema.parse({
      success: true,
      data: { id: 1, name: 'order' },
      timestamp: validIso,
    });
    expect(parsed).toEqual({
      success: true,
      data: { id: 1, name: 'order' },
      timestamp: validIso,
    });
  });

  it('strips undeclared data fields while strict schema rejects them', () => {
    const stripSchema = successResponseSchema(z.object({ id: z.number() }));
    const stripped = stripSchema.parse({
      success: true,
      data: { id: 42, extra: 'ignored' },
      timestamp: validIso,
    });
    expect(stripped.data).toEqual({ id: 42 });
    expect('extra' in stripped.data).toBe(false);

    const strictDataSchema = successResponseSchema(
      z.object({ id: z.number() }).strict(),
    );
    expect(
      strictDataSchema.safeParse({
        success: true,
        data: { id: 42, extra: 'forbidden' },
        timestamp: validIso,
      }).success,
    ).toBe(false);

    expect(
      stripSchema.safeParse({
        success: true,
        data: { id: 42 },
        timestamp: validIso,
        unexpectedRootField: true,
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
      schema.safeParse({
        success: true,
        data: 'test',
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

    expect(
      failureResponseSchema.safeParse({
        success: false,
        code: 'ERR',
        message: 'msg',
        timestamp: validIso,
        leakedField: 123,
      }).success,
    ).toBe(false);
  });

  it('enforces details to strictly conform to jsonValueSchema', () => {
    expect(
      failureResponseSchema.safeParse({
        success: false,
        code: 'ERR',
        message: 'msg',
        details: {
          nested: [1, 'text', true, null, { sub: false }],
        },
        timestamp: validIso,
      }).success,
    ).toBe(true);

    expect(
      failureResponseSchema.safeParse({
        success: false,
        code: 'ERR',
        message: 'msg',
        details: { count: 10n },
        timestamp: validIso,
      }).success,
    ).toBe(false);

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

    expect(
      failureResponseSchema.safeParse({
        success: false,
        code: 'ERR',
        message: 'msg',
        details: { date: new Date() },
        timestamp: validIso,
      }).success,
    ).toBe(false);
  });
});

describe('ok and fail helper functions', () => {
  const validIso = '2026-10-14T10:00:00.000Z';

  it('ok builds valid SuccessResponse and enforces ISO timestamp validation', () => {
    const res = ok({ id: 101, title: 'Item' }, validIso);
    expect(res).toEqual({
      success: true,
      data: { id: 101, title: 'Item' },
      timestamp: validIso,
    });

    expect(() => ok({ id: 1 }, 'not-an-iso-string')).toThrowError(
      /timestamp must be an ISO datetime string/,
    );
  });

  it('fail builds valid FailureResponse and validates code, message, details, and timestamp', () => {
    const failure = fail(
      BusinessErrorCode.VALIDATION_FAILED,
      'Invalid input parameter',
      { field: 'quantity' },
      validIso,
    );
    expect(failure).toEqual({
      success: false,
      code: 'VALIDATION_FAILED',
      message: 'Invalid input parameter',
      details: { field: 'quantity' },
      timestamp: validIso,
    });

    expect(() => fail('CODE', 'msg', undefined, 'invalid-iso')).toThrowError(
      /timestamp must be an ISO datetime string/,
    );

    expect(() => fail('', 'Valid message', undefined, validIso)).toThrow();
    expect(() => fail('VALID_CODE', '', undefined, validIso)).toThrow();

    expect(() => fail('CODE', 'msg', { invalid: 10n }, validIso)).toThrow();
    expect(() => fail('CODE', 'msg', { num: Number.NaN }, validIso)).toThrow();
  });
});

describe('global error handling and HTTP status mapping', () => {
  it('maps BusinessException to corresponding HTTP status and failure structure', () => {
    const validationEx = new BusinessException(
      BusinessErrorCode.VALIDATION_FAILED,
      'Field required',
      { field: 'name' },
    );
    expect(validationEx.status).toBe(400);
    expect(validationEx.code).toBe('VALIDATION_FAILED');
    expect(Object.isFrozen(BusinessErrorHttpStatusMap)).toBe(true);

    const forbiddenEx = new BusinessException(
      BusinessErrorCode.FORBIDDEN,
      'Permission denied',
    );
    expect(forbiddenEx.status).toBe(403);

    const notFoundEx = new BusinessException(
      BusinessErrorCode.NOT_FOUND,
      'Entity not found',
    );
    expect(notFoundEx.status).toBe(404);

    const emptyMsgEx = new BusinessException(
      BusinessErrorCode.FORBIDDEN,
      '   ',
    );
    expect(emptyMsgEx.message).toBe(
      "Business operation failed with code 'FORBIDDEN'",
    );
  });

  it('safeguards global error handler from unhandled business exception escaping', async () => {
    const testApp = createServerApp().get('/test-business-error', () => {
      throw new BusinessException(BusinessErrorCode.FORBIDDEN, '');
    });
    const response = await testApp.request('/test-business-error');
    expect(response.status).toBe(403);
    const body: unknown = await response.json();
    const parsed = failureResponseSchema.parse(body);
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('FORBIDDEN');
    expect(parsed.message).toBe(
      "Business operation failed with code 'FORBIDDEN'",
    );
  });

  it('preserves Hono HTTPException statuses in the error handler', async () => {
    const testApp = createServerApp()
      .get('/test-unauthorized', () => {
        throw new HTTPException(401, { message: 'Authentication required' });
      })
      .get('/test-timeout', () => {
        throw new HTTPException(408, { message: 'Request Timeout' });
      });

    const unauthResponse = await testApp.request('/test-unauthorized');
    expect(unauthResponse.status).toBe(401);
    const unauthBody: unknown = await unauthResponse.json();
    const parsedUnauth = failureResponseSchema.parse(unauthBody);
    expect(parsedUnauth.success).toBe(false);
    expect(parsedUnauth.code).toBe('HTTP_401');
    expect(parsedUnauth.message).toBe('Authentication required');

    const timeoutResponse = await testApp.request('/test-timeout');
    expect(timeoutResponse.status).toBe(408);
    const timeoutBody: unknown = await timeoutResponse.json();
    const parsedTimeout = failureResponseSchema.parse(timeoutBody);
    expect(parsedTimeout.success).toBe(false);
    expect(parsedTimeout.code).toBe('HTTP_408');
    expect(parsedTimeout.message).toBe('Request Timeout');
  });

  it('masks server-side 5xx HTTPException messages and normalizes custom res exceptions while preserving headers', async () => {
    const testApp = createServerApp()
      .get('/test-server-http-error', () => {
        throw new HTTPException(503, {
          message: 'upstream redis://secret-host:6379 failed',
        });
      })
      .get('/test-custom-res-exception', (c) => {
        c.header('X-Request-Id', 'req-12345');
        throw new HTTPException(401, {
          res: new Response('raw-body', {
            headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' },
          }),
        });
      });

    const serverErrResponse = await testApp.request('/test-server-http-error');
    expect(serverErrResponse.status).toBe(503);
    const serverErrBody = failureResponseSchema.parse(
      await serverErrResponse.json(),
    );
    expect(serverErrBody.success).toBe(false);
    expect(serverErrBody.code).toBe('INTERNAL_SERVER_ERROR');
    expect(serverErrBody.message).toBe('An unexpected internal error occurred');
    expect(JSON.stringify(serverErrBody)).not.toContain('secret-host');

    const customResResponse = await testApp.request(
      '/test-custom-res-exception',
    );
    expect(customResResponse.status).toBe(401);
    expect(customResResponse.headers.get('X-Request-Id')).toBe('req-12345');
    expect(customResResponse.headers.get('WWW-Authenticate')).toBe(
      'Bearer error="invalid_token"',
    );
  });

  it('masks unhandled internal exceptions without exposing sensitive details in production', async () => {
    const testApp = createServerApp().get('/test-error', () => {
      throw new Error(
        'Database connection to mysql://root:secret_pass@127.0.0.1:3306/prod failed',
      );
    });
    const response = await testApp.request('/test-error');
    expect(response.status).toBe(500);
    const body: unknown = await response.json();
    const parsed = failureResponseSchema.parse(body);
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('INTERNAL_SERVER_ERROR');
    expect(parsed.message).toBe('An unexpected internal error occurred');
    expect(parsed.timestamp).toBeDefined();
    expect(JSON.stringify(parsed)).not.toContain('mysql://');
    expect(JSON.stringify(parsed)).not.toContain('secret_pass');
  });

  it('preserves multiple Set-Cookie headers, resolves header conflicts, and ensures JSON content header consistency', async () => {
    const testApp = createServerApp().get('/test-cookie-headers', (c) => {
      c.header('Set-Cookie', 'session=s1; Path=/', { append: true });
      c.header('X-Request-Id', 'req-ctx-001');
      c.header('X-Custom-Trace', 'trace-context');

      const errHeaders = new Headers();
      errHeaders.append('Set-Cookie', 'auth_token=jwt1; Secure; HttpOnly');
      errHeaders.append('Set-Cookie', 'csrf_token=csrf2; SameSite=Strict');
      errHeaders.set('X-Custom-Trace', 'trace-exception-override');
      errHeaders.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      errHeaders.set('X-Content-Type-Options', 'nosniff');
      errHeaders.set('Content-Type', 'text/html; charset=gbk');
      errHeaders.set('Content-Length', '99999');

      throw new HTTPException(401, {
        res: new Response('<html>Error</html>', { headers: errHeaders }),
      });
    });

    const response = await testApp.request('/test-cookie-headers');
    expect(response.status).toBe(401);

    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toEqual([
      'session=s1; Path=/',
      'auth_token=jwt1; Secure; HttpOnly',
      'csrf_token=csrf2; SameSite=Strict',
    ]);

    expect(response.headers.get('x-request-id')).toBe('req-ctx-001');
    expect(response.headers.get('x-custom-trace')).toBe(
      'trace-exception-override',
    );
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer error="invalid_token"',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('content-length')).not.toBe('99999');

    const body = failureResponseSchema.parse(await response.json());
    expect(body.success).toBe(false);
    expect(body.code).toBe('HTTP_401');
  });
});

describe('BusinessErrorCode enum', () => {
  it('strictly defines only the 3 generic request-level error codes in bootstrap', () => {
    expect(Object.keys(BusinessErrorCode).sort()).toEqual([
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_FAILED',
    ]);
    expect(BusinessErrorCode.FORBIDDEN).toBe('FORBIDDEN');
    expect(BusinessErrorCode.NOT_FOUND).toBe('NOT_FOUND');
    expect(BusinessErrorCode.VALIDATION_FAILED).toBe('VALIDATION_FAILED');
    expect(Object.isFrozen(BusinessErrorCode)).toBe(true);
    expect(Reflect.set(BusinessErrorCode, 'NOT_FOUND', 'TAMPERED')).toBe(false);

    expect(() => {
      Object.assign(BusinessErrorCode, { NOT_FOUND: 'TAMPERED' });
    }).toThrow();
    expect(() => {
      Object.defineProperty(BusinessErrorCode, 'NOT_FOUND', {
        value: 'TAMPERED',
      });
    }).toThrow();
    expect(BusinessErrorCode.NOT_FOUND).toBe('NOT_FOUND');
  });
});
