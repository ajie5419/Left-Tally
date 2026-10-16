import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '~': resolve(
        process.env['GC_IDENTITY_QMS_ROOT'] ?? '../Quality-Guardian',
        'apps/backend',
      ),
    },
  },
  test: {
    include: ['tests/identity/**/*.test.ts'],
    allowOnly: false,
    passWithNoTests: false,
    testTimeout: 30_000,
  },
});
