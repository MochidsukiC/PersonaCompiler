import { expect, it } from 'vitest'
import { spawn, type IPty } from 'node-pty'

interface Probe {
  child: IPty
  ready: Promise<void>
  done: Promise<{ exitCode: number }>
  exited: boolean
}

function terminalProbe(): Probe {
  const child = spawn('cmd.exe', ['/d', '/q', '/k', 'echo PERSONA_PTY_READY'], { cols: 100, rows: 30, cwd: process.cwd(), env: process.env })
  let ready!: () => void
  const probe: Probe = {
    child, exited: false,
    ready: new Promise<void>(resolve => { ready = resolve }),
    done: new Promise(resolve => child.onExit(event => { probe.exited = true; resolve(event) }))
  }
  let output = ''
  child.onData(data => {
    output += data
    if (output.includes('\x1b[6n')) { child.write('\x1b[1;1R'); output = output.replaceAll('\x1b[6n', '') }
    if (output.includes('PERSONA_PTY_READY')) ready()
  })
  return probe
}

async function within<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`PTY timeout: ${label}`)), 10000) })])
  } finally { clearTimeout(timer) }
}

function stopProbe(probe: Probe): void {
  if (probe.exited || probe.child.pid <= 0) return
  try { process.kill(probe.child.pid) }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error }
}

it.runIf(process.platform === 'win32')('receives every exit when nine Windows terminals close together across five lifecycles', async () => {
  for (let wave = 0; wave < 5; wave++) {
    const probes: Probe[] = []
    try {
      for (let index = 0; index < 9; index++) probes.push(terminalProbe())
      await within(Promise.all(probes.map(p => p.ready)), `ready wave=${wave}`)
      for (const probe of probes) probe.child.write('exit /b 0\r')
      const exits = await within(Promise.all(probes.map(p => p.done)), `exit wave=${wave}`)
      expect(exits.map(e => e.exitCode)).toEqual(Array(9).fill(0))
      expect(probes.every(p => p.exited)).toBe(true)
    } finally {
      for (const probe of probes) stopProbe(probe)
    }
  }
})
