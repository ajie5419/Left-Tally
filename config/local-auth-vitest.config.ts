import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/local-auth.test.ts'],
    allowOnly: false,
    passWithNoTests: false,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
