import { log } from 'node:console'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, mergeConfig } from 'vitest/config'
import backendConfig from './vitest.backend.config'

const localDirectory = resolve('.local')
mkdirSync(localDirectory, { recursive: true })
const stageDirectory = mkdtempSync(resolve(localDirectory, 'backend-stages-'))
log(`Backend stage records: ${stageDirectory}`)

export default mergeConfig(backendConfig, defineConfig({
  test: {
    setupFiles: ['./diagnostics/backend-stages.mjs'],
    env: { PERSONA_BACKEND_STAGE_DIR: stageDirectory }
  }
}))
