/** Turns a chat dispatch call into an ordinary inbox .md file, so it travels the exact same path as a dropped ticket. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MARKER = /^<!--\s*chat-session:\s*([^\s>]+)\s*-->$/m
export const chatSessionFrom = (text: string): string | undefined => MARKER.exec(text)?.[1]

export interface SubmittedTicket { file: string; inbox: string }

/**
 * Writes one task file. The `chat-session` marker survives archiving under `done/`, so the reply watcher can send the
 * brief back to the main chat that dispatched the work without sharing any conversation context with the worker.
 */
export function submitChatTicket(root: string, title: string, request: string, sessionId: string, context?: string): SubmittedTicket {
  mkdirSync(root, { recursive: true })
  const now = new Date()
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const slug = title.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ticket'
  const file = `chat-${slug}-${stamp}.md`
  const lines = [
    `<!-- created by chat-router at ${now.toISOString()} -->`,
    `<!-- chat-session: ${sessionId} -->`,
    `# ${title}`,
    '',
    request.trim(),
  ]
  if (context?.trim()) lines.push('', '## Context from the dispatching conversation', context.trim())
  writeFileSync(join(root, file), `${lines.join('\n')}\n`)
  return { file, inbox: root }
}
