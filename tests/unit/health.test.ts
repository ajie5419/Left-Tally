import { describe, expect, it } from 'vitest';
import { app, createServerApp } from '../../apps/api/src/app';
import {
  healthSchema,
  healthOpenApi,
  failureResponseSchema,
  ok,
  fail,
  BusinessErrorCode,
  BusinessException,
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

describe('engineering and data paradigms foundation', () => {
  it('builds standard unified response DTOs with validated explicit timestamps', () => {
    const validIso = '2026-10-14T10:00:00.000Z';
    const successResult = ok({ orderId: 'WO-20261014-01' }, validIso);
    expect(successResult).toEqual({
      success: true,
      data: { orderId: 'WO-20261014-01' },
      timestamp: validIso,
    });

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

    // Verifies BusinessErrorCode is strictly scoped to the 4 generic REST error codes in bootstrap
    expect(Object.keys(BusinessErrorCode).sort()).toEqual([
      'CONCURRENCY_CONFLICT',
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_FAILED',
    ]);
  });
});
