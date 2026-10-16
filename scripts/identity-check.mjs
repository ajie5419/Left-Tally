import { spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createConnection } from 'mysql2/promise';
import { withBusinessDatabase } from './business-database.mjs';
import {
  migrateBusinessDatabase,
  assertBusinessSchema,
} from './business-migrations.mjs';

const qms = resolve(process.env.GC_IDENTITY_QMS_ROOT ?? '../Quality-Guardian');
const require = createRequire(join(qms, 'apps/backend/package.json'));
const directory = mkdtempSync(join(tmpdir(), 'gc-identity-check-'));
copyFileSync(
  join(qms, 'apps/backend/prisma/schema.prisma'),
  join(directory, 'schema.prisma'),
);
writeFileSync(join(directory, 'package.json'), '{"private":true}');
symlinkSync(
  join(qms, 'apps/backend/node_modules'),
  join(directory, 'node_modules'),
);
const clean = Object.fromEntries(
  ['PATH', 'HOME', 'TMPDIR', 'LANG'].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]]] : [],
  ),
);
await withBusinessDatabase(async (url) => {
  migrateBusinessDatabase(url);
  assertBusinessSchema(url);
  const connection = await createConnection(url);
  await connection.query('CREATE DATABASE qms_identity CHARACTER SET utf8mb4');
  await connection.end();
  const qmsUrl = url.replace('/gc_b01', '/qms_identity');
  const schema = spawnSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'db',
      'push',
      '--schema',
      'schema.prisma',
      '--skip-generate',
    ],
    {
      cwd: directory,
      encoding: 'utf8',
      env: { ...clean, DATABASE_URL: qmsUrl },
      timeout: 120_000,
    },
  );
  if (schema.status !== 0)
    throw new Error(`IDENTITY_SCHEMA_FAILED exit=${schema.status}`);
  const result = spawnSync(
    'rtk',
    [
      'vitest',
      'run',
      'tests/identity',
      '--config',
      'config/identity-vitest.config.ts',
      '--reporter=verbose',
    ],
    {
      stdio: 'inherit',
      timeout: 120_000,
      env: {
        ...clean,
        GC_DATABASE_URL: url,
        QGS_IDENTITY_DATABASE_URL: qmsUrl,
        GC_IDENTITY_QMS_ROOT: qms,
      },
    },
  );
  if (result.status !== 0)
    throw new Error(`IDENTITY_INTEGRATION_FAILED exit=${result.status}`);
});
