import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['tests/real/**/*.test.ts'], testTimeout: 300000, hookTimeout: 15000, fileParallelism: false } })
