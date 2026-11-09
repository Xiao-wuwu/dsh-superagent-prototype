/** The state-directory lock keeping one dsh-superagent backend per state directory. */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { lockSync } from 'proper-lockfile'
import { instanceStatusPath } from './instance-status.ts'

/** Sidecar beside the instance status file naming the pid that holds `<stateDir>.lock`. */
export const STATE_LOCK_OWNER_FILE = 'state-lock-owner.json'

/**
 * Whether the operating system still has a process with this pid (signal 0; EPERM means it exists
 * but belongs to someone else).
 * @param pid - process id a previous holder recorded.
 * @returns true while that process exists.
 */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * The pid a record file names, or null when the file is absent, unreadable, or carries no positive
 * integer pid.
 * @param file - owner sidecar or instance status file.
 * @returns the recorded pid.
 */
function recordedPid(file: string): number | null {
  try {
    const pid = (JSON.parse(readFileSync(file, 'utf8')) as { pid?: unknown }).pid
    return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

/** Whether the lock belongs to a pid that is no longer running. */
function deadHolder(stateDir: string): boolean {
  const pid = recordedPid(join(stateDir, STATE_LOCK_OWNER_FILE)) ?? recordedPid(instanceStatusPath(stateDir))
  return pid !== null && !pidAlive(pid)
}

/** Publish this process as the holder; the lock itself stays authoritative when the write fails. */
function writeOwner(stateDir: string): void {
  try {
    writeFileSync(join(stateDir, STATE_LOCK_OWNER_FILE), `${JSON.stringify({ pid: process.pid })}\n`, 'utf8')
  } catch {
    // Without a record, a successor falls back to the instance status file's pid.
  }
}

/** Drop the holder record; a leftover record is harmless once the lock is released. */
function removeOwner(stateDir: string): void {
  try {
    rmSync(join(stateDir, STATE_LOCK_OWNER_FILE), { force: true })
  } catch {
    // Best effort only.
  }
}

/**
 * Acquire the instance lock, reclaiming one that a dead holder left behind.
 *
 * proper-lockfile judges staleness from the lock directory's mtime alone, so a Host that dies
 * without releasing the lock keeps it looking fresh for `stale` ms. DSH's desktop shell stops its
 * Host and immediately starts the next one, so that next Host can begin inside the window:
 * `lockSync` throws `ELOCKED`, `apply` rejects, the Loader keeps the entry inactive, and
 * `/orchestrator` is never registered. The client bundle still loads — it is composed from the
 * entry's package manifest — so the panel renders while every request falls through to the static
 * fallback's 404. Recording the holder's pid lets this reclaim a dead holder's lock at once; a
 * live holder still fails the acquisition, so the one-backend-per-state-directory rule is
 * unchanged.
 * @param stateDir - the directory to lock; it exists and its parent is writable.
 * @param options - staleness window and the compromised callback forwarded to proper-lockfile.
 * @returns the release function.
 */
export function acquireStateLock(
  stateDir: string,
  options: { stale?: number; onCompromised?: (error: Error) => void } = {},
): () => void {
  const acquire = (): (() => void) => lockSync(stateDir, {
    stale: options.stale ?? 30_000,
    onCompromised: options.onCompromised,
  })
  const own = (release: () => void): (() => void) => {
    writeOwner(stateDir)
    return () => {
      // Drop the record while the lock is still ours: a successor that takes it right after the
      // release must not have its own record deleted by a trailing cleanup.
      removeOwner(stateDir)
      release()
    }
  }
  try {
    return own(acquire())
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'ELOCKED' || !deadHolder(stateDir)) throw error
    rmSync(`${stateDir}.lock`, { recursive: true, force: true })
    removeOwner(stateDir)
    return own(acquire())
  }
}
