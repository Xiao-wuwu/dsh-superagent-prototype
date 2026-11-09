/** Panel saves written back into the instance's own declarative file: comments, restarts, conflicts, failures, isolation. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DeclarativeConflict, DeclarativeWriteBack, DeclarativeWriteError } from '../src/app/config-write.ts'
import { loadDeclarative } from '../src/app/config-file.ts'
import { SettingsSchema } from '../src/policy.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

const roots: string[] = []
let h: Host | undefined
const directory = (): string => { const dir = mkdtempSync(join(tmpdir(), 'config-write-')); roots.push(dir); return dir }
afterEach(async () => {
  await h?.stop(); h = undefined
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** The settings the panel starts from: a stored executor with a worker count and a prepare command. */
const stored = SettingsSchema.parse({ executor: { maxWorkers: 2, prepare: 'C:/tools/prepare.cmd' } })
const executor = stored.executor
const raised = { ...executor, maxWorkers: 4 }

const document = [
  '# hand-written: keep me',
  'executor:',
  '  maxWorkers: 2   # worker count',
  '  prepare: C:/tools/prepare.cmd',
  'eval:',
  '  mode: observe',
  '',
].join('\n')

it('writes back only the changed YAML key and keeps the comments and untouched keys', () => {
  const dir = directory(), file = join(dir, 'settings.yaml')
  writeFileSync(file, document)
  const writer = new DeclarativeWriteBack(file)
  writer.observe()
  writer.write(['executor'], executor, raised)
  expect(readFileSync(file, 'utf8')).toBe([
    '# hand-written: keep me',
    'executor:',
    '  maxWorkers: 4   # worker count',
    '  prepare: C:/tools/prepare.cmd',
    'eval:',
    '  mode: observe',
    '',
  ].join('\n'))
})

it('leaves a value that the startup loader applies after a restart', () => {
  const dir = directory(), file = join(dir, 'settings.yaml')
  writeFileSync(file, document)
  const writer = new DeclarativeWriteBack(file)
  writer.observe()
  writer.write(['executor'], executor, raised)
  const loaded = loadDeclarative(file, stored)
  expect('settings' in loaded).toBe(true)
  if ('settings' in loaded) expect(loaded.settings.executor).toMatchObject({ maxWorkers: 4, prepare: executor.prepare })
})

it('refuses to overwrite a file a person edited, and says so', () => {
  const dir = directory(), file = join(dir, 'settings.yaml')
  writeFileSync(file, document)
  const writer = new DeclarativeWriteBack(file)
  writer.observe()
  const edited = document + '# edited by hand\n'
  writeFileSync(file, edited)
  expect(() => writer.write(['executor'], executor, raised)).toThrow(DeclarativeConflict)
  expect(readFileSync(file, 'utf8')).toBe(edited)
  // A touch alone (same text, newer mtime) is also an external change.
  writer.observe()
  const later = new Date(Date.now() + 1000)
  utimesSync(file, later, later)
  expect(() => writer.write(['executor'], executor, raised)).toThrow(DeclarativeConflict)
})

it('reports a write it cannot perform instead of pretending the panel saved', () => {
  const dir = directory(), blocker = join(dir, 'not-a-directory')
  writeFileSync(blocker, 'x')
  const writer = new DeclarativeWriteBack(join(blocker, 'settings.yaml'))
  expect(() => writer.write(['executor'], executor, raised)).toThrow(DeclarativeWriteError)
})

it('writes only the instance that owns the file, never its sibling', () => {
  const dir = directory(), a = join(dir, 'a', 'settings.yaml'), b = join(dir, 'b', 'settings.yaml')
  for (const file of [a, b]) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, 'executor:\n  maxWorkers: 1\n') }
  const one = SettingsSchema.parse({ executor: { maxWorkers: 1 } }).executor
  const three = { ...one, maxWorkers: 3 }
  const first = new DeclarativeWriteBack(a), second = new DeclarativeWriteBack(b)
  first.observe(); second.observe()
  first.write(['executor'], one, three)
  expect(readFileSync(a, 'utf8')).toBe('executor:\n  maxWorkers: 3\n')
  expect(readFileSync(b, 'utf8')).toBe('executor:\n  maxWorkers: 1\n')
  second.write(['executor'], one, three)
  expect(readFileSync(b, 'utf8')).toBe('executor:\n  maxWorkers: 3\n')
})

it('patches JSON without reordering its keys', () => {
  const dir = directory(), file = join(dir, 'settings.json')
  writeFileSync(file, '{\n  "executor": {\n    "maxWorkers": 1\n  },\n  "eval": {\n    "mode": "observe"\n  }\n}\n')
  const one = SettingsSchema.parse({ executor: { maxWorkers: 1 } }).executor
  const three = { ...one, maxWorkers: 3 }
  const writer = new DeclarativeWriteBack(file)
  writer.observe()
  writer.write(['executor'], one, three)
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { executor: { maxWorkers: number }; eval: { mode: string } }
  expect(parsed.executor.maxWorkers).toBe(3)
  expect(parsed.eval.mode).toBe('observe')
  expect(readFileSync(file, 'utf8')).toMatch(/"executor": \{[\s\S]*"eval": \{/)
})

it('writes a panel save into the instance file, and the startup loader then sees it', async () => {
  const dir = directory(), file = join(dir, 'settings.yaml')
  writeFileSync(file, ['# kept', 'executor:', '  maxWorkers: 2 # note', ''].join('\n'))
  h = await startRuntime(undefined, { configPath: file })
  const block = h.runtime.settings.block('executor')
  const value = block.value as { maxWorkers: number }
  const reply = await h.api('PUT', 'settings/executor', { revision: block.revision, value: { ...value, maxWorkers: 4 } })
  expect(reply.status).toBe(200)
  expect(readFileSync(file, 'utf8')).toBe(['# kept', 'executor:', '  maxWorkers: 4 # note', ''].join('\n'))
  expect(h.runtime.store.settings().executor.maxWorkers).toBe(4)
  // A restart is this file applied over the stored settings again, which is what `loadDeclarative` does.
  const startup = loadDeclarative(file, SettingsSchema.parse({}))
  expect('settings' in startup && startup.settings.executor.maxWorkers).toBe(4)
})
