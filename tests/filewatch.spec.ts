/** The file-watch Source: signal translation, the filters, the state machine of classify, and a real fs.watch round. */
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine, key, threadKey, type Trigger } from '../src/core/index.ts'
import { classify, fileTrigger, fileWatchKind, nameMatches, namePatterns, startWatch, wantedEvents } from '../src/sources/filewatch.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { Store } from '../src/app/store.ts'
import { Commands } from '../src/infra/commands.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { testDeployment } from './fixtures/deployment.ts'
import { SettingsSchema, settingsPolicy } from '../src/policy.ts'
import { sourceContextOf, type SourceContextDeps } from '../src/app/source-context.ts'
import { addExperience, loadExperiences } from '../src/experience/store.ts'

const CONFIG = fileWatchKind.schema.parse({ dirs: [{ path: '/x' }] })

/** A host with a real Store and Engine, so a Trigger goes through the same scope and Policy checks it will in production. */
function host(overrides: Partial<SourceContextDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'filewatch-'))
  const store = new Store(join(dir, 'db.sqlite'))
  store.saveSettings(SettingsSchema.parse({
    sources: { filewatch: { enabled: true, config: { dirs: [{ path: dir }] } } },
    policy: { sources: { filewatch: { allowed: [{ id: 'filewatch', name: '文件监听' }] } } },
  }))
  const board = new HealthBoard()
  const deployment = testDeployment({ stateDir: dir })
  const sources = new SourceRegistry(() => store.settings(), board)
  sources.register(fileWatchKind)
  const assessor = { request: vi.fn(async () => {}) }
  const executor = { start: vi.fn(async () => {}), deliver: vi.fn(async () => {}), stop: vi.fn(async () => {}) }
  const engine = new Engine({ repo: store, scope: sources, policy: () => settingsPolicy(store.settings(), sources), assessor, executor,
    outbox: { send: () => {}, status: () => undefined, withdraw: () => {} } })
  const commands = new Commands(() => deployment, {}, new AbortController().signal)
  const receive = vi.fn(async (trigger: Trigger) => { const result = engine.receive(trigger); engine.evaluateDue(); return result })
  const parts: SourceContextDeps = { store, engine, outbox: { send: () => {} }, commands, sources, deployment,
    ready: Promise.resolve(), configured: () => true, receive, ...overrides }
  return { ...parts, ...sourceContextOf(parts, fileWatchKind), dir, store, engine, board, receive: parts.receive }
}

describe('classify', () => {
  it('maps the OS report and the previous state onto the four signal names', () => {
    expect(classify('rename', true, false)).toBe('file.created')
    expect(classify('rename', true, true)).toBe('file.renamed')
    expect(classify('rename', false, true)).toBe('file.deleted')
    expect(classify('change', true, true)).toBe('file.changed')
    // A change on a path the watch had not seen cannot be a change of content; nothing is reportable.
    expect(classify('change', false, false)).toBeUndefined()
    // A rename that removed and recreated nothing is not an event the operator asked for.
    expect(classify('rename', false, false)).toBeUndefined()
  })
})

describe('nameMatches', () => {
  it('treats an empty filter as every file and supports the two wildcard shapes', () => {
    expect(nameMatches([], 'anything.txt')).toBe(true)
    expect(nameMatches(['*.pdf'], 'Report.PDF')).toBe(true)
    expect(nameMatches(['*.pdf'], 'report.txt')).toBe(false)
    expect(nameMatches(['sub.*'], 'sub.mkv'), 'a trailing wildcard matches a prefix').toBe(true)
    expect(nameMatches(['note'], 'my-notes.md'), 'a bare term matches as a substring').toBe(true)
  })
})

describe('the configuration', () => {
  it('defaults to created and renamed, and reads the switches back into event names', () => {
    expect(wantedEvents(CONFIG)).toEqual(['file.created', 'file.renamed'])
    expect(namePatterns(CONFIG)).toEqual([])
    const all = fileWatchKind.schema.parse({ observeCreated: true, observeChanged: true, observeRenamed: true, observeDeleted: true, patterns: '*.pdf, ,*.srt' })
    expect(wantedEvents(all)).toEqual(['file.created', 'file.changed', 'file.renamed', 'file.deleted'])
    expect(namePatterns(all), 'blank entries are dropped').toEqual(['*.pdf', '*.srt'])
  })
  it('refuses an unknown key rather than silently ignoring a typo', () => {
    expect(fileWatchKind.schema.safeParse({ watched: '/x' }).success).toBe(false)
  })
})

