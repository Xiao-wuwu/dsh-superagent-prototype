/** Decides which DSH sessions the chat chief-of-staff feature takes over. */
import type { ChatRouterSettings } from './config.ts'

/** The part of an Agent this matcher reads. Kept structurally loose so it can be unit tested without a DSH host. */
export interface ChatAgentLike {
  id: string
  session: { header: { parentSession?: unknown } }
}
export interface ChatMatchContext {
  routerIds: readonly string[]
  settings: ChatRouterSettings
}

/** Sessions the plugin itself owns; none of them may be treated as an ordinary chat. */
const MANAGED_PREFIXES = ['orchestrator-', 'worker-', 'watchdog-'] as const

/**
 * True when a session is a newly created, ordinary main chat that should lose its execution tools.
 * It deliberately never matches by a fixed session id: every new main chat is its own chief of staff.
 */
export function isChatRouterSession(agent: ChatAgentLike, ctx: ChatMatchContext): boolean {
  if (!ctx.settings.enabled || ctx.settings.scope !== 'allNewChats') return false
  if (ctx.routerIds.includes(agent.id)) return false
  if (MANAGED_PREFIXES.some(prefix => agent.id.startsWith(prefix))) return false
  const parent = agent.session.header.parentSession
  if (parent !== undefined && parent !== null) return false
  return true
}

/** Thread key binds a dispatched task to the main chat that sent it, so replies go back to the right conversation. */
export const chatThreadKey = (sessionId: string): string => `chat:${sessionId}`
