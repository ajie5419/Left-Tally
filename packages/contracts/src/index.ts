import { z } from 'zod';
export { z };
export * from './work-orders.ts';
export * from './session.ts';

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

/** JSON result validation is declarative; native HTTP responses have a separate contract. */
export const isoDatetimeStringSchema = z.iso.datetime({
  message: 'timestamp must be an ISO datetime string',
});

export type JsonLiteral = string | number | boolean | null;
export type JsonValue =
  | JsonLiteral
  | { [key: string]: JsonValue }
  | JsonValue[];

export const jsonValueSchema: z.ZodType<JsonValue> = z.json();

export const successResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z
    .object({
      success: z.literal(true),
      data: dataSchema.refine((val) => jsonValueSchema.safeParse(val).success, {
        message: 'Payload must be JSON-serializable',
      }),
      timestamp: isoDatetimeStringSchema,
    })
    .strict();

export const failureResponseSchema = z
  .object({
    success: z.literal(false),
    code: z.string().min(1),
    message: z.string().min(1),
    details: jsonValueSchema.optional(),
    timestamp: isoDatetimeStringSchema,
  })
  .strict();

export type SuccessResponse<T> = {
  success: true;
  data: T;
  timestamp: string;
};

export type FailureResponse = z.infer<typeof failureResponseSchema>;

/** Application JSON results only; explicit HTTPException responses may use other media types. */
export type ApiResponse<T> = SuccessResponse<T> | FailureResponse;

export function ok<T>(data: T, timestamp: string): SuccessResponse<T> {
  const validTimestamp = isoDatetimeStringSchema.parse(timestamp);
  jsonValueSchema.parse(data);
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
  return failureResponseSchema.parse({
    success: false,
    code,
    message,
    ...(details !== undefined ? { details } : {}),
    timestamp,
  });
}

/** Stable public business codes; authoritative HTTP mapping belongs to the API. */
export const BusinessErrorCode: Readonly<{
  readonly VALIDATION_FAILED: 'VALIDATION_FAILED';
  readonly NOT_FOUND: 'NOT_FOUND';
  readonly FORBIDDEN: 'FORBIDDEN';
  readonly WORK_ORDER_NUMBER_EXISTS: 'WORK_ORDER_NUMBER_EXISTS';
  readonly ACCOUNT_USERNAME_EXISTS: 'ACCOUNT_USERNAME_EXISTS';
  readonly INVALID_CREDENTIALS: 'INVALID_CREDENTIALS';
  readonly ACCOUNT_LAST_ADMIN: 'ACCOUNT_LAST_ADMIN';
  readonly SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE';
}> = Object.freeze({
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  WORK_ORDER_NUMBER_EXISTS: 'WORK_ORDER_NUMBER_EXISTS',
  ACCOUNT_USERNAME_EXISTS: 'ACCOUNT_USERNAME_EXISTS',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LAST_ADMIN: 'ACCOUNT_LAST_ADMIN',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
});

export type BusinessErrorCodeType =
  (typeof BusinessErrorCode)[keyof typeof BusinessErrorCode];
