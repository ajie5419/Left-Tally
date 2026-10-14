import { describe, expect, it } from 'vitest';
import {
  app,
  createServerApp,
  BusinessException,
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
  const unauthBody = failureResponseSchema.parse(await unauthResponse.json());
  expect(unauthBody.success).toBe(false);
  expect(unauthBody.code).toBe('HTTP_401');
  expect(unauthBody.message).toBe('Authentication required');

  const timeoutResponse = await testApp.request('/test-timeout');
  expect(timeoutResponse.status).toBe(408);
  const timeoutBody = failureResponseSchema.parse(await timeoutResponse.json());
  expect(timeoutBody.success).toBe(false);
  expect(timeoutBody.code).toBe('HTTP_408');
  expect(timeoutBody.message).toBe('Request Timeout');
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

    // Enforces safeParse on non-JSON schema returns success: false instead of escaping
    const bigintSchema = successResponseSchema(z.bigint());
    const candidateBigInt: unknown = {
      success: true,
      data: 10n,
      timestamp: validIso,
    };
    const safeParsed = bigintSchema.safeParse(candidateBigInt);
    expect(safeParsed.success).toBe(false);

    // Enforces rejection of non-plain objects (Date, RegExp, class instances)
    expect(() => {
      ok(new Date(), validIso);
    }).toThrow(/Non-plain objects/);

    class CustomModel {
      readonly field = 'custom';
    }
    expect(() => {
      ok(new CustomModel(), validIso);
    }).toThrow(/Non-plain objects/);

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

    // Enforces successResponseSchema with permissive schema strips non-enumerable toJSON hooks
    const permissiveSchema = successResponseSchema(z.unknown());
    const permissivePayload = { count: 42 };
    Object.defineProperty(permissivePayload, 'toJSON', {
      value: () => 10n,
      enumerable: false,
    });
    const parsedPermissive = permissiveSchema.parse({
      success: true,
      data: permissivePayload,
      timestamp: validIso,
    });
    expect(JSON.stringify(parsedPermissive)).toBe(
      JSON.stringify({
        success: true,
        data: { count: 42 },
        timestamp: validIso,
      }),
    );

    // Enforces rejection of nested non-plain response values
    const nestedNonPlainResult = successResponseSchema(z.unknown()).safeParse({
      success: true,
      data: { when: new Date() },
      timestamp: validIso,
    });
    expect(nestedNonPlainResult.success).toBe(false);

    // Enforces sanitization of the output of endpoint transforms
    const transformSchema = successResponseSchema(
      z.string().transform(() => {
        const obj = { count: 100 };
        Object.defineProperty(obj, 'toJSON', {
          value: () => 10n,
          enumerable: false,
        });
        return obj;
      }),
    );
    const parsedTransformed = transformSchema.parse({
      success: true,
      data: 'trigger',
      timestamp: validIso,
    });
    expect(JSON.stringify(parsedTransformed)).toBe(
      JSON.stringify({
        success: true,
        data: { count: 100 },
        timestamp: validIso,
      }),
    );

    // Enforces preservation of __proto__ in failure details
    const failWithProto = fail(
      'ERR',
      'msg',
      JSON.parse('{"__proto__":"kept","err":"failed"}'),
      validIso,
    );
    expect(
      Object.prototype.hasOwnProperty.call(failWithProto.details, '__proto__'),
    ).toBe(true);
    expect(JSON.stringify(failWithProto)).toContain('"__proto__":"kept"');
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'kept')).toBe(
      false,
    );

    // Enforces rejection of sparse arrays with inherited numeric properties on prototype
    const protoSparseArray: unknown[] = [1];
    protoSparseArray.length = 3;
    Object.setPrototypeOf(protoSparseArray, { 1: 999 });
    expect(
      successResponseSchema(z.unknown()).safeParse({
        success: true,
        data: protoSparseArray,
        timestamp: validIso,
      }).success,
    ).toBe(false);

    // Enforces rejection of plain objects with non-enumerable data properties
    const objWithHiddenData = { publicField: 'visible' };
    Object.defineProperty(objWithHiddenData, 'secretId', {
      value: 12345,
      enumerable: false,
    });
    expect(
      successResponseSchema(z.unknown()).safeParse({
        success: true,
        data: objWithHiddenData,
        timestamp: validIso,
      }).success,
    ).toBe(false);
    expect(() => {
      ok(objWithHiddenData, validIso);
    }).toThrow(/non-enumerable data properties/);

    // Enforces array sanitization without trusting overridden map method
    const hijackedArray: unknown = [1, 10n];
    Object.defineProperty(hijackedArray, 'map', {
      value: () => hijackedArray,
    });
    const hijackedResult = successResponseSchema(z.unknown()).safeParse({
      success: true,
      data: hijackedArray,
      timestamp: validIso,
    });
    expect(hijackedResult.success).toBe(false);

    // Enforces rejection of sparse arrays to protect generic type contracts
    const sparseArray: unknown[] = [1];
    sparseArray[2] = 3;
    const sparseResult = successResponseSchema(z.unknown()).safeParse({
      success: true,
      data: sparseArray,
      timestamp: validIso,
    });
    expect(sparseResult.success).toBe(false);
    expect(() => {
      ok(sparseArray, validIso);
    }).toThrow(/Sparse arrays are not valid JSON structures/);
  });

  it('maps business exceptions to standardized error structures and HTTP status codes', () => {
    const ex = new BusinessException(
      BusinessErrorCode.FORBIDDEN,
      'Access to this resource is denied',
      { resource: 'billing' },
    );
    expect(ex.status).toBe(403);
    expect(ex.code).toBe('FORBIDDEN');

    const res = ex.toResponse('2026-10-14T10:00:00.000Z');
    expect(res).toEqual({
      success: false,
      code: 'FORBIDDEN',
      message: 'Access to this resource is denied',
      details: { resource: 'billing' },
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

    // Verifies BusinessErrorCode is strictly scoped to the 3 generic REST error codes in bootstrap
    expect(Object.keys(BusinessErrorCode).sort()).toEqual([
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_FAILED',
    ]);
  });
});