describe('fileTrigger', () => {
  const signal = { event: 'file.created' as const, dir: 'D:/Downloads', relPath: 'a.pdf', name: 'a.pdf', bytes: 842943, at: '2026-11-09T10:00:00.000Z' }
  it('states the signal in one shape and names the file in its id', () => {
    const trigger = fileTrigger(signal, CONFIG, [])
    expect(trigger.source).toBe('filewatch')
    expect(trigger.text).toContain('file.created')
    expect(trigger.text).toContain('D:/Downloads/a.pdf')
    expect(trigger.text).toContain('842943 bytes')
    expect(trigger.text).toContain('no experience matches this signal yet')
    expect(trigger.id).toBe(key('filewatch', 'file.created', 'D:/Downloads', 'a.pdf', signal.at, '842943'))
    expect(trigger.threads[0]!.id).toBe(key('filewatch', 'D:/Downloads', 'a.pdf'))
    expect(trigger.meta.stableId).toBe(key('filewatch', 'D:/Downloads', 'a.pdf'))
  })
  it('quotes the experiences that match, so thinking starts from what worked last time', () => {
    const { dir } = host()
    const habit = addExperience(dir, { when: '下载目录出现 PDF', then: '归位到作业目录', events: ['file.created'], dirs: ['D:/Downloads'], patterns: ['*.pdf'] })
    const matched = fileWatchKind.schema.parse({ dirs: [{ path: dir }] })
    const trigger = fileTrigger(signal, matched, loadExperiences(dir))
    expect(trigger.text).toContain('matched experience:')
    expect(trigger.text).toContain(`${habit.when} => ${habit.then}`)
  })
  it('keeps the same id for one unchanged event so a replay is a duplicate', () => {
    expect(fileTrigger(signal, CONFIG, []).id).toBe(fileTrigger(signal, CONFIG, []).id)
    expect(fileTrigger({ ...signal, bytes: 900 }, CONFIG, []).id).not.toBe(fileTrigger(signal, CONFIG, []).id)
  })
})

describe('the watch itself', () => {
  /** The watch reads nothing but `report`, so a spy stands in for the whole Source. */
  const reporter = () => ({ report: vi.fn() })

  it('reports a file that really lands, through one OS handle', async () => {
    const { dir } = host()
    const config = fileWatchKind.schema.parse({ dirs: [{ path: dir }], observeDeleted: true })
    const signals: { event: string; name: string }[] = []
    const controller = new AbortController()
    const close = startWatch(reporter(), config, controller.signal, file => signals.push({ event: file.event, name: file.name }))
    try {
      writeFileSync(join(dir, 'homework.pdf'), 'x'.repeat(200))
      // The debounce window is 800ms; give the OS handle time to report and the timer to settle.
      for (let wait = 0; wait < 60 && !signals.length; wait++) await new Promise(resolve => setTimeout(resolve, 100))
      expect(signals.map(item => item.name), `no signal arrived; got ${JSON.stringify(signals)}`).toContain('homework.pdf')
      expect(signals.every(item => item.event === 'file.created'), 'a new file is created, not changed').toBe(true)
    } finally { controller.abort(); close() }
  }, 30_000)

  it('closes every handle so a stopped Source leaves no watcher behind', async () => {
    const { dir } = host()
    const config = fileWatchKind.schema.parse({ dirs: [{ path: dir }] })
    const controller = new AbortController()
    const first: string[] = []
    const close = startWatch(reporter(), config, controller.signal, file => first.push(file.name))
    close()
    // A closed watcher is silent: writing now must reach only the watch opened afterwards.
    const reopened: string[] = []
    const again = startWatch(reporter(), config, controller.signal, file => reopened.push(file.name))
    try {
      writeFileSync(join(dir, 'after.txt'), 'y')
      await new Promise(resolve => setTimeout(resolve, 1500))
      expect(first, 'the closed watch reported nothing after close').toEqual([])
      expect(reopened, 'the reopened watch is the live one').toEqual(['after.txt'])
    } finally { controller.abort(); again() }
  }, 30_000)

  it('reports nothing for a directory the operator did not switch on', async () => {
    const { dir } = host()
    const config = fileWatchKind.schema.parse({ dirs: [{ path: dir }], observeCreated: false, observeRenamed: false })
    expect(wantedEvents(config)).toEqual([])
    const signals: unknown[] = []
    const controller = new AbortController()
    const close = startWatch(reporter(), config, controller.signal, file => signals.push(file))
    try {
      writeFileSync(join(dir, 'quiet.pdf'), 'z')
      await new Promise(resolve => setTimeout(resolve, 1200))
      expect(signals).toEqual([])
    } finally { controller.abort(); close() }
  }, 30_000)
})

describe('thread identity', () => {
  it('keeps one Thread per path so later events on a file continue the same conversation', () => {
    const at = (stamp: string) => ({ event: 'file.changed' as const, dir: '/d', relPath: 'a.txt', name: 'a.txt', bytes: 1, at: stamp })
    const first = fileTrigger(at('2026-11-09T10:00:00.000Z'), CONFIG, [])
    const second = fileTrigger(at('2026-11-09T10:05:00.000Z'), CONFIG, [])
    expect(second.threads[0]!.id).toBe(first.threads[0]!.id)
    expect(threadKey(second.threads[0]!)).toBe(threadKey(first.threads[0]!))
    expect(second.id).not.toBe(first.id)
  })
})
