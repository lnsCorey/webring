import { defineConfig } from 'vitest/config';

// Load tests only (`npm run loadtest:sync`); `npm test` doesn't pick up *.load.ts files.
export default defineConfig({
  test: {
    include: ['tests/load/**/*.load.ts'],
    testTimeout: 4 * 60 * 60 * 1000,
    hookTimeout: 60 * 1000,
    disableConsoleIntercept: true,
  },
});
