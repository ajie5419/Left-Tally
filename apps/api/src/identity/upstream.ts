import { z, type Principal } from '@gc/contracts';

export interface IdentityConfig {
  qmsOrigin: string;
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
  permissions: Record<string, Principal['permissions']>;
}
export class InvalidIdentity extends Error {}
export const credentialSchema = z
  .object({
    credential: z.string().regex(/^[\w-]{43}$/),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const identitySchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(128),
    active: z.literal(true),
  })
  .strict();

/** Paths are compile-time choices; credentials never follow an upstream redirect. */
export function qmsIdentity(config: IdentityConfig) {
  async function call<T extends z.ZodType>(
    path: 'exchange' | 'identity' | 'revoke',
    schema: T,
    body: unknown,
    credential?: string,
  ): Promise<z.infer<T>> {
    const response = await fetch(
      `${config.qmsOrigin}/api/identity-bridge/${path}`,
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: {
          'Content-Type': 'application/json',
          'X-Identity-Client-Id': config.clientId,
          'X-Identity-Client-Secret': config.clientSecret,
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        },
        body: JSON.stringify(body),
      },
    );
    if (response.status === 401 || response.status === 403)
      throw new InvalidIdentity();
    if (
      !response.ok ||
      Number(response.headers.get('content-length') ?? 0) > 16_384
    )
      throw new Error('IDENTITY_UPSTREAM_UNAVAILABLE');
    const content = await response.text();
    if (content.length > 16_384) throw new Error('IDENTITY_UPSTREAM_INVALID');
    const decoded: unknown = JSON.parse(content);
    const envelope = z
      .object({
        code: z.literal(0),
        data: z.unknown(),
        error: z.null(),
        message: z.literal('ok'),
      })
      .strict()
      .parse(decoded);
    return schema.parse(envelope.data);
  }
  return {
    exchange: (body: unknown) => call('exchange', credentialSchema, body),
    identity: (credential: string) =>
      call('identity', identitySchema, {}, credential),
    revoke: (credential: string) =>
      call(
        'revoke',
        z.object({ revoked: z.literal(true) }).strict(),
        {},
        credential,
      ),
  };
}
