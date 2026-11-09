/** The inbox Source on a real Engine and Store: file translation, poll rounds with archiving, replies, scope and policy. */
import { describe, expect, it, vi, type Mock } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine, key, threadKey, type OutboundMessage, type Trigger } from '../src/core/index.ts'
import { inboxDir, inboxKind, inboxTrigger, pollInbox, sendInbox } from '../src/sources/inbox.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { Store } from '../src/app/store.ts'
import { Commands } from '../src/infra/commands.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { testDeployment } from './fixtures/deployment.ts'
import { SettingsSchema, settingsPolicy } from '../src/policy.ts'
import { sourceContextOf, type SourceContextDeps } from '../src/app/source-context.ts'

const CONFIG = { inboxDir: '', actor: 'local', pollSeconds: 10 }

/** A host with a real Store, Engine and SourceRegistry; the inbox lives under the deployment's state directory. */
function host(overrides: Partial<SourceContextDeps> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-'))
  const store = new Store(join(dir, 'db.sqlite'))
  store.saveSettings(SettingsSchema.parse({
    sources: { inbox: { enabled: true, config: {} } },
    policy: { sources: { inbox: { allowed: [{ id: 'local', name: 'Local' }] } } },
  }))
  const board = new HealthBoard()
  const deployment = testDeployment({ stateDir: dir })
  const sources = new SourceRegistry(() => store.settings(), board)
  sources.register(inboxKind)
  const assessor = { request: vi.fn(async () => {}) }
  const executor = { start: vi.fn(async () => {}), deliver: vi.fn(async () => {}), stop: vi.fn(async () => {}) }
  const engine = new Engine({ repo: store, scope: sources, policy: () => settingsPolicy(store.settings(), sources), assessor, executor,
    outbox: { send: () => {}, status: () => undefined, withdraw: () => {} } })
  const commands = new Commands(() => deployment, {}, new AbortController().signal)
  const receive = vi.fn(async (trigger: Trigger) => { const result = engine.receive(trigger); engine.evaluateDue(); return result })
  const parts: SourceContextDeps = { store, engine, outbox: { send: message => { store.receipts.add(message) } }, commands, sources, deployment,
    ready: Promise.resolve(), configured: () => true, receive, ...overrides }
  return { ...parts, ...sourceContextOf(parts, inboxKind), dir, store, engine, board, health: board.all, receive: parts.receive }
}
/** Drop one task file into the inbox. */
function drop(dir: string, name: string, text: string): string {
  const root = inboxDir({ stateDir: dir }, CONFIG)
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  const path = join(root, name)
  writeFileSync(path, text)
  return path
}

describe('inboxTrigger', () => {
  it('names the thread after the file and the trigger after file, time and content', () => {
    const root = 'C:/inbox'
    const base = { path: 'C:/inbox/task.md', relPath: 'task.md', content: 'do x', mtimeMs: 1000 }
    const trigger = inboxTrigger(base, CONFIG, root)
    expect(trigger.source).toBe('inbox')
    expect(trigger.threads).toEqual([{ source: 'inbox', id: key('inbox', 'task.md') }])
    expect(trigger.actor).toEqual({ source: 'inbox', id: 'local' })
    expect(trigger.human).toBe(true)
    expect(trigger.addressed).toBe('direct')
    expect(trigger.at).toBe(new Date(1000).toISOString())
    expect(trigger.channel?.address.file).toBe('task.md')
    expect(trigger.channel?.address.reply?.split('\\').join('/')).toBe('C:/inbox/done/task.md.reply.md')
    // The same file unchanged replays to one id; an edit produces another.
    expect(inboxTrigger(base, CONFIG, root).id).toBe(trigger.id)
    expect(inboxTrigger({ ...base, content: 'do y' }, CONFIG, root).id).not.toBe(trigger.id)
    expect(inboxTrigger({ ...base, mtimeMs: 2000 }, CONFIG, root).id).not.toBe(trigger.id)
  })
  it('truncates a file far beyond the text limit instead of failing', () => {
    const trigger = inboxTrigger({ path: 'C:/inbox/big.md', relPath: 'big.md', content: 'x'.repeat(200_001), mtimeMs: 1 }, CONFIG, 'C:/inbox')
    expect(trigger.text).toContain('[truncated')
  })
})

