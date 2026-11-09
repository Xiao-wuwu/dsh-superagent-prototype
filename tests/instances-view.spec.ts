import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectInstances, formatInstances, type ViewIo } from '../src/app/instances-view.ts'

// Every write-ish `node:fs` call is recorded for the whole process, so the aggregation test can assert that the whole
// collect run — not just the `ViewIo` seam — performed none. Fixtures are written through the same wrappers; the list
// is cleared immediately before collecting.
const { mutationCalls, mutationNames } = vi.hoisted(() => ({
  mutationCalls: [] as string[],
  mutationNames: new Set(['writeFileSync', 'appendFileSync', 'renameSync', 'unlinkSync', 'rmSync', 'rmdirSync', 'mkdirSync',
    'mkdtempSync', 'chmodSync', 'chownSync', 'utimesSync', 'truncateSync', 'copyFileSync', 'cpSync', 'openSync', 'createWriteStream',
    'symlinkSync', 'linkSync', 'write', 'writeFile', 'appendFile', 'rename', 'unlink', 'rm', 'mkdir', 'mkdtemp', 'chmod', 'utimes']),
}))
const READ_ONLY = new Set(['existsSync', 'readFileSync', 'statSync'])
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const tracked: Record<string, unknown> = { ...actual }
  for (const [name, value] of Object.entries(actual)) {
    if (!mutationNames.has(name) || typeof value !== 'function') continue
    const call = value as (...args: unknown[]) => unknown
    tracked[name] = (...args: unknown[]) => { mutationCalls.push(name); return call(...args) }
  }
  return tracked
})

const realIo: ViewIo = {
  existsSync: path => existsSync(path),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  statSync: path => statSync(path),
}
const NOW = Date.now()
const ROOT = mkdtempSync(join(tmpdir(), 'instances-view-spec-'))
const LIVE_PID = 1001
const statusPath = (stateDir: string): string => join(stateDir, 'instance-status.json')

afterAll(() => rmSync(ROOT, { recursive: true, force: true }))

/** The smallest document that satisfies schema 1, so a fixture only states what it is about. */
const statusDocument = (pid: number, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: 1, name: null, pid, startedAt: new Date(NOW - 3_600_000).toISOString(), writtenAt: new Date(NOW - 1_000).toISOString(),
  state: 'running', health: { runtime: { state: 'ready', detail: '' } },
  load: { running: 1, queued: 0, maxWorkers: 4 }, paused: false, setup: { configured: true, problem: null },
  watchdog: { everyMinutes: 30, stallMinutes: 45, lastTickAt: null }, tickets: { open: 1, stalled: 0 },
  configPath: null, ...overrides,
})

function makeStateDir(name: string): string {
  const dir = join(ROOT, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** proper-lockfile locks the directory next to the state dir; only its presence and mtime matter here. */
function makeLock(stateDir: string, ageSeconds: number): void {
  const dir = stateDir + '.lock'
  mkdirSync(dir, { recursive: true })
  const when = new Date(NOW - ageSeconds * 1000)
  utimesSync(dir, when, when)
}

function writeStatus(stateDir: string, document: unknown): void {
  writeFileSync(statusPath(stateDir), typeof document === 'string' ? document : JSON.stringify(document, null, 2))
}

/** Access-tracking wrapper around the read seam: anything that is not one of the three reads fails loudly. */
function watchedIo(): { io: ViewIo; touched: string[] } {
  const touched: string[] = []
  const io = new Proxy({} as ViewIo, {
    get(_target, name) {
      const key = String(name)
      touched.push(key)
      if (!READ_ONLY.has(key)) throw new Error(`the aggregator asked its filesystem seam for ${key}, which is not a read`)
      return realIo[key as keyof ViewIo]
    },
  })
  return { io, touched }
}

// One fixture per case the owner asked for: alive, dead, a lock left behind, a corrupt status file, a future schema.
const liveDir = makeStateDir('live')
makeLock(liveDir, 2)
writeStatus(liveDir, statusDocument(LIVE_PID))

const deadDir = makeStateDir('dead')
makeLock(deadDir, 5)
writeStatus(deadDir, statusDocument(1002))

const staleLockDir = makeStateDir('stale-lock')
makeLock(staleLockDir, 120)

const badJsonDir = makeStateDir('bad-json')
writeStatus(badJsonDir, '{')

const incompatibleDir = makeStateDir('incompatible')
writeStatus(incompatibleDir, statusDocument(1003, { schema: 2 }))

const records = [
  { name: 'live', stateDir: liveDir },
  { name: 'dead', stateDir: deadDir },
  { name: 'stale-lock', stateDir: staleLockDir },
  { name: 'bad-json', stateDir: badJsonDir },
  { name: 'incompatible', stateDir: incompatibleDir },
]

describe('instances view', () => {
  beforeEach(() => { mutationCalls.length = 0 })

  it('reports one fixture per state and touches only the three read functions while doing so', async () => {
    const { io, touched } = watchedIo()
    const view = await collectInstances({ records, now: NOW, io, pidAlive: pid => pid === LIVE_PID, probe: async () => null })

    expect(view.problem).toBeNull()
    expect(view.instances.map(instance => instance.name)).toEqual(['live', 'dead', 'stale-lock', 'bad-json', 'incompatible'])
    expect(view.instances.map(instance => instance.state)).toEqual(['running', 'dead', 'stale-lock', 'unknown', 'incompatible'])

    const [live, dead, staleLock, badJson, incompatible] = view.instances
    expect(live).toMatchObject({ source: 'status', pid: LIVE_PID, pidAlive: true, lockPresent: true, statusSchema: 1,
      paused: false, load: { running: 1, queued: 0, maxWorkers: 4 }, tickets: { open: 1, stalled: 0 }, reason: null })
    expect(live!.heartbeatAgeSeconds).toBeLessThanOrEqual(1)
    expect(dead).toMatchObject({ source: 'status', pid: 1002, pidAlive: false, lockPresent: true })
    expect(dead!.reason).toContain('pid 1002 is not running')
    expect(dead!.reason).toContain('state lock is still present')
    expect(staleLock).toMatchObject({ source: 'none', lockPresent: true, statusSchema: null })
    expect(staleLock!.lockAgeSeconds).toBeGreaterThanOrEqual(120)
    expect(staleLock!.reason).toContain('has not moved for')
    expect(badJson).toMatchObject({ source: 'status', state: 'unknown', statusSchema: null })
    expect(badJson!.reason).toContain('is not valid JSON')
    expect(incompatible).toMatchObject({ source: 'status', state: 'incompatible', statusSchema: 2 })
    expect(incompatible!.reason).toContain('declares schema 2')

    // The only `node:fs` calls the entire aggregation made are reads: the module has no write path at all.
    expect(mutationCalls).toEqual([])
    expect(new Set(touched)).toEqual(READ_ONLY)
  })

  it('formats the same five reports as a table', async () => {
    const view = await collectInstances({ records, now: NOW, io: realIo, pidAlive: pid => pid === LIVE_PID, probe: async () => null })
    const table = formatInstances(view)
    const lines = table.split('\n')
    expect(lines[0]).toContain('NAME')
    expect(lines.slice(1)).toHaveLength(5)
    expect(table).toContain('running')
    expect(table).toContain('stale-lock')
    expect(table).toContain('incompatible')
  })

  it('names an unreadable record list as the view problem instead of inventing instances', async () => {
    const view = await collectInstances({ installRoot: join(ROOT, 'nowhere'), now: NOW, io: realIo, probe: async () => null })
    expect(view.instances).toEqual([])
    expect(view.problem).toContain('no instance records at')
  })
})
