import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  accountSchema,
  failureResponseSchema,
  successResponseSchema,
} from '@gc/contracts';
import {
  LocalAccounts,
  SESSION_LIFETIME_MS,
} from '../../apps/api/src/accounts/service.js';
import { createRuntimeApp } from '../../apps/api/src/runtime.js';

const databaseUrl = process.env['GC_DATABASE_URL'];
if (!databaseUrl) throw new Error('Task-owned database required');
const origin = 'http://gc.local.test';
const runtime = createRuntimeApp({
  databaseUrl,
  publicOrigin: origin,
  insecureCookiesForTesting: true,
});
const accounts = new LocalAccounts(runtime.database.client);
const password = 'isolated-password-123';
let bootstrapId = '';

function cookie(response: Response) {
  const value = response.headers.get('set-cookie')?.split(';')[0];
  if (!value) throw new Error('SESSION_COOKIE_MISSING');
  return value;
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  session?: string,
) {
  return runtime.app.request(`${origin}/api${path}`, {
    method,
    headers: {
      ...(method !== 'GET'
        ? { Origin: origin, 'Content-Type': 'application/json' }
        : {}),
      ...(session ? { Cookie: session } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function login(username: string, value: string) {
  return request('/auth/login', 'POST', { username, password: value });
}

function pauseLoginSnapshot(username: string) {
  const seen = deferred();
  const release = deferred();
  const racingAccounts = new LocalAccounts(
    runtime.database.client,
    Date.now,
    undefined,
    {
      onLoginAccountLoaded: async (account) => {
        if (account?.username === username) {
          seen.resolve();
          await release.promise;
        }
      },
    },
  );
  return { seen, release, racingAccounts };
}

beforeAll(async () => {
  await runtime.database.client.localSession.deleteMany();
  await runtime.database.client.localAccount.deleteMany();
  await runtime.database.client.workOrder.deleteMany();
  bootstrapId = (
    await accounts.create({
      username: 'bootstrap-admin',
      name: 'Bootstrap Admin',
      password,
      permissions: ['work-orders:read', 'work-orders:create'],
      accountAdmin: true,
    })
  ).id;
});
afterAll(async () => runtime.database.close());

describe('GC local accounts and sessions', () => {
  it('uses local credentials, rejects bad credentials and enforces exact Origin', async () => {
    const blocked = await runtime.app.request(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        Origin: 'http://attacker.test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'bootstrap-admin', password }),
    });
    expect(blocked.status).toBe(403);
    const wrong = await login('bootstrap-admin', 'wrong-password-123');
    expect(wrong.status).toBe(403);
    expect(failureResponseSchema.parse(await wrong.json()).message).toBe(
      '用户名或密码不正确，请重试',
    );
    const signedIn = await login('bootstrap-admin', password);
    expect(signedIn.status).toBe(200);
    expect(cookie(signedIn)).toMatch(/^gc-session=/);
    expect(signedIn.headers.get('set-cookie')).toContain('HttpOnly');
    expect(signedIn.headers.get('set-cookie')).toContain('SameSite=Lax');
  });

  it('persists account and creator writes, then immediately applies permission and admin changes', async () => {
    const adminSession = cookie(await login('bootstrap-admin', password));
    const created = await request(
      '/accounts',
      'POST',
      {
        username: 'reader',
        name: 'Read Only',
        password,
        permissions: ['work-orders:read'],
        accountAdmin: false,
      },
      adminSession,
    );
    expect(created.status).toBe(201);
    const reader = accountSchema.parse(
      successResponseSchema(accountSchema).parse(await created.json()).data,
    );
    expect(
      await runtime.database.client.localAccount.findUnique({
        where: { id: reader.id },
      }),
    ).toMatchObject({ username: 'reader', accountAdmin: false, canRead: true });
    expect(
      (
        await request(
          '/accounts',
          'POST',
          {
            username: 'reader',
            name: 'Duplicate',
            password,
            permissions: [],
            accountAdmin: false,
          },
          adminSession,
        )
      ).status,
    ).toBe(409);
    const readerSession = cookie(await login('reader', password));
    expect(
      (await request('/accounts', 'GET', undefined, readerSession)).status,
    ).toBe(403);
    expect(
      (
        await request(
          '/work-orders',
          'POST',
          {
            number: 'LOCAL-AUTH-DENIED',
            customer: 'Customer',
            quantity: 1,
            dueDate: '2026-12-01',
          },
          readerSession,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/accounts/${reader.id}/permissions`,
          'PUT',
          {
            permissions: ['work-orders:create'],
            accountAdmin: true,
          },
          adminSession,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request('/work-orders', 'GET', undefined, readerSession)).status,
    ).toBe(403);
    const creatorSession = cookie(await login('reader', password));
    expect(
      (await request('/accounts', 'GET', undefined, creatorSession)).status,
    ).toBe(200);
    expect(
      (
        await request(
          '/work-orders',
          'POST',
          {
            number: 'LOCAL-AUTH-CREATED',
            customer: 'Customer',
            quantity: 1,
            dueDate: '2026-12-01',
          },
          creatorSession,
        )
      ).status,
    ).toBe(201);
    expect(
      await runtime.database.client.workOrder.findUnique({
        where: { number: 'LOCAL-AUTH-CREATED' },
      }),
    ).toMatchObject({ createdBy: reader.id, quantity: 1 });
    expect(
      (
        await request(
          `/accounts/${reader.id}/permissions`,
          'PUT',
          { permissions: ['work-orders:read'], accountAdmin: false },
          adminSession,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request('/accounts', 'GET', undefined, creatorSession)).status,
    ).toBe(403);
    const revokedSession = cookie(await login('reader', password));
    expect(
      (await request('/accounts', 'GET', undefined, revokedSession)).status,
    ).toBe(403);
    expect(
      (
        await request(
          '/work-orders',
          'POST',
          {
            number: 'LOCAL-AUTH-REVOKED',
            customer: 'Customer',
            quantity: 1,
            dueDate: '2026-12-01',
          },
          revokedSession,
        )
      ).status,
    ).toBe(403);
  });

  it('rotates sessions and expires a persisted session at its documented boundary', async () => {
    let now = 1_000;
    const temporal = new LocalAccounts(runtime.database.client, () => now);
    await temporal.create({
      username: 'rotation-user',
      name: 'Rotation User',
      password,
      permissions: ['work-orders:read'],
      accountAdmin: false,
    });
    const first = await temporal.login('rotation-user', password);
    const second = await temporal.login('rotation-user', password);
    if (!first || !second) throw new Error('ROTATION_LOGIN_FAILED');
    expect(await temporal.resolve(first.token)).toBeNull();
    expect((await temporal.resolve(second.token))?.id).toBe(second.account.id);
    now += SESSION_LIFETIME_MS;
    expect(await temporal.resolve(second.token)).toBeNull();
    expect(
      await runtime.database.client.localSession.count({
        where: { accountId: second.account.id },
      }),
    ).toBe(0);
  });

  it('makes reset and disable win over a login that already read an old account snapshot', async () => {
    const resetTarget = await accounts.create({
      username: 'race-reset',
      name: 'Race Reset',
      password,
      permissions: ['work-orders:read'],
      accountAdmin: false,
    });
    const resetGate = pauseLoginSnapshot('race-reset');
    const pendingResetLogin = resetGate.racingAccounts.login(
      'race-reset',
      password,
    );
    await resetGate.seen.promise;
    await accounts.resetPassword(resetTarget.id, '{{SECRET_tp2wbf2m}}');
    resetGate.release.resolve();
    await expect(pendingResetLogin).resolves.toBeNull();

    const disableTarget = await accounts.create({
      username: 'race-disable',
      name: 'Race Disable',
      password,
      permissions: ['work-orders:read'],
      accountAdmin: false,
    });
    const disableGate = pauseLoginSnapshot('race-disable');
    const pendingDisableLogin = disableGate.racingAccounts.login(
      'race-disable',
      password,
    );
    await disableGate.seen.promise;
    await accounts.updateActive(disableTarget.id, { active: false });
    disableGate.release.resolve();
    await expect(pendingDisableLogin).resolves.toBeNull();
    expect(
      await runtime.database.client.localSession.count({
        where: { accountId: { in: [resetTarget.id, disableTarget.id] } },
      }),
    ).toBe(0);
  });

  it('revokes sessions on password reset and disable', async () => {
    const adminSession = cookie(await login('bootstrap-admin', password));
    const accountsResponse = successResponseSchema(accountSchema.array()).parse(
      await (await request('/accounts', 'GET', undefined, adminSession)).json(),
    );
    const reader = accountsResponse.data.find(
      (item) => item.username === 'reader',
    );
    if (!reader) throw new Error('READER_ACCOUNT_MISSING');
    const readerSession = cookie(await login('reader', password));
    const changedPassword = 'changed-password-123';
    expect(
      (
        await request(
          `/accounts/${reader.id}/reset-password`,
          'POST',
          { password: changedPassword },
          adminSession,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request('/work-orders', 'GET', undefined, readerSession)).status,
    ).toBe(403);
    expect((await login('reader', password)).status).toBe(403);
    const changedSession = cookie(await login('reader', changedPassword));
    expect(
      (
        await request(
          `/accounts/${reader.id}/active`,
          'PUT',
          { active: false },
          adminSession,
        )
      ).status,
    ).toBe(200);
    expect(
      (await request('/work-orders', 'GET', undefined, changedSession)).status,
    ).toBe(403);
  });

  it('keeps an active administrator under concurrent last-admin disable and demotion', async () => {
    const second = await accounts.create({
      username: 'second-admin',
      name: 'Second Admin',
      password,
      permissions: ['work-orders:read'],
      accountAdmin: true,
    });
    const disabled = await Promise.allSettled([
      accounts.updateActive(bootstrapId, { active: false }),
      accounts.updateActive(second.id, { active: false }),
    ]);
    expect(
      disabled.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const survivor = (await accounts.list()).find(
      (account) => account.active && account.accountAdmin,
    );
    if (!survivor) throw new Error('ADMIN_SURVIVOR_MISSING');
    const third = await accounts.create({
      username: 'third-admin',
      name: 'Third Admin',
      password,
      permissions: ['work-orders:read'],
      accountAdmin: true,
    });
    const demoted = await Promise.allSettled([
      accounts.updatePermissions(survivor.id, {
        permissions: ['work-orders:read'],
        accountAdmin: false,
      }),
      accounts.updatePermissions(third.id, {
        permissions: ['work-orders:read'],
        accountAdmin: false,
      }),
    ]);
    expect(
      demoted.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      (await accounts.list()).filter(
        (account) => account.active && account.accountAdmin,
      ),
    ).toHaveLength(1);
  });

  it('rejects malformed logout bodies, keeps the cookie after logout persistence failure and returns unavailable on resolution failure', async () => {
    const failureAdmin = await accounts.create({
      username: 'failure-admin',
      name: 'Failure Admin',
      password,
      permissions: ['work-orders:read'],
      accountAdmin: true,
    });
    const adminSession = cookie(await login('failure-admin', password));
    expect(
      (
        await request(
          '/auth/logout',
          'POST',
          { unexpected: true },
          adminSession,
        )
      ).status,
    ).toBe(400);
    const malformed = await runtime.app.request(`${origin}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Cookie: adminSession,
      },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    const deleteMany = runtime.database.client.localSession.deleteMany.bind(
      runtime.database.client.localSession,
    );
    const logoutFailure = vi
      .spyOn(runtime.database.client.localSession, 'deleteMany')
      .mockImplementation(deleteMany)
      .mockRejectedValueOnce(new Error('injected logout failure'));
    const failed = await request('/auth/logout', 'POST', {}, adminSession);
    expect(failed.status).toBe(503);
    expect(failed.headers.get('set-cookie')).toBeNull();
    const retried = await request('/auth/logout', 'POST', {}, adminSession);
    expect(retried.status).toBe(200);
    expect(retried.headers.get('set-cookie')).toContain('Max-Age=0');
    logoutFailure.mockRestore();

    const resolutionSession = cookie(await login('failure-admin', password));
    const resolutionFailure = vi
      .spyOn(runtime.database.client.localSession, 'findUnique')
      .mockRejectedValueOnce(new Error('injected resolution failure'));
    const unresolved = await runtime.app.request(`${origin}/api/session`, {
      headers: { Cookie: resolutionSession },
    });
    expect(unresolved.status).toBe(503);
    resolutionFailure.mockRestore();
    expect(failureAdmin.accountAdmin).toBe(true);
  });
});
