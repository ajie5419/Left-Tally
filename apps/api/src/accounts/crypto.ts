import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';

const SCRYPT_OPTIONS = Object.freeze({
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
});
const PASSWORD_BYTES = 64;

function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, PASSWORD_BYTES, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Usernames are deliberately ASCII identifiers, so normalization is stable across clients. */
export function normalizeUsername(value: string) {
  return value.normalize('NFKC').toLowerCase();
}

/** Password text is used byte-for-byte: callers must never trim or normalize it. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await derive(password, salt);
  return `scrypt$16384$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string) {
  try {
    const [algorithm, cost, saltText, valueText, extra] = encoded.split('$');
    if (
      algorithm !== 'scrypt' ||
      cost !== '16384' ||
      !saltText ||
      !valueText ||
      extra !== undefined
    )
      return false;
    const expected = Buffer.from(valueText, 'base64url');
    if (expected.length !== PASSWORD_BYTES) return false;
    const derived = await derive(password, Buffer.from(saltText, 'base64url'));
    return timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export function randomSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
