import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withBusinessDatabase } from './business-database.mjs';
import {
  assertBusinessSchema,
  migrateBusinessDatabase,
} from './business-migrations.mjs';

await withBusinessDatabase(async (url, evidenceDirectory) => {
  migrateBusinessDatabase(url);
  assertBusinessSchema(url);
  const result = spawnSync(
    'rtk',
    [
      'vitest',
      'run',
      'tests/integration/local-auth.test.ts',
      '--config',
      'config/local-auth-vitest.config.ts',
      '--reporter=verbose',
      '--reporter=json',
      '--outputFile',
      join(evidenceDirectory, 'local-auth-vitest.json'),
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, GC_DATABASE_URL: url },
    },
  );
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  writeFileSync(
    join(evidenceDirectory, 'local-auth-vitest.log'),
    `${stdout}${stderr}`,
  );
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  if (result.error)
    throw new Error(`LOCAL_AUTH_TEST_SPAWN_FAILED: ${result.error.message}`);
  if (result.signal)
    throw new Error(`LOCAL_AUTH_TEST_SIGNAL: ${result.signal}`);
  if (result.status !== 0)
    throw new Error(`LOCAL_AUTH_TEST_FAILED exit=${result.status}`);
});
