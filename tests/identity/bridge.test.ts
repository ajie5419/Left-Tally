import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createConnection, type Connection } from 'mysql2/promise';
import type { Server } from 'node:http';
import { z } from '@gc/contracts';
import { Hono } from 'hono';
import { createRuntimeApp } from '../../apps/api/src/runtime.js';
import { persistentIdentity } from '../../apps/api/src/identity/session.js';
import {
  randomToken,
  challengeFor,
} from '../../apps/api/src/identity/crypto.js';
import type { IdentityConfig } from '../../apps/api/src/identity/upstream.js';

interface Client {
  id: string;
  secret: string;
  callback: string;
}
interface Authorization {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  method: 'S256';
}
interface Exchange {
  code: string;
  redirectUri: string;
  verifier: string;
}
interface Bridge {
  authorize(
    userId: string,
    input: Authorization,
  ): Promise<{ callback: string }>;
  exchange(input: Exchange): Promise<{ credential: string; expiresAt: string }>;
  identity(value: string): Promise<{ id: string; name: string; active: true }>;
  revoke(value: string): Promise<{ revoked: true }>;
}
const root = process.env['GC_IDENTITY_QMS_ROOT'];
if (
  !root ||
  !process.env['QGS_IDENTITY_DATABASE_URL'] ||
  !process.env['GC_DATABASE_URL']
)
  throw new Error('TASK_DATABASE_REQUIRED');
const require = createRequire(resolve(root, 'apps/backend/package.json'));
const { PrismaClient } = z
  .object({
    PrismaClient: z.custom<
      new (config: unknown) => { $disconnect(): Promise<void> }
    >((value) => typeof value === 'function'),
  })
  .parse(require('@prisma/client'));
const qmsDb = new PrismaClient({
  datasources: { db: { url: process.env['QGS_IDENTITY_DATABASE_URL'] } },
});
const modulePath = resolve(
  root,
  'apps/backend/modules/identity-bridge/identity-bridge.service.ts',
);
const { createIdentityBridge } = z
  .object({
    createIdentityBridge: z.custom<
      (db: unknown, client: Client, now?: () => Date) => Bridge
    >((value) => typeof value === 'function'),
  })
  .parse(await vi.importActual(modulePath));
const { authenticateClient } = z
  .object({
    authenticateClient: z.custom<
      (client: Client, id: string, secret: string) => void
    >((value) => typeof value === 'function'),
  })
  .parse(
    await vi.importActual(
      resolve(root, 'apps/backend/modules/identity-bridge/config.ts'),
    ),
  );
const apiRequire = createRequire(
  new URL('../../apps/api/package.json', import.meta.url),
);
const { serve } = z
  .object({
    serve: z.custom<
      (options: {
        fetch(request: Request): Response | Promise<Response>;
        port: number;
        hostname: string;
      }) => Server
    >((value) => typeof value === 'function'),
  })
  .parse(apiRequire('@hono/node-server'));
const client = {
  id: 'gc-isolated',
  secret: randomToken(),
  callback: 'http://127.0.0.1/api/auth/callback',
};
const bridge = createIdentityBridge(qmsDb, client);
let sql: Connection;
let outage = false;
const upstreamApp = new Hono().post(
  '/api/identity-bridge/:action',
  async (c) => {
    if (outage) return c.json({}, 503);
    try {
      authenticateClient(
        client,
        c.req.header('x-identity-client-id') ?? '',
        c.req.header('x-identity-client-secret') ?? '',
      );
      const action = c.req.param('action');
      const credential = c.req.header('authorization')?.slice(7) ?? '';
      const data =
        action === 'exchange'
          ? await bridge.exchange(await c.req.json<Exchange>())
          : action === 'revoke'
            ? await bridge.revoke(credential)
            : await bridge.identity(credential);
      return c.json({ code: 0, data, error: null, message: 'ok' });
    } catch {
      return c.json({}, 401);
    }
  },
);
const server = serve({
  fetch: upstreamApp.fetch,
  port: 0,
  hostname: '127.0.0.1',
});
await new Promise<void>((r) => {
  if (server.listening) r();
  else server.once('listening', r);
});
const address = server.address();
if (!address || typeof address === 'string')
  throw new Error('LISTENER_REQUIRED');
