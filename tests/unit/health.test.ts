import { describe, expect, it } from 'vitest';
import { app, createServerApp } from '../../apps/api/src/app';
import {
  healthSchema,
  healthOpenApi,
  entityAuditBaseSchema,
  failureResponseSchema,
  ok,
  fail,
  BusinessErrorCode,
  BusinessException,
  roundQuantity,
  isEqualQuantity,
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
    expect(JSON.stringify(body)).not.toContain('mysql://');
    expect(JSON.stringify(body)).not.toContain('secret_pass');
  });
});

describe('engineering and data paradigms foundation', () => {
  it('validates entity audit base schema and optimistic locking constraints', () => {
    const validEntity = {
      id: 'ent_1001',
      createdAt: '2026-10-14T08:00:00.000Z',
      updatedAt: '2026-10-14T08:30:00.000Z',
      createdBy: 'operator_01',
      version: 1,
    };
    expect(entityAuditBaseSchema.safeParse(validEntity).success).toBe(true);

    expect(
      entityAuditBaseSchema.safeParse({
        ...validEntity,
        createdAt: 'invalid-date',
      }).success,
    ).toBe(false);
    expect(
      entityAuditBaseSchema.safeParse({ ...validEntity, createdBy: '' })
        .success,
    ).toBe(false);
    expect(
      entityAuditBaseSchema.safeParse({ ...validEntity, version: 0 }).success,
    ).toBe(false);
    expect(
      entityAuditBaseSchema.safeParse({ ...validEntity, version: -1 }).success,
    ).toBe(false);
  });

  it('builds standard unified response DTOs and handles failure details', () => {
    const successResult = ok(
      { orderId: 'WO-20261014-01' },
      '2026-10-14T10:00:00.000Z',
    );
    expect(successResult).toEqual({
      success: true,
      data: { orderId: 'WO-20261014-01' },
      timestamp: '2026-10-14T10:00:00.000Z',
    });

    const failureResult = fail(
      BusinessErrorCode.VALIDATION_FAILED,
      'Invalid payload',
      { field: 'quantity' },
      '2026-10-14T10:00:00.000Z',
    );
    expect(failureResult).toEqual({
      success: false,
      code: 'VALIDATION_FAILED',
      message: 'Invalid payload',
      details: { field: 'quantity' },
      timestamp: '2026-10-14T10:00:00.000Z',
    });
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
  });

  it('enforces general quantity precision, comparison, and rounding rules', () => {
    expect(roundQuantity(0.00015 - 0.0001, 4)).toBe(0.0001);
    expect(roundQuantity(0.00005, 4)).toBe(0.0001);
    expect(roundQuantity(10.07505, 4)).toBe(10.0751);
    expect(roundQuantity(1e-7, 4)).toBe(0);
    expect(roundQuantity(-1e-7, 4)).toBe(0);
    expect(roundQuantity(0.00004, 4)).toBe(0);
    expect(roundQuantity(12.34567, 4)).toBe(12.3457);
    expect(roundQuantity(12.3)).toBe(12.3);
    expect(isEqualQuantity(10.0000001, 10.0)).toBe(true);
    expect(isEqualQuantity(10.01, 10.0)).toBe(false);
    expect(isEqualQuantity(0.3, 0.1 + 0.2)).toBe(true);
    expect(() => {
      roundQuantity(Number.NaN);
    }).toThrowError(/Non-finite quantity/);
  });
});
