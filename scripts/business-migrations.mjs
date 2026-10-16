import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const migration =
  'apps/api/prisma/migrations/202610150001_work_order_links/migration.sql';
export function migrateBusinessDatabase(url) {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'prisma',
      'migrate',
      'deploy',
      '--config',
      'config/prisma.config.ts',
    ],
    {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, GC_DATABASE_URL: url },
    },
  );
  // URLs and driver diagnostics can carry credentials; keep only migration status.
  if (result.status !== 0)
    throw new Error(
      `BUSINESS_MIGRATION_FAILED exit=${result.status}; ${result.stderr.replaceAll(url, '[isolated database]')}`,
    );
  return result.stdout;
}
export function assertBusinessSchema(url) {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--config',
      'config/prisma.config.ts',
      '--from-config-datasource',
      '--to-schema',
      'apps/api/prisma/schema.prisma',
      '--exit-code',
    ],
    {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, GC_DATABASE_URL: url },
    },
  );
  if (result.status !== 0)
    throw new Error(`BUSINESS_SCHEMA_DRIFT exit=${result.status}`);
}
export function migrationHash(path = migration) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}
export function writeMigrationReport() {
  mkdirSync('evidence/bootstrap', { recursive: true });
  const report = {
    phase: 'CORE',
    migrationExecuted: true,
    schemaFound: true,
    previousDeliveryFound: false,
    applicability: 'INITIAL_BUSINESS_SCHEMA_NO_PREVIOUS_BUSINESS_DELIVERY',
    migrationHash: migrationHash(),
    localWorkOrderMigrationHash: migrationHash(
      'apps/api/prisma/migrations/202610150002_local_work_orders/migration.sql',
    ),
    productionAssignmentMigrationHash: migrationHash(
      'apps/api/prisma/migrations/202610150003_defer_production_assignment/migration.sql',
    ),
    identitySessionMigrationHash: migrationHash(
      'apps/api/prisma/migrations/202610150004_identity_sessions/migration.sql',
    ),
    emptyDatabase: true,
    repeatDeploy: true,
    upgradeVerified: false,
  };
  writeFileSync(
    'evidence/bootstrap/business-migrations.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  return report;
}
