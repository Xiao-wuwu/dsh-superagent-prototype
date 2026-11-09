import { defineConfig } from 'vitest/config'
// Share one React instance across DSH client packages and tests.
export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  // The Source tests replay dozens of poll rounds with real timers; a Windows runner needs more than the 5 s default,
  // and the required CI check must not flake on that.
  test: { include: ['tests/**/*.spec.{ts,tsx}'], testTimeout: 20_000 },
})
