import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['tests/diagnostics/workspace-directory-replacement.test.ts'], testTimeout: 15000 } })
