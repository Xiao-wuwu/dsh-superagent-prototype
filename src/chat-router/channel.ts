/** Sends a short brief from an archived inbox reply back to the main chat that dispatched the task. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { briefOf } from './config.ts'
import { chatSessionFrom } from './submit.ts'

export type ChatReplySender = (sessionId: string, text: string) => Promise<void>

/**
 * A lightweight bridge over the existing Mode A reply files. It scans `done/*.reply.md`, pairs a reply with its archived
 * task file to recover the `chat-session` marker, and pushes a bounded brief into that main chat. The worker's full
 * transcript never leaves its own session, which is the whole point of the isolation.
 */
export class ChatReplyWatcher {
  private readonly seen = new Set<string>()
  /** `root` is a function because the inbox Source may not be enabled when the plugin starts. */
  constructor(private readonly root: () => string, private readonly send: ChatReplySender, private readonly max = 400) {}

  /** Returns how many new briefs were delivered. Safe to call on every poll tick. */
  async tick(): Promise<number> {
    let done: string
    try { done = join(this.root(), 'done') }
    catch { return 0 }
    if (!existsSync(done)) return 0
    let sent = 0
    const names = readdirSync(done).filter(name => name.endsWith('.reply.md')).sort()
    for (const name of names) {
      if (this.seen.has(name)) continue
      let reply: string
      try { reply = readFileSync(join(done, name), 'utf8') }
      catch { continue }
      const original = join(done, name.replace(/\.reply\.md$/, '.md'))
      let sessionId: string | undefined
      try { if (existsSync(original)) sessionId = chatSessionFrom(readFileSync(original, 'utf8')) }
      catch { /* The archived task may have been removed; the reply marker is the fallback. */ }
      sessionId ??= chatSessionFrom(reply)
      if (!sessionId) { this.seen.add(name); continue }
      try {
        await this.send(sessionId, `Task result (brief):\n${briefOf(reply, this.max)}`)
        this.seen.add(name)
        sent++
      } catch { /* Leave it unseen so the next tick retries the delivery. */ }
    }
    return sent
  }
}
