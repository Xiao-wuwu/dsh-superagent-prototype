import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INSTANCE_STATUS_FILE, INSTANCE_STATUS_SCHEMA, INSTANCE_STATUS_STALE_MS, InstanceStatusSchema, type InstanceStatus } from './instance-status.ts'

/**
 * The read side of the cross-instance view: one report per record in the instance registry `config/instances.json`, built only
 * from files another process already wrote. This module never writes, never opens the instance database, never takes
 * the state lock and never starts or stops anything — the `ViewIo` seam exists so a test can prove that.
 *
 * What each report is derived from:
 *  - `<stateDir>/instance-status.json` (written by the instance itself, versioned by `schema`);
 *  - `<stateDir>.lock` (proper-lockfile's directory: presence and mtime, never acquired);
 *  - the instance's own pid, checked with signal 0;
 *  - as a fallback for instances older than the status file, a read-only `GET state` on the record's port.
 *
 * Liveness is the status file's mtime, not `writtenAt`: the instance touches the mtime every interval and rewrites the
 * content only when it changed.
 */
export type InstanceState = 'running' | 'unresponsive' | 'dead' | 'stale-lock' | 'incompatible' | 'unknown'

export interface InstanceRecord {
  name: string
  label?: string
  profile?: string
  stateDir?: string
  port?: number
}

export interface InstanceReport {
  name: string
  label: string | null
  stateDir: string | null
  state: InstanceState
  reason: string | null
  source: 'status' | 'http' | 'none'
  pid: number | null
  pidAlive: boolean | null
  heartbeatAgeSeconds: number | null
  lockPresent: boolean
  lockAgeSeconds: number | null
  statusSchema: number | null
  writtenAt: string | null
  startedAt: string | null
  health: InstanceStatus['health'] | null
  load: InstanceStatus['load'] | null
  paused: boolean | null
  setup: InstanceStatus['setup'] | null
  watchdog: InstanceStatus['watchdog'] | null
  tickets: InstanceStatus['tickets'] | null
  configPath: string | null
}

export interface InstancesView {
  schema: typeof INSTANCE_STATUS_SCHEMA
  collectedAt: string
  instances: InstanceReport[]
  /** Why the record list itself could not be read; the instance reports are then empty. */
  problem: string | null
}

/** The filesystem seam: only reads. */
export interface ViewIo {
  existsSync: (path: string) => boolean
  readFileSync: (path: string, encoding: 'utf8') => string
  statSync: (path: string) => { mtimeMs: number }
}

/** An `GET state` answer, mapped into the same report fields. */
export interface ProbeReply {
  health?: Record<string, { state: string; detail: string }>
  load?: { running: number; queued: number; maxWorkers: number }
  paused?: boolean
  setup?: { configured: boolean; problem: { place: string; code: string; detail: string } | null }
}

export interface CollectOptions {
  /** Directory that holds `config/instances.json` (the install root the caller names). */
  installRoot?: string
  /** Tests inject records directly; production reads them from `installRoot`. */
  records?: readonly InstanceRecord[]
  now?: number
  io?: ViewIo
  /** Tests inject liveness; production asks the OS. */
  pidAlive?: (pid: number) => boolean
  /** Tests inject a stub; production probes over HTTP only when no status file exists. */
  probe?: (port: number) => Promise<ProbeReply | null>
}

const nodeIo: ViewIo = {
  existsSync: path => existsSync(path),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  statSync: path => statSync(path),
}

const defaultPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const readOnlyGet = async (port: number): Promise<ProbeReply | null> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/orchestrator/api/state`,
      { headers: { 'x-orchestrator-request': '1' }, signal: AbortSignal.timeout(1500) })
    return response.ok ? await response.json() as ProbeReply : null
  } catch { return null }
}

const seconds = (milliseconds: number): number => Math.max(0, Math.round(milliseconds / 1000))

/** Reads `config/instances.json` in the shape the desktop shell wrote (the shell was removed on 2026-11-07; the file is still accepted). */
function readRecords(installRoot: string, io: ViewIo): { records: InstanceRecord[]; problem: string | null } {
  const file = join(installRoot, 'config', 'instances.json')
  if (!io.existsSync(file)) return { records: [], problem: `no instance records at ${file}` }
  try {
    const parsed: unknown = JSON.parse(io.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    const list = Array.isArray(parsed) ? parsed : (parsed as { instances?: unknown })?.instances
    if (!Array.isArray(list)) return { records: [], problem: `${file} holds no instance list` }
    const records = list.filter((entry): entry is InstanceRecord =>
      typeof entry === 'object' && entry !== null && typeof (entry as InstanceRecord).name === 'string')
    return { records, problem: null }
  } catch (error) {
    return { records: [], problem: `${file} could not be read: ${error instanceof Error ? error.message : String(error)}` }
  }
}

function lockOf(stateDir: string, io: ViewIo, now: number): { present: boolean; ageSeconds: number | null } {
  const path = stateDir + '.lock'
  if (!io.existsSync(path)) return { present: false, ageSeconds: null }
  try { return { present: true, ageSeconds: seconds(now - io.statSync(path).mtimeMs) } }
  catch { return { present: true, ageSeconds: null } }
}

function heartbeatOf(stateDir: string, io: ViewIo, now: number): number | null {
  try { return seconds(now - io.statSync(join(stateDir, INSTANCE_STATUS_FILE)).mtimeMs) }
  catch { return null }
}

/** Parses one instance's status file, naming the exact way it failed instead of collapsing to "unknown". */
function statusOf(file: string, io: ViewIo):
  { status: InstanceStatus; schema: number } | { failure: InstanceState; reason: string; schema: number | null } | { missing: true } {
  if (!io.existsSync(file)) return { missing: true }
  let parsed: unknown
  try { parsed = JSON.parse(io.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) }
  catch (error) { return { failure: 'unknown', reason: `${INSTANCE_STATUS_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, schema: null } }
  const version = typeof parsed === 'object' && parsed !== null && typeof (parsed as { schema?: unknown }).schema === 'number'
    ? (parsed as { schema: number }).schema : null
  const checked = InstanceStatusSchema.safeParse(parsed)
  if (!checked.success) {
    return version !== null && version !== INSTANCE_STATUS_SCHEMA
      ? { failure: 'incompatible', reason: `${INSTANCE_STATUS_FILE} declares schema ${version}; this viewer reads ${INSTANCE_STATUS_SCHEMA}`, schema: version }
      : { failure: 'unknown', reason: `${INSTANCE_STATUS_FILE} does not match schema ${INSTANCE_STATUS_SCHEMA}: ${checked.error.issues[0]?.message ?? 'invalid'}`, schema: version }
  }
  return { status: checked.data, schema: checked.data.schema }
}

function base(record: InstanceRecord, stateDir: string | null): InstanceReport {
  return {
    name: record.name, label: record.label ?? null, stateDir, state: 'unknown', reason: null, source: 'none',
    pid: null, pidAlive: null, heartbeatAgeSeconds: null, lockPresent: false, lockAgeSeconds: null,
    statusSchema: null, writtenAt: null, startedAt: null, health: null, load: null, paused: null,
    setup: null, watchdog: null, tickets: null, configPath: null,
  }
}

/** One record's report. Every failure is named on that record only; the other instances are unaffected. */
async function reportOf(record: InstanceRecord, options: Required<Pick<CollectOptions, 'now' | 'io' | 'pidAlive' | 'probe'>>):
  Promise<InstanceReport> {
  const { now, io, pidAlive, probe } = options
  if (!record.stateDir) {
    return { ...base(record, null), reason: 'the record names no stateDir, so there is nothing to observe' }
  }
  const stateDir = record.stateDir
  const report = base(record, stateDir)
  const lock = lockOf(stateDir, io, now)
  report.lockPresent = lock.present
  report.lockAgeSeconds = lock.ageSeconds
  const read = statusOf(join(stateDir, INSTANCE_STATUS_FILE), io)
  if ('failure' in read) {
    return { ...report, state: read.failure, source: 'status', statusSchema: read.schema, reason: read.reason }
  }
  if ('missing' in read) {
    // Instances older than the status file still answer on their port; ask read-only instead of guessing they are dead.
    if ((record.port ?? 0) > 0) {
      const reply = await probe(record.port!)
      if (reply) {
        return { ...report, state: 'running', source: 'http', health: reply.health as InstanceReport['health'],
          load: reply.load ?? null, paused: reply.paused ?? null, setup: reply.setup ?? null,
          reason: 'no status file; probed the read-only state route' }
      }
    }
    if (!lock.present) return { ...report, state: 'dead', reason: 'no status file and no state lock (the instance is stopped)' }
    const old = (lock.ageSeconds ?? 0) > INSTANCE_STATUS_STALE_MS / 1000
    return { ...report, state: old ? 'stale-lock' : 'unknown', source: 'none',
      reason: old
        ? `no status file; the state lock has not moved for ${lock.ageSeconds ?? '?'}s (a crash left it behind)`
        : 'no status file; the state lock is held and fresh (the instance predates the status file or is still starting)' }
  }
  const status = read.status
  const heartbeat = heartbeatOf(stateDir, io, now)
  const alive = pidAlive(status.pid)
  const state: InstanceState = !alive ? 'dead' : heartbeat !== null && heartbeat > INSTANCE_STATUS_STALE_MS / 1000 ? 'unresponsive' : 'running'
  return {
    ...report, state, source: 'status', pid: status.pid, pidAlive: alive, heartbeatAgeSeconds: heartbeat,
    statusSchema: read.schema, writtenAt: status.writtenAt, startedAt: status.startedAt, health: status.health,
    load: status.load, paused: status.paused, setup: status.setup, watchdog: status.watchdog,
    tickets: status.tickets, configPath: status.configPath,
    reason: !alive
      ? `pid ${status.pid} is not running${lock.present ? `; the state lock is still present (${lock.ageSeconds ?? '?'}s old)` : ''}; last change ${status.writtenAt}`
      : state === 'unresponsive' ? `the heartbeat has not moved for ${heartbeat ?? '?'}s` : null,
  }
}

