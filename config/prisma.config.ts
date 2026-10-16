import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: '../apps/api/prisma/schema.prisma',
  migrations: { path: '../apps/api/prisma/migrations' },
  datasource: { url: process.env['GC_DATABASE_URL'] ?? '' },
});
