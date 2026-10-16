import type { Context } from 'hono';
import { principalSchema, type Principal } from '@gc/contracts';
import { BusinessException } from './business-error.js';

/** Adapters verify sessions and map local permissions; headers alone are never an identity. */
export interface IdentityAdapter {
  resolve(request: Request): Promise<Principal | null>;
}
export interface SessionOptions {
  identity: IdentityAdapter;
  mode: 'demo' | 'production';
  loginUrl: string | null;
  publicOrigin?: string;
  now(): number;
}
export async function verifiedPrincipal(
  options: SessionOptions,
  context: Context,
) {
  try {
    const value = await options.identity.resolve(context.req.raw);
    return principalSchema.nullable().parse(value);
  } catch {
    throw new BusinessException(
      'SOURCE_UNAVAILABLE',
      '无法验证登录状态，请重试',
    );
  }
}
export function assertWriteOrigin(
  options: Pick<SessionOptions, 'publicOrigin'>,
  request: Request,
) {
  const expected = options.publicOrigin ?? new URL(request.url).origin;
  if (request.method !== 'GET' && request.headers.get('Origin') !== expected)
    throw new BusinessException('FORBIDDEN', '请求来源无效，请从本页面操作');
}
