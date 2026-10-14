import { z } from 'zod';

/** Service liveness does not represent database, identity or business readiness. */
export const healthSchema = z
  .object({
    status: z.literal('ok'),
    phase: z.literal('BOOTSTRAP'),
    businessReady: z.literal(false),
  })
  .strict();

export type Health = z.infer<typeof healthSchema>;

export const healthOpenApi = {
  openapi: '3.1.0',
  info: { title: 'Grand Comptroller bootstrap', version: '0.1.0' },
  paths: {
    '/health': {
      get: {
        summary: 'Public service liveness; no business or identity guarantee',
        responses: {
          '200': {
            description: 'Bootstrap service is responding',
            content: {
              'application/json': { schema: z.toJSONSchema(healthSchema) },
            },
          },
        },
      },
    },
  },
};

/**
 * 1. Entity Audit Base Paradigm
 * Baseline schema and types for business entities with optimistic locking.
 */
export const entityAuditBaseSchema = z
  .object({
    id: z.string().min(1, 'Entity id cannot be empty'),
    createdAt: z.iso.datetime({
      message: 'createdAt must be an ISO datetime string',
    }),
    updatedAt: z.iso.datetime({
      message: 'updatedAt must be an ISO datetime string',
    }),
    createdBy: z.string().min(1, 'createdBy cannot be empty'),
    version: z
      .number()
      .int()
      .positive({ message: 'version must be a positive integer' }),
  })
  .strict();

export type EntityAuditBase = z.infer<typeof entityAuditBaseSchema>;

/**
 * 2. Unified Result & Response DTO Paradigm
 */
export const successResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z
    .object({
      success: z.literal(true),
      data: dataSchema,
      timestamp: z.iso.datetime(),
    })
    .strict();

export const failureResponseSchema = z
  .object({
    success: z.literal(false),
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
    timestamp: z.iso.datetime(),
  })
  .strict();

export type SuccessResponse<T> = {
  success: true;
  data: T;
  timestamp: string;
};

export type FailureResponse = z.infer<typeof failureResponseSchema>;

export type ApiResponse<T> = SuccessResponse<T> | FailureResponse;

export function ok<T>(
  data: T,
  timestamp: string = new Date().toISOString(),
): SuccessResponse<T> {
  return {
    success: true,
    data,
    timestamp,
  };
}

export function fail(
  code: string,
  message: string,
  details?: unknown,
  timestamp: string = new Date().toISOString(),
): FailureResponse {
  return {
    success: false,
    code,
    message,
    ...(details !== undefined ? { details } : {}),
    timestamp,
  };
}

/**
 * 3. Standard Business Exceptions & Error Codes Paradigm
 */
export const BusinessErrorCode: {
  readonly VALIDATION_FAILED: 'VALIDATION_FAILED';
  readonly NOT_FOUND: 'NOT_FOUND';
  readonly FORBIDDEN: 'FORBIDDEN';
  readonly CONCURRENCY_CONFLICT: 'CONCURRENCY_CONFLICT';
  readonly STATE_TRANSITION_INVALID: 'STATE_TRANSITION_INVALID';
  readonly QUANTITY_MISMATCH: 'QUANTITY_MISMATCH';
  readonly QUALITY_GATE_BLOCKED: 'QUALITY_GATE_BLOCKED';
} = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  CONCURRENCY_CONFLICT: 'CONCURRENCY_CONFLICT',
  STATE_TRANSITION_INVALID: 'STATE_TRANSITION_INVALID',
  QUANTITY_MISMATCH: 'QUANTITY_MISMATCH',
  QUALITY_GATE_BLOCKED: 'QUALITY_GATE_BLOCKED',
};

export type BusinessErrorCodeType =
  (typeof BusinessErrorCode)[keyof typeof BusinessErrorCode];

export type BusinessHttpStatus = 400 | 403 | 404 | 409 | 422;

export const BusinessErrorHttpStatusMap: Record<
  BusinessErrorCodeType,
  BusinessHttpStatus
> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONCURRENCY_CONFLICT: 409,
  STATE_TRANSITION_INVALID: 422,
  QUANTITY_MISMATCH: 422,
  QUALITY_GATE_BLOCKED: 422,
};

export class BusinessException extends Error {
  readonly code: BusinessErrorCodeType;
  readonly status: BusinessHttpStatus;
  readonly details?: unknown;

  constructor(
    code: BusinessErrorCodeType,
    message: string,
    details?: unknown,
    statusOverride?: BusinessHttpStatus,
  ) {
    super(message);
    this.name = 'BusinessException';
    this.code = code;
    this.status = statusOverride ?? BusinessErrorHttpStatusMap[code];
    this.details = details;
  }

  toResponse(timestamp: string = new Date().toISOString()): FailureResponse {
    return fail(this.code, this.message, this.details, timestamp);
  }
}

/**
 * 4. General Quantity Precision & Comparison Paradigm
 */
export const QUANTITY_MAX_DECIMALS = 4;
export const QUANTITY_EPSILON = 1e-6;

export function roundQuantity(
  value: number,
  decimals: number = QUANTITY_MAX_DECIMALS,
): number {
  if (!Number.isFinite(value)) {
    throw new BusinessException(
      BusinessErrorCode.VALIDATION_FAILED,
      `Non-finite quantity value encountered: ${String(value)}`,
    );
  }
  const abs = Math.abs(value);
  if (abs < 1e-12) return 0;

  const sign = value < 0 ? -1 : 1;
  const parts = abs.toString().split('e');
  const base = parts[0] ?? '0';
  const exp = parts[1] !== undefined ? Number(parts[1]) : 0;
  const shiftedExp = exp + decimals;
  let shifted = Number(`${base}e${String(shiftedExp)}`);

  // Snap artifacts near half boundary (.5) caused by multi-ULP floating point drifts (e.g. 0.4999999999999977 -> 0.5)
  const floor = Math.floor(shifted);
  const half = floor + 0.5;
  const tolerance = Math.max(1e-10, Math.abs(shifted) * (Number.EPSILON * 64));
  if (Math.abs(shifted - half) < tolerance) {
    shifted = half;
  }

  const rounded = Math.round(shifted);
  const resParts = rounded.toString().split('e');
  const resBase = resParts[0] ?? '0';
  const resExp =
    (resParts[1] !== undefined ? Number(resParts[1]) : 0) - decimals;
  const res = sign * Number(`${resBase}e${String(resExp)}`);
  return Object.is(res, -0) ? 0 : res;
}

export function addQuantity(
  a: number,
  b: number,
  decimals: number = QUANTITY_MAX_DECIMALS,
): number {
  return roundQuantity(a + b, decimals);
}

export function subtractQuantity(
  a: number,
  b: number,
  decimals: number = QUANTITY_MAX_DECIMALS,
): number {
  return roundQuantity(a - b, decimals);
}

export function isEqualQuantity(
  a: number,
  b: number,
  epsilon: number = QUANTITY_EPSILON,
): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= epsilon;
}
