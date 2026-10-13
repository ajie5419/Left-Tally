import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { files } from './files.mjs';

const candidates = [
  'apps/api/prisma/schema.prisma',
  'apps/api/prisma/migrations',
];
if (
  files(['apps', 'packages'], ['.prisma']).length > 0 ||
  candidates.some((path) => existsSync(path)) ||
  existsSync('config/previous-delivery.json')
) {
  console.error(
    'MIGRATION_UNVERIFIED: schema or previous delivery exists; BOOTSTRAP applicability is no longer sufficient',
  );
  process.exitCode = 1;
} else {
  // This is an applicability check, never a claim of successful migration.
  console.log(
    JSON.stringify(
      {
        phase: 'BOOTSTRAP',
        applicability: 'INITIAL_NO_SCHEMA_NO_PREVIOUS_DELIVERY',
        schemaFound: false,
        previousDeliveryFound: false,
        migrationExecuted: false,
        uncovered: [
          'empty business schema',
          'upgrade',
          'drift',
          'historical migration integrity',
        ],
        root: resolve('.'),
        packages: readdirSync('packages'),
      },
      null,
      2,
    ),
  );
}
