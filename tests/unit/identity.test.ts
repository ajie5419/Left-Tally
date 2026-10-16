import { randomBytes } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  identityCipher,
  randomToken,
  challengeFor,
} from '../../apps/api/src/identity/crypto.js';
import {
  qmsIdentity,
  InvalidIdentity,
} from '../../apps/api/src/identity/upstream.js';

const config = {
  qmsOrigin: 'https://qms.example.test',
  clientId: 'gc',
  clientSecret: randomToken(),
  encryptionKey: randomToken(),
  permissions: {},
};
afterEach(() => vi.unstubAllGlobals());

it('authenticates encrypted values and separates flow and credential contexts', () => {
  const cipher = identityCipher(randomBytes(32).toString('base64url'));
  const value = cipher.seal('opaque-credential', 'credential');
  expect(value).not.toContain('opaque-credential');
  expect(cipher.open(value, 'credential')).toBe('opaque-credential');
  expect(() => cipher.open(value, 'flow')).toThrow();
  const corrupted =
    value[0] === 'A' ? `B${value.slice(1)}` : `A${value.slice(1)}`;
  expect(() => cipher.open(corrupted, 'credential')).toThrow();
  expect(() => identityCipher('invalid')).toThrow();
  expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
    'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  );
});

it('sends only dedicated credentials to fixed endpoints with redirects disabled and a deadline', async () => {
  const fetch = vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          code: 0,
          data: { id: 'u', name: 'User', active: true },
          error: null,
          message: 'ok',
        }),
      ),
    ),
  );
  vi.stubGlobal('fetch', fetch);
  expect(await qmsIdentity(config).identity(randomToken())).toEqual({
    id: 'u',
    name: 'User',
    active: true,
  });
  expect(fetch.mock.calls[0]).toMatchObject([
    'https://qms.example.test/api/identity-bridge/identity',
    { redirect: 'error', method: 'POST' },
  ]);
});

it('distinguishes invalid identity from outages and rejects permissive or stale payloads', async () => {
  for (const status of [401, 403]) {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status })));
    await expect(
      qmsIdentity(config).identity(randomToken()),
    ).rejects.toBeInstanceOf(InvalidIdentity);
  }
  for (const response of [
    new Response('', { status: 503 }),
    new Response(
      JSON.stringify({
        code: 0,
        data: { id: 'u', name: 'User', active: false },
        error: null,
        message: 'ok',
      }),
    ),
    new Response(
      JSON.stringify({
        code: 0,
        data: { id: 'u', name: 'User', active: true, password: 'forbidden' },
        error: null,
        message: 'ok',
      }),
    ),
    new Response(
      JSON.stringify({ data: { id: 'u', name: 'User', active: true } }),
    ),
  ]) {
    vi.stubGlobal('fetch', () => Promise.resolve(response));
    await expect(
      qmsIdentity(config).identity(randomToken()),
    ).rejects.not.toBeInstanceOf(InvalidIdentity);
  }
});
