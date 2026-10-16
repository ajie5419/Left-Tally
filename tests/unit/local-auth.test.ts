import { describe, expect, it } from 'vitest';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  hashSessionToken,
  normalizeUsername,
  randomSessionToken,
  verifyPassword,
} from '../../apps/api/src/accounts/crypto.js';
import { LoginThrottle } from '../../apps/api/src/accounts/service.js';

describe('local account primitives', () => {
  it('normalizes ASCII usernames and verifies only a complete scrypt hash', async () => {
    expect(normalizeUsername('Admin.User')).toBe('admin.user');
    const password = 'unit-password-123';
    const hash = await hashPassword(password);
    expect(hash).not.toContain(password);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword(`${password} `, hash)).resolves.toBe(false);
    await expect(verifyPassword(password, 'scrypt$broken')).resolves.toBe(
      false,
    );
    await expect(verifyPassword(password, DUMMY_PASSWORD_HASH)).resolves.toBe(
      false,
    );
  });

  it('stores only stable SHA-256 session token hashes', () => {
    const token = randomSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashSessionToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSessionToken(token)).not.toContain(token);
  });

  it('bounds repeated failures per process and releases them after its interval', () => {
    let now = 0;
    const throttle = new LoginThrottle(() => now, 2, 1_000);
    expect(throttle.allowed('reader')).toBe(true);
    throttle.failed('reader');
    throttle.failed('reader');
    expect(throttle.allowed('reader')).toBe(false);
    now = 1_000;
    expect(throttle.allowed('reader')).toBe(true);
  });
});
