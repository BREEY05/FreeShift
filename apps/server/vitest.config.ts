import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    env: {
      DATABASE_PATH: ':memory:',
      TZ: 'Asia/Shanghai',
    },
    testTimeout: 20000,
  },
});
