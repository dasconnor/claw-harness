import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    clearMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    testTimeout: 10_000,
  },
})
