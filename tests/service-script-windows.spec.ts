// The Windows branch of scripts/dsh-superagent: a detached process, a pidfile under
// .artifacts/control/profiles/<profile>, a control pipe for graceful stop, and the stop marker.
// tests/service-script.spec.ts drives the POSIX tmux/ps branch, so it is skipped on Windows.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, 'scripts', 'dsh-superagent')
const WINDOWS = process.platform === 'win32'
// A profile of its own keeps these cases away from any real service and its control directory.
const PROFILE = 'win-launcher-test-' + process.pid
const CONTROL = join(ROOT, '.artifacts', 'control', 'profiles', PROFILE)
// A port nothing listens on, so `stop` takes the "no process answers" path instead of talking to a service.
const DEAD_URL = 'http://127.0.0.1:1'

/** Run the launcher and return its exit code and combined output. */
function run(...args: readonly string[]): { code: number | null; out: string } {
  const result = spawnSync(WINDOWS ? 'python' : 'python3', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' })
  return { code: result.status, out: (result.stdout ?? '') + (result.stderr ?? '') }
}

describe.skipIf(!WINDOWS)('the Windows launcher branch', () => {
  afterEach(() => { rmSync(CONTROL, { recursive: true, force: true }) })

  it('prints its usage and exits 0', () => {
    const { code, out } = run('--help')
    expect(code).toBe(0)
    for (const action of ['start', 'stop', 'restart', 'status']) expect(out).toContain(action)
  })

  it('reports exit 1 and no pids when nothing runs for the profile', () => {
    const { code, out } = run('status', '--profile', PROFILE, '--url', DEAD_URL)
    expect(code).toBe(1)
    const reported = JSON.parse(out) as { pids: number[]; manually_stopped: boolean; cwd: string }
    expect(reported.pids).toEqual([])
    expect(reported.manually_stopped).toBe(false)
    // The control directory is scoped to the checkout, which is what the pidfile and stop marker rely on.
    expect(reported.cwd).toBeTruthy()
  })

  it('ignores a recorded pid that is no longer running', () => {
    mkdirSync(CONTROL, { recursive: true })
    writeFileSync(join(CONTROL, 'service.pid'), '999999\n')
    const { code, out } = run('status', '--profile', PROFILE, '--url', DEAD_URL)
    expect(code).toBe(1)
    expect((JSON.parse(out) as { pids: number[] }).pids).toEqual([])
  })

  it('records an intentional stop, and then leaves a --respect-stop restart alone', () => {
    const stop = run('stop', '--profile', PROFILE, '--url', DEAD_URL, '--stop-timeout', '1')
    expect(stop.code).toBe(0)
    const marker = join(CONTROL, 'manually-stopped')
    expect(existsSync(marker)).toBe(true)
    // `--respect-stop` exists so an hourly check cannot undo a person's decision to stop the service.
    const restart = run('--respect-stop', 'restart', '--profile', PROFILE, '--url', DEAD_URL, '--timeout', '1')
    expect(restart.code).toBe(0)
    expect(existsSync(join(CONTROL, 'service.pid'))).toBe(false)
  })

  // Not tested here: `start` really does spawn the profile's service. Its marker-clearing behaviour is
  // deliberately left to the end-to-end run, so this suite stays free of side effects.

})
