import { z } from 'zod';
export { z };

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
 * 2. Unified Result & Response DTO Paradigm
 */
export const isoDatetimeStringSchema = z.iso.datetime({
  message: 'timestamp must be an ISO datetime string',
});

export type JsonLiteral = string | number | boolean | null;
export type JsonValue =
  | JsonLiteral
  | { [key: string]: JsonValue }
  | JsonValue[];

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().refine(Number.isFinite, { message: 'Number must be finite' }),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

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
  return failureResponseSchema.parse({
    success: false,
    code,
    message,
    ...(details !== undefined ? { details } : {}),
    timestamp,
  });
}

/**
 * 3. Standard Business Exceptions & Error Codes Paradigm
 */
export const BusinessErrorCode: {
  readonly VALIDATION_FAILED: 'VALIDATION_FAILED';
  readonly NOT_FOUND: 'NOT_FOUND';
  readonly FORBIDDEN: 'FORBIDDEN';
} = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
};

export type BusinessErrorCodeType =
  (typeof BusinessErrorCode)[keyof typeof BusinessErrorCode];
