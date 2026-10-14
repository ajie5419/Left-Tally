import { describe, expect, it } from 'vitest';
import { app } from '../../apps/api/src/app';
import {
  healthSchema,
  healthOpenApi,
  entityAuditBaseSchema,
  ok,
  fail,
  BusinessErrorCode,
  BusinessException,
  roundQuantity,
  isEqualQuantity,
  assertWorkshopQuantityConservation,
  StateTransitionGuard,
  type StateTransitionGraph,
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

  it('enforces workshop quantity precision and conservation theorem', () => {
    expect(roundQuantity(12.34567)).toBe(12.3457);
    expect(roundQuantity(12.3)).toBe(12.3);
    expect(isEqualQuantity(10.0000001, 10.0)).toBe(true);
    expect(isEqualQuantity(10.01, 10.0)).toBe(false);

    expect(() => {
      assertWorkshopQuantityConservation({
        dispatched: 100,
        inProgress: 40,
        delivered: 50,
        scrapped: 5,
        pendingDisposal: 5,
      });
    }).not.toThrow();

    expect(() => {
      assertWorkshopQuantityConservation({
        dispatched: 0.3,
        inProgress: 0.1,
        delivered: 0.2,
        scrapped: 0,
        pendingDisposal: 0,
      });
    }).not.toThrow();

    expect(() => {
      assertWorkshopQuantityConservation({
        dispatched: 100,
        inProgress: 40,
        delivered: 50,
        scrapped: 4,
        pendingDisposal: 5,
      });
    }).toThrowError(/Workshop quantity conservation violation/);

    expect(() => {
      assertWorkshopQuantityConservation({
        dispatched: 100,
        inProgress: 110,
        delivered: 0,
        scrapped: -10,
        pendingDisposal: 0,
      });
    }).toThrowError(/Negative or invalid quantity/);
  });

  it('guards state machine transitions against illegal jumps', () => {
    type OrderState =
      | 'DRAFT'
      | 'DISPATCHED'
      | 'IN_PROGRESS'
      | 'COMPLETED'
      | 'CANCELLED';

    const graph: StateTransitionGraph<OrderState> = {
      DRAFT: ['DISPATCHED', 'CANCELLED'],
      DISPATCHED: ['IN_PROGRESS', 'CANCELLED'],
      IN_PROGRESS: ['COMPLETED'],
      COMPLETED: [],
      CANCELLED: [],
    };

    const guard = new StateTransitionGuard(graph);

    expect(guard.canTransition('DRAFT', 'DISPATCHED')).toBe(true);
    expect(guard.canTransition('DRAFT', 'CANCELLED')).toBe(true);
    expect(guard.canTransition('DRAFT', 'COMPLETED')).toBe(false);

    expect(() => {
      guard.assertTransition('DRAFT', 'DISPATCHED');
    }).not.toThrow();

    expect(() => {
      guard.assertTransition('DRAFT', 'COMPLETED');
    }).toThrowError(/Invalid state transition: 'DRAFT' -> 'COMPLETED'/);
  });
});