const config: IdentityConfig = {
  qmsOrigin: `http://127.0.0.1:${String(address.port)}`,
  clientId: client.id,
  clientSecret: client.secret,
  encryptionKey: randomToken(),
  permissions: { 'bridge-user': ['work-orders:read', 'work-orders:create'] },
};
const runtimeConfig = {
  databaseUrl: process.env['GC_DATABASE_URL'],
  publicOrigin: 'http://127.0.0.1',
  loginUrl: 'http://qms.test/identity/authorize',
  identity: config,
};
const runtime = createRuntimeApp(runtimeConfig);

beforeAll(async () => {
  sql = await createConnection(process.env['QGS_IDENTITY_DATABASE_URL'] ?? '');
  await sql.execute(
    'INSERT INTO roles (id,name,updatedAt) VALUES (?,?,NOW())',
    ['bridge-role', 'isolated'],
  );
  await sql.execute(
    'INSERT INTO users (id,username,password,roleId,department,updatedAt) VALUES (?,?,?,?,?,NOW())',
    ['bridge-user', 'isolated-user', randomToken(), 'bridge-role', 'isolated'],
  );
});
afterAll(async () => {
  await runtime.database.close();
  await qmsDb.$disconnect();
  await sql.end();
  await new Promise<void>((r, j) => {
    server.close((e) => {
      if (e) j(e);
      else r();
    });
  });
});
async function authorize(target = bridge, change: Partial<Authorization> = {}) {
  const verifier = randomToken();
  const input: Authorization = {
    clientId: client.id,
    redirectUri: client.callback,
    state: randomToken(),
    challenge: challengeFor(verifier),
    method: 'S256',
    ...change,
  };
  const result = await target.authorize('bridge-user', input);
  return {
    code: new URL(result.callback).searchParams.get('code') ?? '',
    verifier,
    redirectUri: input.redirectUri,
  };
}

