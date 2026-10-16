import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

export const randomToken = () => randomBytes(32).toString('base64url');
export const hashToken = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const challengeFor = (value: string) =>
  createHash('sha256').update(value).digest('base64url');

/** Separate authenticated contexts prevent a flow cookie being used as a stored credential. */
export function identityCipher(key: string) {
  const bytes = Buffer.from(key, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== key)
    throw new Error('IDENTITY_KEY_INVALID');
  return {
    seal(value: string, purpose: 'flow' | 'credential') {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', bytes, nonce);
      cipher.setAAD(Buffer.from(`gc-identity-v1:${purpose}`));
      const content = Buffer.concat([
        cipher.update(value, 'utf8'),
        cipher.final(),
      ]);
      return Buffer.concat([nonce, cipher.getAuthTag(), content]).toString(
        'base64url',
      );
    },
    open(value: string, purpose: 'flow' | 'credential') {
      if (value.length > 4096) throw new Error('IDENTITY_CIPHERTEXT_INVALID');
      const buffer = Buffer.from(value, 'base64url');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        bytes,
        buffer.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(`gc-identity-v1:${purpose}`));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([
        decipher.update(buffer.subarray(28)),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
