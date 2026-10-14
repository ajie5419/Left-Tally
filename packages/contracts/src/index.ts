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

export const jsonLiteralSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function sanitizeJsonValue(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Number must be finite and not NaN');
    }
    return value;
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    const list: unknown[] = [];
    for (let i = 0; i < value.length; i += 1) {
      list.push(i in value ? sanitizeJsonValue(value[i]) : null);
    }
    return list;
  }
  if (typeof value === 'object') {
    if (!isPlainObject(value)) {
      throw new Error(
        'Non-plain objects (Date, RegExp, class instances) are not valid JSON structures',
      );
    }
    const record = Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, sanitizeJsonValue(val)]),
    );
    return record;
  }
  throw new Error('Value is not a valid JSON structure');
}

export const jsonValueSchema: z.ZodType<JsonValue> = z
  .unknown()
  .transform((val, ctx): JsonValue => {
    try {
      const sanitized: unknown = sanitizeJsonValue(val);
      const schema: z.ZodType<JsonValue> = z.custom<JsonValue>(() => true);
      return schema.parse(sanitized);
    } catch (err) {
      ctx.addIssue({
        code: 'custom',
        message: err instanceof Error ? err.message : String(err),
      });
      return z.NEVER;
    }
  });

export const successResponseSchema = <Output, Input>(
  dataSchema: z.ZodType<Output, Input>,
) =>
  z
    .object({
      success: z.literal(true),
      data: dataSchema.transform((val, ctx): Output => {
        try {
          const sanitized: unknown = sanitizeJsonValue(val);
          const schema: z.ZodType<Output> = z.custom<Output>(() => true);
          return schema.parse(sanitized);
        } catch (err) {
          ctx.addIssue({
            code: 'custom',
            message: err instanceof Error ? err.message : String(err),
          });
          return z.NEVER;
        }
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

export type ApiResponse<T> = SuccessResponse<T> | FailureResponse;

export function ok<T = unknown>(
  data: T,
  timestamp: string,
): SuccessResponse<T> {
  const validTimestamp = isoDatetimeStringSchema.parse(timestamp);
  const sanitized: unknown = sanitizeJsonValue(data);
  const schema: z.ZodType<T> = z.custom<T>((val) => {
    jsonValueSchema.parse(val);
    return true;
  });
  const validData: T = schema.parse(sanitized);
  return {
    success: true,
    data: validData,
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
  const candidate: unknown = {
    success: false,
    code,
    message,
    ...(details !== undefined ? { details } : {}),
    timestamp: validTimestamp,
  };
  return failureResponseSchema.parse(candidate);
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