it('uses MySQL CAS for concurrent redemption, never issues two credentials and rejects replay', async () => {
  const input = await authorize();
  const attempts = await Promise.allSettled(
    Array.from({ length: 8 }, () => bridge.exchange(input)),
  );
  expect(attempts.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
  await expect(bridge.exchange(input)).rejects.toThrow();
  const [rows] = await sql.query(
    'SELECT COUNT(*) AS count FROM IdentityBridgeCredential',
  );
  expect(rows).toEqual([{ count: 1 }]);
});
it('rejects wrong client, callback and verifier without consuming the valid code, and expires codes', async () => {
  await expect(authorize(bridge, { clientId: 'wrong' })).rejects.toThrow();
  await expect(
    authorize(bridge, { redirectUri: `${client.callback}?next=evil` }),
  ).rejects.toThrow();
  const input = await authorize();
  expect(() => {
    authenticateClient(client, client.id, randomToken());
  }).toThrow();
  await expect(
    bridge.exchange({ ...input, verifier: randomToken() }),
  ).rejects.toThrow();
  await expect(
    bridge.exchange({ ...input, redirectUri: 'http://evil.test' }),
  ).rejects.toThrow();
  const other = createIdentityBridge(qmsDb, { ...client, id: 'other' });
  await expect(other.exchange(input)).rejects.toThrow();
  expect((await bridge.exchange(input)).credential).toHaveLength(43);
  const expired = await authorize();
  await sql.execute(
    'UPDATE IdentityBridgeCode SET expiresAt=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE consumedAt IS NULL',
  );
  await expect(bridge.exchange(expired)).rejects.toThrow();
});
it('checks ACTIVE and soft deletion directly, uses username fallback, and revokes credentials', async () => {
  const grant = await bridge.exchange(await authorize());
  expect(await bridge.identity(grant.credential)).toEqual({
    id: 'bridge-user',
    name: 'isolated-user',
    active: true,
  });
  await sql.execute(
    "UPDATE users SET status='INACTIVE' WHERE id='bridge-user'",
  );
  await expect(bridge.identity(grant.credential)).rejects.toThrow();
  await expect(authorize()).rejects.toThrow();
  await sql.execute(
    "UPDATE users SET status='ACTIVE', isDeleted=1 WHERE id='bridge-user'",
  );
  await expect(bridge.identity(grant.credential)).rejects.toThrow();
  await sql.execute("UPDATE users SET isDeleted=0 WHERE id='bridge-user'");
  await bridge.revoke(grant.credential);
  await expect(bridge.identity(grant.credential)).rejects.toThrow();
});

it('rolls redemption back when credential persistence fails and enforces credential expiry', async () => {
  const input = await authorize();
  await sql.query(
    'RENAME TABLE IdentityBridgeCredential TO IdentityBridgeCredential_unavailable',
  );
  try {
    await expect(bridge.exchange(input)).rejects.toThrow();
  } finally {
    await sql.query(
      'RENAME TABLE IdentityBridgeCredential_unavailable TO IdentityBridgeCredential',
    );
  }
  const grant = await bridge.exchange(input);
  await sql.execute(
    'UPDATE IdentityBridgeCredential SET expiresAt=DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE revokedAt IS NULL',
  );
  await expect(bridge.identity(grant.credential)).rejects.toThrow();
});
async function login(api = runtime.app, oldCookie = '') {
  const start = await api.request('/api/auth/login', {
    headers: { Cookie: oldCookie },
  });
  const flowCookie = start.headers.get('set-cookie')?.split(';')[0] ?? '';
  const query = new URL(start.headers.get('location') ?? '').searchParams;
  const grant = await bridge.authorize('bridge-user', {
    clientId: client.id,
    redirectUri: client.callback,
    challenge: query.get('challenge') ?? '',
    method: 'S256',
    state: query.get('state') ?? '',
  });
  const callback = await api.request(grant.callback, {
    headers: { Cookie: `${flowCookie}; ${oldCookie}` },
  });
  const cookie =
    callback.headers
      .getSetCookie()
      .find((v) => v.startsWith('gc-session=') && !v.includes('Max-Age=0'))
      ?.split(';')[0] ?? '';
  return { start, callback, cookie, flowCookie, grant };
}
it('binds state to an encrypted HttpOnly Lax flow, rotates persistent sessions and enforces explicit local permissions', async () => {
  const signed = await login();
  expect(signed.start.headers.get('set-cookie')).toContain('HttpOnly');
  expect(signed.start.headers.get('set-cookie')).toContain('SameSite=Lax');
  expect(signed.callback.status).toBe(303);
  expect(signed.cookie).toMatch(/^gc-session=[\w-]{43}$/);
  const headers = { Cookie: signed.cookie };
  expect(
    (await runtime.app.request('/api/work-orders', { headers })).status,
  ).toBe(200);
  const session = await runtime.app.request('/api/session', { headers });
  expect(await session.text()).toContain('isolated-user');
  const stored = await runtime.database.client.identitySession.findMany();
  expect(
    stored.some(
      (v) =>
        signed.cookie.includes(v.idHash) || /^[\w-]{43}$/.test(v.credential),
    ),
  ).toBe(false);
  const restricted = persistentIdentity(
    runtime.database.client,
    runtimeConfig,
    { ...config, permissions: {} },
  );
  expect(
    (
      await restricted.identity.resolve(
        new Request('http://gc.test', { headers }),
      )
    )?.permissions,
  ).toEqual([]);
  const replay = await runtime.app.request(signed.grant.callback, {
    headers: { Cookie: signed.flowCookie },
  });
  expect(replay.status).toBe(403);
  const wrong = new URL(signed.grant.callback);
  wrong.searchParams.set('state', randomToken());
  expect(
    (
      await runtime.app.request(wrong.href, {
        headers: { Cookie: signed.flowCookie },
      })
    ).status,
  ).toBe(403);
});
it('returns 503 on upstream outage, rejects the next request after disable, and logs out locally even when revoke fails', async () => {
  const signed = await login();
  const headers = { Cookie: signed.cookie, Origin: runtimeConfig.publicOrigin };
  outage = true;
  expect((await runtime.app.request('/api/session', { headers })).status).toBe(
    503,
  );
  expect(
    (
      await runtime.app.request('/api/auth/logout', {
        method: 'POST',
        headers: { ...headers, Origin: 'http://evil.test' },
      })
    ).status,
  ).toBe(403);
  const logout = await runtime.app.request('/api/auth/logout', {
    method: 'POST',
    headers,
  });
  expect(logout.status).toBe(200);
  expect(await logout.text()).toContain('"upstreamRevoked":false');
  expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
  outage = false;
  const session = await runtime.app.request('/api/session', { headers });
  expect(await session.text()).toContain('"principal":null');
  const active = await login();
  await sql.execute(
    "UPDATE users SET status='INACTIVE' WHERE id='bridge-user'",
  );
  expect(
    (
      await runtime.app.request('/api/work-orders', {
        headers: { Cookie: active.cookie },
      })
    ).status,
  ).toBe(403);
  await sql.execute("UPDATE users SET status='ACTIVE' WHERE id='bridge-user'");
});

it('preserves the retry cookie when local revocation fails and revokes orphan grants after failed persistence', async () => {
  const signed = await login();
  const gcSql = await createConnection(runtimeConfig.databaseUrl);
  const headers = { Cookie: signed.cookie, Origin: runtimeConfig.publicOrigin };
  await gcSql.query(
    'RENAME TABLE IdentitySession TO IdentitySession_unavailable',
  );
  try {
    const failed = await runtime.app.request('/api/auth/logout', {
      method: 'POST',
      headers,
    });
    expect(failed.status).toBe(503);
    expect(failed.headers.getSetCookie()).toHaveLength(0);
    const before = await sql.query(
      'SELECT COUNT(*) AS count FROM IdentityBridgeCredential WHERE revokedAt IS NOT NULL',
    );
    const failedCallback = await login();
    expect(failedCallback.callback.status).toBe(503);
    const after = await sql.query(
      'SELECT COUNT(*) AS count FROM IdentityBridgeCredential WHERE revokedAt IS NOT NULL',
    );
    expect(JSON.stringify(after[0])).not.toBe(JSON.stringify(before[0]));
  } finally {
    await gcSql.query(
      'RENAME TABLE IdentitySession_unavailable TO IdentitySession',
    );
    await gcSql.end();
  }
  expect(
    (await runtime.app.request('/api/work-orders', { headers })).status,
  ).toBe(200);
  expect(
    (await runtime.app.request('/api/auth/logout', { method: 'POST', headers }))
      .status,
  ).toBe(200);
  expect(
    (await runtime.app.request('/api/work-orders', { headers })).status,
  ).toBe(403);
});

it('revokes a newly issued grant when exactly create fails, and rotates away the previous session', async () => {
  const before = await sql.query(
    'SELECT COUNT(*) AS count FROM IdentityBridgeCredential WHERE revokedAt IS NOT NULL',
  );
  const originalCreate = runtime.database.client.identitySession.create.bind(
    runtime.database.client.identitySession,
  );
  const create = vi
    .spyOn(runtime.database.client.identitySession, 'create')
    .mockRejectedValueOnce(new Error('injected persistence failure'));
  try {
    const failed = await login();
    expect(failed.callback.status).toBe(503);
    expect(create).toHaveBeenCalledTimes(1);
    expect(
      failed.callback.headers
        .getSetCookie()
        .some((value) => /^gc-session=[\w-]{43};/.test(value)),
    ).toBe(false);
  } finally {
    create.mockRestore();
    runtime.database.client.identitySession.create = originalCreate;
  }
  const after = await sql.query(
    'SELECT COUNT(*) AS count FROM IdentityBridgeCredential WHERE revokedAt IS NOT NULL',
  );
  expect(JSON.stringify(after[0])).not.toBe(JSON.stringify(before[0]));
  const old = await login();
  expect(old.callback.status).toBe(303);
  const replacement = await login(runtime.app, old.cookie);
  expect(replacement.callback.status).toBe(303);
  expect(replacement.cookie).not.toBe(old.cookie);
  expect(
    (
      await runtime.app.request('/api/work-orders', {
        headers: { Cookie: old.cookie },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await runtime.app.request('/api/work-orders', {
        headers: { Cookie: replacement.cookie },
      })
    ).status,
  ).toBe(200);
});
