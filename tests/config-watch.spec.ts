// The declarative settings file is watched, so saving an edit applies it without a service restart.
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { declarativeFileNames } from '../src/app/config-file.ts'
import { watchDeclarative } from '../src/app/config-watch.ts'

/** Resolve once `until()` is true, or fail the test after `ms`. Watching is asynchronous, so polling beats sleeping. */
const until = async (until: () => boolean, ms = 2000): Promise<void> => {
  const deadline = Date.now() + ms
  while (!until()) {
    if (Date.now() > deadline) throw new Error('the watcher did not fire within ' + ms + 'ms')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const settle = (ms = 300): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

it('calls back when the watched file is written, without touching a neighbour in the same directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-watch-'))
  const file = join(dir, 'superagent.settings.json')
  const neighbour = join(dir, 'unrelated.json')
  await writeFile(file, '{}', 'utf8')
  let fired = 0
  const watcher = watchDeclarative(file, () => { fired++ }, { debounceMs: 10 })
  try {
    await writeFile(neighbour, '{"nope":1}', 'utf8')
    await settle()
    expect(fired).toBe(0)

    await writeFile(file, '{"executor":{"maxWorkers":3}}', 'utf8')
    await until(() => fired === 1)
  } finally {
    watcher.close()
    await rm(dir, { recursive: true, force: true })
  }
})

it('survives an atomic save (write a temporary file, then rename it over the target)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-watch-'))
  const file = join(dir, 'superagent.settings.json')
  const temp = join(dir, 'superagent.settings.json.12345')
  await writeFile(file, '{"executor":{"maxWorkers":1}}', 'utf8')
  let fired = 0
  const watcher = watchDeclarative(file, () => { fired++ }, { debounceMs: 10 })
  try {
    // This is how VS Code and Notepad++ save: the original inode is replaced, not rewritten in place.
    await writeFile(temp, '{"executor":{"maxWorkers":5}}', 'utf8')
    await rename(temp, file)
    await until(() => fired >= 1)
  } finally {
    watcher.close()
    await rm(dir, { recursive: true, force: true })
  }
})

it('collapses a burst of events from one save into a single callback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-watch-'))
  const file = join(dir, 'superagent.settings.json')
  await writeFile(file, '{}', 'utf8')
  let fired = 0
  const watcher = watchDeclarative(file, () => { fired++ }, { debounceMs: 60 })
  try {
    for (let i = 0; i < 4; i++) await writeFile(file, '{"executor":{"maxWorkers":' + i + '}}', 'utf8')
    await until(() => fired >= 1)
    await settle(150)
    expect(fired).toBe(1)
  } finally {
    watcher.close()
    await rm(dir, { recursive: true, force: true })
  }
})

it('fires for a .yaml sibling of the configured file, so a format swap still reloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-watch-'))
  const configured = join(dir, 'superagent.settings.json')
  const yaml = join(dir, 'superagent.settings.yaml')
  await writeFile(configured, '{}', 'utf8')
  let fired = 0
  // The runtime watches every name the loader accepts for the configured stem, not only the configured extension.
  const watcher = watchDeclarative(declarativeFileNames(configured), () => { fired++ }, { debounceMs: 10 })
  try {
    await writeFile(yaml, 'executor:\n  maxWorkers: 2\n', 'utf8')
    await until(() => fired >= 1)
  } finally {
    watcher.close()
    await rm(dir, { recursive: true, force: true })
  }
})

it('stops calling back after close(), and closing twice is harmless', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-watch-'))
  const file = join(dir, 'superagent.settings.json')
  await writeFile(file, '{}', 'utf8')
  let fired = 0
  const watcher = watchDeclarative(file, () => { fired++ }, { debounceMs: 10 })
  try {
    watcher.close()
    watcher.close()
    await writeFile(file, '{"executor":{"maxWorkers":9}}', 'utf8')
    await settle()
    expect(fired).toBe(0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('yields a harmless watcher when the directory does not exist', async () => {
  const missing = join(tmpdir(), 'dsh-watch-absent-' + Date.now(), 'superagent.settings.json')
  let fired = 0
  // A missing directory must not throw: the declarative file is fail-open, and the watcher follows it.
  const watcher = watchDeclarative(missing, () => { fired++ }, { debounceMs: 10 })
  expect(() => watcher.close()).not.toThrow()
  expect(fired).toBe(0)
})
