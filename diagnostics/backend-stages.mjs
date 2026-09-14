import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest'

const directory = process.env.PERSONA_BACKEND_STAGE_DIR
if (!directory) throw new Error('Backend stage recording requires PERSONA_BACKEND_STAGE_DIR')
const path = join(directory, `${process.pid}-${randomUUID()}.jsonl`)
let sequence = 0

function record(phase) {
  const state = expect.getState()
  appendFileSync(path, `${JSON.stringify({
    version: 1,
    sequence: ++sequence,
    timestamp: new Date().toISOString(),
    pid: process.pid,
    phase,
    testPath: state.testPath ?? null,
    testName: phase === 'beforeEach' || phase === 'afterEach' ? state.currentTestName ?? null : null
  })}\n`)
}

record('setup')
beforeAll(() => record('beforeAll'))
beforeEach(() => record('beforeEach'))
afterEach(() => record('afterEach'))
afterAll(() => record('afterAll'))