describe('pollInbox', () => {
  it('takes in a dropped file, archives it and describes its Thread', async () => {
    const h = host()
    drop(h.dir, 'task.md', 'fix the typo in README')
    expect(await pollInbox(h, CONFIG, new AbortController().signal)).toEqual({ read: 1, moved: 1, failed: 0 })
    expect(await (h.receive as Mock).mock.results[0]!.value).toBe('stored')
    expect(existsSync(join(h.dir, 'inbox', 'task.md'))).toBe(false)
    expect(readdirSync(join(h.dir, 'inbox', 'done'))).toEqual(['task.md'])
    expect(h.store.threads.get(threadKey({ source: 'inbox', id: key('inbox', 'task.md') }))).toBeDefined()
    // The archive move is the cursor: the next round reads nothing.
    expect(await pollInbox(h, CONFIG, new AbortController().signal)).toEqual({ read: 0, moved: 0, failed: 0 })
    h.store.close()
  })
  it('ignores files that are not Markdown', async () => {
    const h = host()
    const root = inboxDir(h.deployment, CONFIG)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'notes.txt'), 'plain text')
    expect(await pollInbox(h, CONFIG, new AbortController().signal)).toEqual({ read: 0, moved: 0, failed: 0 })
    expect(existsSync(join(root, 'notes.txt'))).toBe(true)
    h.store.close()
  })
  it('keeps both sides of a name collision in the archive', async () => {
    const h = host()
    drop(h.dir, 'task.md', 'v1')
    await pollInbox(h, CONFIG, new AbortController().signal)
    drop(h.dir, 'task.md', 'v2')
    await pollInbox(h, CONFIG, new AbortController().signal)
    const archived = readdirSync(join(h.dir, 'inbox', 'done')).filter(name => name.startsWith('task'))
    expect(archived).toHaveLength(2)
    h.store.close()
  })
  it('reports a file that cannot be read as failed instead of losing the round', async () => {
    const h = host({ receive: vi.fn(async () => { throw new Error('engine down') }) })
    drop(h.dir, 'task.md', 'x')
    expect(await pollInbox(h, CONFIG, new AbortController().signal)).toEqual({ read: 1, moved: 0, failed: 1 })
    // The file stays in the inbox, so the next round retries it.
    expect(existsSync(join(h.dir, 'inbox', 'task.md'))).toBe(true)
    h.store.close()
  })
})

