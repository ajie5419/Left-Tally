import { randomBytes, randomUUID, scrypt } from 'node:crypto';
import { createConnection } from 'mariadb';
import { promisify } from 'node:util';
import { publicInput, secret } from './bootstrap-admin-input.mjs';

const usernamePattern = /^[A-Za-z0-9._-]{3,64}$/;

const derivePassword = promisify(scrypt);

async function passwordHash(password) {
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt, 64, {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  });
  return `scrypt$16384$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

const url = process.env.GC_DATABASE_URL;
if (!url) throw new Error('BOOTSTRAP_DATABASE_REQUIRED');
const { username, name } = await publicInput(process.stdin, process.stdout);
const password = await secret(process.stdin, process.stdout);
if (!usernamePattern.test(username) || !name || name.length > 128)
  throw new Error('BOOTSTRAP_INPUT_INVALID');
if (password.length < 12 || password.length > 128)
  throw new Error('BOOTSTRAP_PASSWORD_INVALID');
const target = new URL(url);
if (target.protocol !== 'mysql:') throw new Error('BOOTSTRAP_DATABASE_INVALID');
let connection;
try {
  connection = await createConnection({
    host: target.hostname,
    port: Number(target.port || '3306'),
    user: decodeURIComponent(target.username),
    password: decodeURIComponent(target.password),
    database: target.pathname.slice(1),
  });
  await connection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  await connection.beginTransaction();
  const admins = await connection.query(
    'SELECT id FROM LocalAccount WHERE active=1 AND accountAdmin=1 FOR UPDATE',
  );
  if (admins.length !== 0) throw new Error('BOOTSTRAP_ADMIN_EXISTS');
  await connection.query(
    'INSERT INTO LocalAccount (id, username, usernameNormalized, name, passwordHash, canRead, canCreate, accountAdmin, active, authVersion, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, 1, 1, 1, 0, NOW(3), NOW(3))',
    [
      randomUUID(),
      username,
      username.normalize('NFKC').toLowerCase(),
      name,
      await passwordHash(password),
    ],
  );
  await connection.commit();
  console.log('Bootstrap administrator created.');
} catch (error) {
  try {
    await connection?.rollback();
  } catch {
    // A failed rollback must not disclose connection or driver diagnostics.
  }
  if (error instanceof Error && error.message === 'BOOTSTRAP_ADMIN_EXISTS')
    throw error;
  throw new Error('BOOTSTRAP_DATABASE_OPERATION_FAILED');
} finally {
  await connection?.end();
}
