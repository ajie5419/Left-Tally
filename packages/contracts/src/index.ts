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

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    jsonLiteralSchema,
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const successResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z
    .object({
      success: z.literal(true),
      data: dataSchema.check((ctx) => {
        const parsed = jsonValueSchema.safeParse(ctx.value);
        if (!parsed.success) {
          ctx.issues.push({
            input: ctx.value,
            code: 'custom',
            message: parsed.error.message,
          });
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
    return value.map((item: unknown) => sanitizeJsonValue(item));
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

export function ok<T = unknown>(
  data: T,
  timestamp: string,
): SuccessResponse<T> {
  const validTimestamp = isoDatetimeStringSchema.parse(timestamp);
  const sanitized = sanitizeJsonValue(data);
  const schema: z.ZodType<T> = z.custom<T>((val) => {
    jsonValueSchema.parse(val);
    return true;
  });
  const validData = schema.parse(sanitized);
  return {
    success: true,
    data: validData,
    timestamp: validTimestamp,
  };
}

export function fail(
  code: string,
  message: string,
  details: JsonValue | undefined,
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
