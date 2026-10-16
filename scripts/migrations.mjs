import { readFileSync } from 'node:fs';
import { withBusinessDatabase } from './business-database.mjs';
import {
  migrateBusinessDatabase,
  writeMigrationReport,
  migrationHash,
  assertBusinessSchema,
} from './business-migrations.mjs';
import { createConnection } from 'mysql2/promise';

await withBusinessDatabase(async (url) => {
  migrateBusinessDatabase(url);
  migrateBusinessDatabase(url);
  const connection = await createConnection(url);
  try {
    const [rows] = await connection.query(
      'SELECT checksum, finished_at FROM _prisma_migrations WHERE migration_name = ?',
      ['202610150001_work_order_links'],
    );
    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      rows[0].checksum !== migrationHash() ||
      !rows[0].finished_at
    )
      throw new Error('MIGRATION_HISTORY_MISMATCH');
    const [localHistory] = await connection.query(
      'SELECT checksum, finished_at FROM _prisma_migrations WHERE migration_name = ?',
      ['202610150002_local_work_orders'],
    );
    if (
      !Array.isArray(localHistory) ||
      localHistory.length !== 1 ||
      localHistory[0].checksum !==
        migrationHash(
          'apps/api/prisma/migrations/202610150002_local_work_orders/migration.sql',
        ) ||
      !localHistory[0].finished_at
    )
      throw new Error('LOCAL_MIGRATION_HISTORY_MISMATCH');
    const [assignmentHistory] = await connection.query(
      'SELECT checksum, finished_at FROM _prisma_migrations WHERE migration_name = ?',
      ['202610150003_defer_production_assignment'],
    );
    if (
      !Array.isArray(assignmentHistory) ||
      assignmentHistory.length !== 1 ||
      assignmentHistory[0].checksum !==
        migrationHash(
          'apps/api/prisma/migrations/202610150003_defer_production_assignment/migration.sql',
        ) ||
      !assignmentHistory[0].finished_at
    )
      throw new Error('ASSIGNMENT_MIGRATION_HISTORY_MISMATCH');
    const [columns] = await connection.query('SHOW COLUMNS FROM WorkOrderLink');
    if (!Array.isArray(columns) || columns.length !== 5)
      throw new Error('BUSINESS_SCHEMA_MISMATCH');
    const [localColumns] = await connection.query(
      'SHOW COLUMNS FROM WorkOrder',
    );
    if (!Array.isArray(localColumns) || localColumns.length !== 10)
      throw new Error('LOCAL_WORK_ORDER_SCHEMA_MISMATCH');
    if (
      localColumns.find((column) => column.Field === 'productionLeadId')
        ?.Null !== 'YES'
    )
      throw new Error('PRODUCTION_ASSIGNMENT_MUST_BE_NULLABLE');
    const [count] = await connection.query(
      'SELECT COUNT(*) AS total FROM WorkOrderLink',
    );
    if (count[0].total !== 0)
      throw new Error('INITIAL_MIGRATION_CREATED_BUSINESS_RECORDS');
    const [localCount] = await connection.query(
      'SELECT COUNT(*) AS total FROM WorkOrder',
    );
    if (localCount[0].total !== 0)
      throw new Error('MIGRATION_CREATED_LOCAL_ORDERS');
    const schema = readFileSync('apps/api/prisma/schema.prisma', 'utf8');
    if (!schema.includes('model WorkOrderLink'))
      throw new Error('BUSINESS_SCHEMA_MISSING');
  } finally {
    await connection.end();
  }
  assertBusinessSchema(url);
  writeMigrationReport();
});
