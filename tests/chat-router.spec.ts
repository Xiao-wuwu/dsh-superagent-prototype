import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CHAT_TOOLS, ChatRouterSettingsSchema, DEFAULT_CHAT_ROUTER_SETTINGS, allowedChatTools, briefOf } from '../src/chat-router/config.ts'
import { chatThreadKey, isChatRouterSession } from '../src/chat-router/match.ts'
import { chatSessionFrom, submitChatTicket } from '../src/chat-router/submit.ts'
import { ChatReplyWatcher } from '../src/chat-router/channel.ts'

const agent = (id: string, parentSession?: string) => ({ id, session: { header: { parentSession } } })
const context = (settings = DEFAULT_CHAT_ROUTER_SETTINGS, routerIds: readonly string[] = ['orchestrator-1']) => ({ settings, routerIds })

describe('chatRouter settings', () => {
  it('is off by default, so an existing deployment keeps every tool', () => {
    expect(DEFAULT_CHAT_ROUTER_SETTINGS.enabled).toBe(false)
    expect(DEFAULT_CHAT_ROUTER_SETTINGS.scope).toBe('allNewChats')
    expect(DEFAULT_CHAT_ROUTER_SETTINGS.tools.preset).toBe('standard')
    expect(DEFAULT_CHAT_ROUTER_SETTINGS.forceDispatch).toBe(true)
  })

  it('strict keeps only the three dispatch tools', () => {
    const settings = ChatRouterSettingsSchema.parse({ enabled: true, tools: { preset: 'strict' } })
    expect(allowedChatTools(settings)).toEqual([...CHAT_TOOLS])
  })

  it('standard adds read-only tools but never commands, writes or subagents', () => {
    const allow = allowedChatTools(ChatRouterSettingsSchema.parse({ enabled: true }))
    expect(allow).toContain('read')
    expect(allow).not.toContain('bash')
    expect(allow).not.toContain('pwsh')
    expect(allow).not.toContain('write')
    expect(allow).not.toContain('edit')
    expect(allow).not.toContain('subagent')
  })

  it('custom merges extra tools without duplicates and always keeps dispatch', () => {
    const settings = ChatRouterSettingsSchema.parse({ enabled: true, tools: { preset: 'custom', allow: ['read', 'read', 'bash'] } })
    expect(allowedChatTools(settings)).toEqual([...CHAT_TOOLS, 'read', 'bash'])
  })

  it('rejects unknown keys instead of silently widening the surface', () => {
    expect(() => ChatRouterSettingsSchema.parse({ enabled: true, surprise: true })).toThrow()
    expect(() => ChatRouterSettingsSchema.parse({ worker: { maxParallel: 99 } })).toThrow()
  })

  it('briefOf bounds the report and never returns the full transcript', () => {
    const long = Array.from({ length: 100 }, (_, index) => `line ${index} with plenty of output`).join('\n')
    const brief = briefOf(long, 120)
    expect(brief.length).toBeLessThan(200)
    expect(brief).toContain('truncated')
    expect(brief).not.toContain('line 99')
  })
})

describe('chatRouter session matcher', () => {
  it('takes over a newly created ordinary chat, with no fixed session id', () => {
    const settings = ChatRouterSettingsSchema.parse({ enabled: true })
    expect(isChatRouterSession(agent('session-aaa'), context(settings))).toBe(true)
    expect(isChatRouterSession(agent('session-bbb'), context(settings))).toBe(true)
    expect(chatThreadKey('session-aaa')).not.toBe(chatThreadKey('session-bbb'))
  })

  it('does nothing while the switch is off', () => {
    expect(isChatRouterSession(agent('session-aaa'), context())).toBe(false)
  })

  it('never takes over the plugin\'s own Router, worker or watchdog sessions', () => {
    const settings = ChatRouterSettingsSchema.parse({ enabled: true })
    for (const id of ['orchestrator-1', 'orchestrator-1-shard-1', 'worker-abc', 'watchdog-xyz']) {
      expect(isChatRouterSession(agent(id), context(settings))).toBe(false)
    }
  })

  it('never takes over a subagent or any child session', () => {
    const settings = ChatRouterSettingsSchema.parse({ enabled: true })
    expect(isChatRouterSession(agent('session-child', 'worker-abc'), context(settings))).toBe(false)
  })
})

describe('chat dispatch submission', () => {
  it('writes an inbox task file carrying the dispatching main chat id and the verbatim request', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-chat-router-'))
    const { file } = submitChatTicket(root, '整理输出目录', '请把 output 目录按日期归类', 'session-aaa', '之前用过 Final 目录')
    const text = readFileSync(join(root, file), 'utf8')
    expect(chatSessionFrom(text)).toBe('session-aaa')
    expect(text).toContain('请把 output 目录按日期归类')
    expect(text).toContain('之前用过 Final 目录')
  })
})

describe('chat reply watcher', () => {
  const root = () => inboxRoot
  let inboxRoot: string

  it('delivers one bounded brief to the main chat that dispatched the task', async () => {
    inboxRoot = mkdtempSync(join(tmpdir(), 'dsh-chat-brief-'))
    const done = join(inboxRoot, 'done')
    mkdirSync(done, { recursive: true })
    const name = 'chat-task-1'
    writeFileSync(join(done, `${name}.md`), '<!-- chat-session: session-aaa -->\n# task\n')
    writeFileSync(join(done, `${name}.reply.md`), `完成。\n${'x'.repeat(2000)}`)

    const sent: { sessionId: string; text: string }[] = []
    const watcher = new ChatReplyWatcher(root, async (sessionId, text) => { sent.push({ sessionId, text }) }, 120)
    expect(await watcher.tick()).toBe(1)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.sessionId).toBe('session-aaa')
    expect(sent[0]!.text.length).toBeLessThan(250)
    expect(sent[0]!.text).not.toContain('x'.repeat(500))
    expect(await watcher.tick()).toBe(0)
  })

  it('ignores replies with no chat-session marker', async () => {
    inboxRoot = mkdtempSync(join(tmpdir(), 'dsh-chat-brief-'))
    const done = join(inboxRoot, 'done')
    mkdirSync(done, { recursive: true })
    writeFileSync(join(done, 'manual.md.reply.md'), 'a reply from a dropped .md file')
    const watcher = new ChatReplyWatcher(root, async () => { throw new Error('must not send') })
    expect(await watcher.tick()).toBe(0)
  })
})
