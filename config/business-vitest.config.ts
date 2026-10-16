import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    allowOnly: false,
    passWithNoTests: false,
    // Suites share one task-owned MySQL schema, so files run sequentially.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
