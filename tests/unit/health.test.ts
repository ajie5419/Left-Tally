import { describe, expect, it } from 'vitest';
import {
  app,
  createServerApp,
  BusinessException,
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
    expect((await app.request('/work-orders')).status).toBe(404);
    expect((await app.request('/health', { method: 'POST' })).status).toBe(404);
  });

  it('masks unhandled internal exceptions without exposing test routes in production', async () => {
    const testApp = createServerApp().get('/test-error', () => {
      throw new Error(
        'Database connection to mysql://root:secret_pass@127.0.0.1:3306/prod failed',
      );
    });
    const response = await testApp.request('/test-error');
    expect(response.status).toBe(500);
    const body = failureResponseSchema.parse(await response.json());
    expect(body.success).toBe(false);
    expect(body.code).toBe('INTERNAL_SERVER_ERROR');
    expect(body.message).toBe('An unexpected internal error occurred');
    expect(body.timestamp).toBeDefined();
    expect(JSON.stringify(body)).not.toContain('mysql://');
    expect(JSON.stringify(body)).not.toContain('secret_pass');
  });
});

it('safeguards global error handler from unhandled business exception escaping', async () => {
  const testApp = createServerApp().get('/test-business-error', () => {
    throw new BusinessException(BusinessErrorCode.FORBIDDEN, '');
  });
  const response = await testApp.request('/test-business-error');
  expect(response.status).toBe(403);
  const body = failureResponseSchema.parse(await response.json());
  expect(body.success).toBe(false);
  expect(body.code).toBe('FORBIDDEN');
  expect(body.message).toBe("Business operation failed with code 'FORBIDDEN'");
});

describe('engineering and data paradigms foundation', () => {
  it('builds standard unified response DTOs with validated explicit timestamps and finite JSON payloads', () => {
    const validIso = '2026-10-14T10:00:00.000Z';
    const successResult = ok({ orderId: 'WO-20261014-01' }, validIso);
    expect(successResult).toEqual({
      success: true,
      data: { orderId: 'WO-20261014-01' },
      timestamp: validIso,
    });

    // Enforces finite JSON-serializable payloads in success responses (rejects NaN, Infinity, non-JSON)
    expect(() => {
      ok(Number.NaN, validIso);
    }).toThrow();

    expect(() => {
      ok(Infinity, validIso);
    }).toThrow();

    expect(() => {
      ok({ score: Number.NaN }, validIso);
    }).toThrow();

    const failureResult = fail(
      BusinessErrorCode.VALIDATION_FAILED,
      'Invalid payload',
      { field: 'quantity' },
      validIso,
    );
    expect(failureResult).toEqual({
      success: false,
      code: 'VALIDATION_FAILED',
      message: 'Invalid payload',
      details: { field: 'quantity' },
      timestamp: validIso,
    });

    // Enforces explicit valid ISO timestamp string; rejects non-ISO strings
    expect(() => {
      ok({ id: 1 }, 'not-a-date');
    }).toThrowError(/timestamp must be an ISO datetime string/);

    expect(() => {
      fail('CODE', 'msg', undefined, 'invalid-iso');
    }).toThrowError(/timestamp must be an ISO datetime string/);

    // Enforces full failure response schema validation (code.min(1), message.min(1))
    expect(() => {
      fail('', 'Valid message', undefined, validIso);
    }).toThrow();

    expect(() => {
      fail('VALID_CODE', '', undefined, validIso);
    }).toThrow();

    // Enforces details to be strictly JSON-serializable
    expect(
      fail('CODE', 'msg', { nested: { arr: [1, true, null, 'str'] } }, validIso)
        .details,
    ).toEqual({ nested: { arr: [1, true, null, 'str'] } });

    expect(() => {
      // BigInt is not JSON-serializable
      const candidate: unknown = {
        success: false,
        code: 'CODE',
        message: 'msg',
        details: { count: 10n },
        timestamp: validIso,
      };
      failureResponseSchema.parse(candidate);
    }).toThrow();

    // Enforces successResponseSchema to reject non-JSON schemas like BigInt
    expect(() => {
      const bigintSchema = successResponseSchema(z.bigint());
      const candidate: unknown = {
        success: true,
        data: 10n,
        timestamp: validIso,
      };
      bigintSchema.parse(candidate);
    }).toThrow();

    // Enforces successResponseSchema preserves endpoint data type inference and strips undeclared fields
    const endpointSchema = successResponseSchema(
      z.object({ id: z.number(), name: z.string() }),
    );
    const candidateData: unknown = {
      success: true,
      data: { id: 1, name: 'test', secret: 'leaked' },
      timestamp: validIso,
    };
    const parsedEndpoint = endpointSchema.parse(candidateData);
    expect(parsedEndpoint.data.id).toBe(1);
    expect(parsedEndpoint.data.name).toBe('test');
    expect(
      Object.prototype.hasOwnProperty.call(parsedEndpoint.data, 'secret'),
    ).toBe(false);

    // Enforces __proto__ as an own JSON key without prototype pollution
    const parseJson = (raw: string): unknown => JSON.parse(raw);
    const protoPayload = parseJson('{"__proto__":"kept","id":1}');
    const protoResult = ok(protoPayload, validIso);
    expect(
      Object.prototype.hasOwnProperty.call(protoResult.data, '__proto__'),
    ).toBe(true);
    expect(JSON.stringify(protoResult)).toContain('"__proto__":"kept"');
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'kept')).toBe(
      false,
    );

    // Enforces ok() returns parsed clean object without non-enumerable toJSON hooks
    const payloadWithHook = { count: 42 };
    Object.defineProperty(payloadWithHook, 'toJSON', {
      value: () => 10n,
      enumerable: false,
    });
    const sanitizedResult = ok(payloadWithHook, validIso);
    expect(JSON.stringify(sanitizedResult)).toBe(
      JSON.stringify({
        success: true,
        data: { count: 42 },
        timestamp: validIso,
      }),
    );
  });

  it('maps business exceptions to standardized error structures and HTTP status codes', () => {
    const ex = new BusinessException(
      BusinessErrorCode.CONCURRENCY_CONFLICT,
      'Optimistic locking conflict on version 1',
      { currentVersion: 2 },
    );
    expect(ex.status).toBe(409);
    expect(ex.code).toBe('CONCURRENCY_CONFLICT');

    const res = ex.toResponse('2026-10-14T10:00:00.000Z');
    expect(res).toEqual({
      success: false,
      code: 'CONCURRENCY_CONFLICT',
      message: 'Optimistic locking conflict on version 1',
      details: { currentVersion: 2 },
      timestamp: '2026-10-14T10:00:00.000Z',
    });

    // Validates that empty message is safely defaulted to avoid handler escaping
    const emptyMsgEx = new BusinessException(
      BusinessErrorCode.VALIDATION_FAILED,
      '   ',
    );
    expect(emptyMsgEx.message).toBe(
      "Business operation failed with code 'VALIDATION_FAILED'",
    );
    expect(emptyMsgEx.toResponse('2026-10-14T10:00:00.000Z').success).toBe(
      false,
    );

    // Verifies BusinessErrorCode is strictly scoped to the 4 generic REST error codes in bootstrap
    expect(Object.keys(BusinessErrorCode).sort()).toEqual([
      'CONCURRENCY_CONFLICT',
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_FAILED',
    ]);
  });
});
