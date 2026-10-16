import { it, expect, vi, afterEach } from 'vitest';
import { createServerApp } from '../../apps/api/src/app.js';
import { workOrderRoutes } from '../../apps/api/src/modules/work-orders/routes/index.js';
import { workOrderService } from '../../apps/api/src/modules/work-orders/application/service.js';
import { serverConfig } from '../../apps/api/src/server-config.js';
import { businessOpenApi } from '../../apps/api/src/openapi.js';
import { createProductionAdapters } from '../../apps/api/src/runtime-adapters.js';
import {
  z,
  sessionSchema,
  successResponseSchema,
  type Principal,
} from '@gc/contracts';

const principal: Principal = {
  id: 'verified-user',
  name: '项目人员',
  permissions: ['work-orders:read'],
};
function app(resolve: (request: Request) => Promise<Principal | null>) {
  return createServerApp(
    workOrderRoutes({
      identity: { resolve },
      mode: 'production',
      loginUrl: 'https://identity.example.test/login',
      publicOrigin: 'https://gc.example.test',
      now: () => 0,
      service: workOrderService({
        repository: {
          list: () => Promise.resolve([]),
          insert: () => Promise.resolve(true),
        },
        source: { productionLeads: () => Promise.resolve([]) },
        newId: () => '00000000-0000-4000-8000-000000000001',
        now: () => new Date(0).toISOString(),
      }),
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());
it('returns verified production sessions and never mounts demo login routes', async () => {
  const api = app(() => Promise.resolve(principal));
  const response = await api.request('/api/session');
  const session = successResponseSchema(sessionSchema).parse(
    await response.json(),
  ).data;
  expect(session).toEqual({
    mode: 'production',
    principal,
    loginUrl: 'https://identity.example.test/login',
  });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await api.request('/api/demo/identities')).status).toBe(404);
  expect(
    (
      await api.request('/api/demo/session', {
        method: 'POST',
        headers: { Origin: 'https://gc.example.test' },
      })
    ).status,
  ).toBe(404);
});
it('denies forged identity headers and revalidates identity for every request', async () => {
  let current: Principal | null = principal;
  const resolve = vi.fn(() => Promise.resolve(current));
  const api = app(resolve);
  expect((await api.request('/api/work-orders')).status).toBe(200);
  current = null;
  const headers = {
    'X-User-Id': principal.id,
    'X-Role': 'project',
    'X-Permissions': 'work-orders:create',
  };
  expect((await api.request('/api/work-orders', { headers })).status).toBe(403);
  const response = await api.request('/api/session', { headers });
  expect(
    successResponseSchema(sessionSchema).parse(await response.json()).data
      .principal,
  ).toBeNull();
  expect(resolve).toHaveBeenCalledTimes(3);
});
it('fails closed on identity outage or malformed adapter output without exposing details', async () => {
  const unavailable = app(() =>
    Promise.reject(new Error('private upstream details')),
  );
  const response = await unavailable.request('/api/session');
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private upstream details');
  const invalid = app(() => Promise.resolve({ ...principal, id: '' }));
  expect((await invalid.request('/api/work-orders')).status).toBe(503);
});
it('enforces read permission and the configured public Origin behind a proxy', async () => {
  const noPermissions = app(() =>
    Promise.resolve({ ...principal, permissions: [] }),
  );
  expect((await noPermissions.request('/api/work-orders')).status).toBe(403);
  expect((await noPermissions.request('/api/work-orders/sources')).status).toBe(
    403,
  );
  const api = app(() =>
    Promise.resolve({ ...principal, permissions: ['work-orders:create'] }),
  );
  const body = JSON.stringify({
    number: 'P-1',
    customer: '客户',
    quantity: 1,
    dueDate: '2026-11-20',
  });
  for (const origin of ['http://localhost', 'https://other.example.test', '']) {
    expect(
      (
        await api.request('http://internal:3000/api/work-orders', {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body,
        })
      ).status,
    ).toBe(403);
  }
  expect(
    (
      await api.request('http://internal:3000/api/work-orders', {
        method: 'POST',
        headers: {
          Origin: 'https://gc.example.test',
          'Content-Type': 'application/json',
        },
        body,
      })
    ).status,
  ).toBe(201);
});
it('rejects incomplete or invalid production configuration with a sanitized error', () => {
  const config = {
    GC_DATABASE_URL: 'mysql://app@database/gc',
    GC_PUBLIC_ORIGIN: 'https://gc.example.test',
  };
  expect(serverConfig(config)).toMatchObject({
    port: 3000,
    hostname: '127.0.0.1',
  });
  for (const change of [
    { GC_DATABASE_URL: 'invalid' },
    { GC_DATABASE_URL: 'postgres://app@database/gc' },
    { GC_PUBLIC_ORIGIN: 'http://gc.example.test' },
    { GC_PUBLIC_ORIGIN: 'https://gc.example.test/path' },
    { PORT: '0' },
    { PORT: '65536' },
    { HOST: '' },
  ])
    expect(() => serverConfig({ ...config, ...change })).toThrow(
      'RUNTIME_CONFIG_INVALID',
    );
  for (const key of Object.keys(config)) {
    const incomplete: NodeJS.ProcessEnv = { ...config };
    Reflect.deleteProperty(incomplete, key);
    expect(() => serverConfig(incomplete)).toThrow('RUNTIME_CONFIG_INVALID');
  }
});
it('uses local-account production composition without QMS configuration', async () => {
  await expect(
    createProductionAdapters().personnel.productionLeads(),
  ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
});
it('publishes strict business request and response schemas without inventing an authentication protocol', () => {
  const post = businessOpenApi.paths['/api/work-orders'].post;
  expect(post['x-required-permissions']).toEqual(['work-orders:create']);
  expect(
    post.requestBody.content['application/json'].schema.additionalProperties,
  ).toBe(false);
  expect(JSON.stringify(businessOpenApi)).not.toContain('/demo/');
  expect(businessOpenApi['x-authentication'].status).toBe('gc-local-account');
});
it('declares every templated account path parameter and its not-found response', () => {
  const paths = z
    .record(
      z.string(),
      z.record(
        z.string(),
        z.object({
          parameters: z
            .array(
              z.object({
                name: z.string(),
                in: z.string(),
                required: z.boolean().optional(),
              }),
            )
            .optional(),
          responses: z.record(z.string(), z.unknown()),
        }),
      ),
    )
    .parse(JSON.parse(JSON.stringify(businessOpenApi.paths)));
  for (const path of [
    '/api/accounts/{id}/permissions',
    '/api/accounts/{id}/reset-password',
    '/api/accounts/{id}/active',
  ]) {
    const operation = Object.values(paths[path] ?? {})[0];
    if (!operation) throw new Error(`MISSING_OPENAPI_OPERATION: ${path}`);
    expect(operation.parameters).toEqual([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    ]);
    expect(operation.responses['404']).toBeDefined();
  }
});
