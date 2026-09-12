import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['tests/connection/**/*.test.ts'], testTimeout: 60000, hookTimeout: 15000, fileParallelism: false } })
