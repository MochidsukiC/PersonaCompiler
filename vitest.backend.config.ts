import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['tests/backend/**/*.test.ts'], testTimeout: 20000, hookTimeout: 15000 } })
