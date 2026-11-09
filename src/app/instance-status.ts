import { chmodSync, renameSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * The per-instance status file: the only write side of the cross-instance view.
 *
 * A separate process cannot read another instance's health from the database without opening it, and opening it takes
 * the very lock the instance holds. So each instance publishes a small, versioned snapshot of what it already knows
 * (health, load, pause, Watchdog schedule, ticket counts), and the viewer only reads it. `schema` is the contract: a
 * reader that does not know a newer number reports that instance as incompatible instead of guessing.
 *
 * The file is rewritten only when its content changes; between rewrites the instance touches its mtime, which is what
 * the viewer uses as the heartbeat. Rewriting every interval would churn the disk for no new information.
 */
export const INSTANCE_STATUS_SCHEMA = 1
export const INSTANCE_STATUS_FILE = 'instance-status.json'
export const INSTANCE_STATUS_INTERVAL_MS = 10_000
/** Older than this mtime means the instance stopped publishing, whatever its pid claims. */
export const INSTANCE_STATUS_STALE_MS = 30_000

const HealthEntrySchema = z.object({
  state: z.enum(['starting', 'ready', 'paused', 'error']),
  detail: z.string(),
  at: z.string().optional(),
  code: z.string().optional(),
  values: z.record(z.string(), z.string()).optional(),
})

const SetupProblemSchema = z.object({ place: z.string(), code: z.string(), detail: z.string() })

export const InstanceStatusSchema = z.object({
  schema: z.literal(INSTANCE_STATUS_SCHEMA),
  /** The instance record's name when the shell exports SUPERAGENT_INSTANCE; the viewer falls back to the record name. */
  name: z.string().nullable(),
  pid: z.number().int().positive(),
  startedAt: z.string(),
  /** When the content last changed; the mtime is the heartbeat, not this field. */
  writtenAt: z.string(),
  state: z.enum(['starting', 'running', 'stopping']),
  health: z.record(z.string(), HealthEntrySchema),
  load: z.object({ running: z.number().int().nonnegative(), queued: z.number().int().nonnegative(), maxWorkers: z.number().int().positive() }),
  paused: z.boolean(),
  setup: z.object({ configured: z.boolean(), problem: SetupProblemSchema.nullable() }),
  watchdog: z.object({ everyMinutes: z.number(), stallMinutes: z.number(), lastTickAt: z.string().nullable() }),
  tickets: z.object({ open: z.number().int().nonnegative(), stalled: z.number().int().nonnegative() }),
  configPath: z.string().nullable(),
})
export type InstanceStatus = z.infer<typeof InstanceStatusSchema>

export const instanceStatusPath = (stateDir: string): string => join(stateDir, INSTANCE_STATUS_FILE)

/**
 * Validates, then replaces the status file atomically: a temporary file in the same directory is renamed over the
 * target, so a reader never parses a half-written document. Mode 0600 is requested on the write (Windows keeps its own
 * ACLs; the call is there for the Unix builds of the plugin).
 */
export function writeInstanceStatus(stateDir: string, status: InstanceStatus): void {
  const parsed = InstanceStatusSchema.parse(status)
  const target = instanceStatusPath(stateDir)
  const temporary = target + '.tmp-' + process.pid
  writeFileSync(temporary, JSON.stringify(parsed, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, target)
  try { chmodSync(target, 0o600) } catch { /* best effort: the mode above already asked for it. */ }
}

/** Heartbeat without a rewrite: refresh the mtime of an already published file. */
export function touchInstanceStatus(stateDir: string): void {
  const now = new Date()
  try { utimesSync(instanceStatusPath(stateDir), now, now) } catch { /* the instance may have stopped; ignore */ }
}
