import { spawnSync } from 'node:child_process';
import { withBusinessDatabase } from './business-database.mjs';
import { migrateBusinessDatabase } from './business-migrations.mjs';

await withBusinessDatabase(async (url) => {
  migrateBusinessDatabase(url);
  migrateBusinessDatabase(url);
  const result = spawnSync(
    'rtk',
    [
      'vitest',
      'run',
      'tests/integration',
      '--config',
      'config/business-vitest.config.ts',
    ],
    {
      stdio: 'inherit',
      timeout: 60_000,
      env: { ...process.env, GC_DATABASE_URL: url },
    },
  );
  if (result.status !== 0)
    throw new Error(`BUSINESS_INTEGRATION_FAILED exit=${result.status}`);
});
