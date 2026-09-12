import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['tests/persistence/**/*.test.ts'], testTimeout: 120000, hookTimeout: 15000, fileParallelism: false } })
