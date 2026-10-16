import {
  z,
  failureResponseSchema,
  isoDatetimeStringSchema,
} from '@gc/contracts';

export class WorkOrderRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly unavailable = false,
  ) {
    super(message);
  }
}

export async function workOrderRequest<T extends z.ZodType>(
  path: string,
  schema: T,
  body?: unknown,
  method: 'POST' | 'PUT' = 'POST',
): Promise<z.infer<T>> {
  let response: Response;
  try {
    response = await fetch(
      `/api${path}`,
      body === undefined
        ? {}
        : {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
  } catch {
    throw new WorkOrderRequestError(
      '服务连接失败，请检查网络后重试。',
      0,
      true,
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new WorkOrderRequestError(
      '服务暂时不可用，请稍后重试。',
      response.status,
      true,
    );
  }
  if (!response.ok) {
    const error = failureResponseSchema.safeParse(data);
    throw new WorkOrderRequestError(
      error.success ? error.data.message : '操作失败，请重试',
      response.status,
    );
  }
  try {
    const envelope = z
      .object({
        success: z.literal(true),
        data: z.unknown(),
        timestamp: isoDatetimeStringSchema,
      })
      .parse(data);
    return schema.parse(envelope.data);
  } catch {
    throw new WorkOrderRequestError(
      '服务响应异常，请稍后重试。',
      response.status,
      true,
    );
  }
}
