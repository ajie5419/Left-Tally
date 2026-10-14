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
export const isoDatetimeStringSchema = z.iso.datetime({
  message: 'timestamp must be an ISO datetime string',
});

export const successResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z
    .object({
      success: z.literal(true),
      data: dataSchema,
      timestamp: isoDatetimeStringSchema,
    })
    .strict();

export const failureResponseSchema = z
  .object({
    success: z.literal(false),
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.unknown().optional(),
    timestamp: isoDatetimeStringSchema,
  })
  .strict();

export type SuccessResponse<T> = {
  success: true;
  data: T;
  timestamp: string;
};

export type FailureResponse = z.infer<typeof failureResponseSchema>;

export type ApiResponse<T> = SuccessResponse<T> | FailureResponse;

export function ok<T>(data: T, timestamp: string): SuccessResponse<T> {
  const validTimestamp = isoDatetimeStringSchema.parse(timestamp);
  return {
    success: true,
    data,
    timestamp: validTimestamp,
  };
}

export function fail(
  code: string,
  message: string,
  details: unknown,
  timestamp: string,
): FailureResponse {
  const validTimestamp = isoDatetimeStringSchema.parse(timestamp);
  return {
    success: false,
    code,
    message,
    ...(details !== undefined ? { details } : {}),
    timestamp: validTimestamp,
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
} = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  CONCURRENCY_CONFLICT: 'CONCURRENCY_CONFLICT',
};

export type BusinessErrorCodeType =
  (typeof BusinessErrorCode)[keyof typeof BusinessErrorCode];

export type BusinessHttpStatus = 400 | 403 | 404 | 409;

export const BusinessErrorHttpStatusMap: Record<
  BusinessErrorCodeType,
  BusinessHttpStatus
> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONCURRENCY_CONFLICT: 409,
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

  toResponse(timestamp: string): FailureResponse {
    return fail(this.code, this.message, this.details, timestamp);
  }
}
