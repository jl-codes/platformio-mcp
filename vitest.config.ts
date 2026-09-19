import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup-isolation.ts"],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', 'web/**'],
    fileParallelism: false,
  },
});