/** Builds the report list; the only exported behaviour, used by the CLI and by tests. */
export async function collectInstances(options: CollectOptions = {}): Promise<InstancesView> {
  const now = options.now ?? Date.now()
  const io = options.io ?? nodeIo
  const pidAlive = options.pidAlive ?? defaultPidAlive
  const probe = options.probe ?? readOnlyGet
  const collectedAt = new Date(now).toISOString()
  let records = options.records ? [...options.records] : []
  let problem: string | null = null
  if (!options.records) {
    if (!options.installRoot) problem = 'no install root was given and no records were injected'
    else ({ records, problem } = readRecords(options.installRoot, io))
  }
  const instances = await Promise.all(records.map(record => reportOf(record, { now, io, pidAlive, probe })))
  return { schema: INSTANCE_STATUS_SCHEMA, collectedAt, instances, problem }
}

const column = (text: string, width: number): string => text.length >= width ? text : text + ' '.repeat(width - text.length)

/** The human table the `--instances-status` flag prints; the JSON form is the data layer items 8 and 12 consume. */
export function formatInstances(view: InstancesView): string {
  if (view.problem) return `problem: ${view.problem}`
  const header = `${column('NAME', 14)}${column('STATE', 13)}${column('HEARTBEAT', 11)}${column('PID', 8)}${column('LOAD', 10)}${column('HEALTH', 28)} REASON`
  const lines = view.instances.map(instance => {
    const health = instance.health
      ? (Object.values(instance.health).every(entry => entry.state === 'ready') ? 'all ready'
        : Object.entries(instance.health).filter(([, entry]) => entry.state !== 'ready').map(([part, entry]) => `${part}:${entry.state}`).join(' '))
      : '—'
    const load = instance.load ? `${instance.load.running}/${instance.load.maxWorkers} +${instance.load.queued}q` : '—'
    const heartbeat = instance.heartbeatAgeSeconds === null ? '—' : `${instance.heartbeatAgeSeconds}s`
    return `${column(instance.name, 14)}${column(instance.state, 13)}${column(heartbeat, 11)}${column(instance.pid === null ? '—' : String(instance.pid), 8)}${column(load, 10)}${column(health, 28)} ${instance.reason ?? '—'}`
  })
  return [header, ...lines].join('\n')
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const asJson = argv.includes('--json')
  const rootIndex = argv.indexOf('--install-root')
  const installRoot = rootIndex >= 0 ? argv[rootIndex + 1] : process.env.SUPERAGENT_INSTALL_ROOT
  if (!installRoot) {
    process.stderr.write('usage: instances-view.js --instances-status [--json] --install-root <dir>\n')
    process.exitCode = 2
    return
  }
  const view = await collectInstances({ installRoot })
  process.stdout.write((asJson ? JSON.stringify(view, null, 2) : formatInstances(view)) + '\n')
}

/** Runs only when node executes this built file, never when a test imports the module. */
if (process.argv[1] && basename(process.argv[1]) === 'instances-view.js' && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main()
}
