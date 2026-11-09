// The state-directory lock is what keeps one backend per state directory, and its failure mode is
// silent: a lock left behind by a dead Host makes the next Host's plugin entry inactive, so the
// client bundle still loads while `/orchestrator` never registers and the panel gets the static
// fallback's 404. These tests pin the reclaim rule: a dead holder's lock is taken at once, a live
// holder's lock still refuses the acquisition.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { STATE_LOCK_OWNER_FILE, acquireStateLock } from '../src/app/state-lock.ts'

const ROOT = mkdtempSync(join(tmpdir(), 'dsh-state-lock-'))
afterAll(() => { rmSync(ROOT, { recursive: true, force: true }) })

const stateDirOf = (name: string): string => {
  const dir = join(ROOT, name)
  mkdirSync(dir, { recursive: true })
  return dir
}
/** A pid that has already exited, so liveness checks report it dead. */
const deadPid = (): number => spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' }).pid as number
/** What a Host killed mid-run leaves: a fresh lock directory and no release. */
const leaveLock = (stateDir: string): void => { mkdirSync(`${stateDir}.lock`) }

it('reclaims a lock left by a dead holder without waiting out the stale window', () => {
  const stateDir = stateDirOf('dead-holder')
  leaveLock(stateDir)
  writeFileSync(join(stateDir, 'instance-status.json'), JSON.stringify({ pid: deadPid() }))
  const release = acquireStateLock(stateDir)
  expect(existsSync(`${stateDir}.lock`)).toBe(true)
  release()
  expect(existsSync(`${stateDir}.lock`)).toBe(false)
})

it('keeps a lock held by a live instance', () => {
  const stateDir = stateDirOf('live-holder')
  leaveLock(stateDir)
  writeFileSync(join(stateDir, STATE_LOCK_OWNER_FILE), JSON.stringify({ pid: process.pid }))
  let code: unknown
  try {
    acquireStateLock(stateDir)
  } catch (error) {
    code = (error as { code?: unknown }).code
  }
  expect(code).toBe('ELOCKED')
  expect(existsSync(`${stateDir}.lock`)).toBe(true)
})

it('records the holder while it is held and clears both when released', () => {
  const stateDir = stateDirOf('free')
  const release = acquireStateLock(stateDir)
  const owner = JSON.parse(readFileSync(join(stateDir, STATE_LOCK_OWNER_FILE), 'utf8')) as { pid: number }
  expect(owner.pid).toBe(process.pid)
  release()
  expect(existsSync(`${stateDir}.lock`)).toBe(false)
  expect(existsSync(join(stateDir, STATE_LOCK_OWNER_FILE))).toBe(false)
})