describe('sendInbox', () => {
  it('writes each message once, in order, to the Thread reply file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inbox-send-'))
    const reply = join(dir, 'done', 'task.md.reply.md')
    const message = (id: string, text: string): OutboundMessage => ({ id, text, kind: 'reply',
      channel: { source: 'inbox', thread: 'inbox:t1', address: { reply, file: 'task.md' } } })
    const commands = {} as never
    expect(await sendInbox({ commands }, message('m1', 'first'))).toBe('sent')
    expect(await sendInbox({ commands }, message('m1', 'first'))).toBe('sent')
    expect(await sendInbox({ commands }, message('m2', 'second'))).toBe('sent')
    const body = readFileSync(reply, 'utf8')
    expect(body.match(/<!-- msg:m1 -->/g)).toHaveLength(1)
    expect(body.indexOf('first')).toBeLessThan(body.indexOf('second'))
  })
  it('rewrites the record from the receipts it is handed, so a block nobody delivered does not survive', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inbox-project-'))
    const reply = join(dir, 'done', 'task.md.reply.md')
    mkdirSync(join(dir, 'done'), { recursive: true })
    const message = (id: string, text: string): OutboundMessage => ({ id, text, kind: 'reply',
      channel: { source: 'inbox', thread: 'inbox:t1', address: { reply, file: 'task.md' } } })
    writeFileSync(reply, '<!-- msg:forged -->\n**reply · 2026-01-01T00:00:00Z · task.md**\n\nwritten straight into the record by a worker\n\n')
    const delivered = [{ ...message('m1', 'first'), sentAt: '2026-01-02T00:00:00.000Z' }]
    expect(await sendInbox({ commands: {} } as never, message('m2', 'second'), delivered)).toBe('sent')
    const body = readFileSync(reply, 'utf8')
    expect(body).not.toContain('msg:forged')
    expect(body.match(/<!-- msg:m1 -->/g)).toHaveLength(1)
    expect(body).toContain('msg:m2')
    // The delivered block keeps the moment its receipt recorded, not a fresh timestamp.
    expect(body).toContain('2026-01-02T00:00:00.000Z')
    expect(body.indexOf('first')).toBeLessThan(body.indexOf('second'))
  })
  it('keeps a conversation\'s sent receipts in order and stamped, which is what the record is rendered from', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inbox-receipts-'))
    const store = new Store(join(dir, 'db.sqlite'))
    const message = (id: string): OutboundMessage => ({ id, text: id, kind: 'reply',
      channel: { source: 'inbox', thread: 'inbox:t9', address: { reply: 'r', file: 'task.md' } } })
    store.receipts.add(message('a'))
    store.receipts.add(message('b'))
    expect(store.receipts.delivered('inbox:t9')).toHaveLength(0)
    store.receipts.settle(message('a'), 'sent')
    store.receipts.settle(message('b'), 'channelGone')
    const delivered = store.receipts.delivered('inbox:t9')
    expect(delivered.map(item => item.id)).toEqual(['a'])
    expect(delivered[0]?.sentAt).toMatch(/Z$/)
    expect(store.receipts.delivered('inbox:other')).toHaveLength(0)
  })
  it('throws when the address carries no reply path', async () => {
    const message = { id: 'm1', text: 'x', kind: 'reply' as const, channel: { source: 'inbox', thread: 't', address: {} } }
    await expect(sendInbox({ commands: {} } as never, message as OutboundMessage)).rejects.toThrow('Missing inbox reply path')
  })
})

describe('the inbox kind', () => {
  it('listens to everything it produces and exposes its task file to the Executor', () => {
    const input = (trigger: object) => ({ deployment: testDeployment(), config: CONFIG, trigger: trigger as never })
    expect(inboxKind.scope!({ meta: {} }, CONFIG)).toEqual({ listened: true, observed: true, row: 'inbox' })
    expect(inboxKind.environment!.values(input({ source: 'inbox', meta: { file: 'a.md' } })))
      .toEqual({ DSH_SUPERAGENT_INBOX_FILE: 'a.md' })
    expect(inboxKind.environment!.values(input({ source: 'github', meta: {} })))
      .toEqual({ DSH_SUPERAGENT_INBOX_FILE: '' })
  })
  it('defaults its Policy to the configured local sender', () => {
    expect(inboxKind.policy!.schema.parse({}).allowed).toEqual([{ id: 'local', name: '本机' }])
    expect(inboxKind.policy!.rows!({})[0]!.id).toBe('inbox')
  })
  it('accepts an absolute inbox directory and defaults to one under the state directory', () => {
    expect(inboxDir({ stateDir: 'C:/state' }, { ...CONFIG, inboxDir: 'D:/tasks' })).toBe('D:\\tasks')
    expect(inboxDir({ stateDir: 'C:/state' }, CONFIG)).toBe('C:\\state\\inbox')
  })
  it('claims its health entry on registration', () => {
    const h = host()
    expect(Object.keys(h.health)).toContain('inbox')
    h.store.close()
  })
})
