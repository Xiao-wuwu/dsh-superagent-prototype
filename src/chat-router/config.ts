/** Settings for the chat "chief of staff": which tools a newly created main chat keeps, and whether work must be dispatched. */
import { z } from 'zod'
export { CUSTOM_TOOL_GROUPS } from './tool-groups.ts'

/** Tools the chief of staff needs to dispatch, check and answer. These are never removed while the feature is on. */
export const CHAT_TOOLS = ['chat_dispatch', 'chat_status', 'chat_answer'] as const
/** Read-only tools kept by the `standard` preset; none of them can modify files or run commands. */
export const READ_TOOLS = ['orchestrator_read', 'read', 'read_image', 'glob', 'grep', 'skill'] as const

export const ChatRouterSettingsSchema = z.object({
  /** Off by default: an existing deployment keeps every tool on ordinary chats until a person opts in. */
  enabled: z.boolean().default(false),
  /** Confirmed 2026-11-09: every newly created ordinary DSH conversation becomes its own chief of staff. */
  scope: z.enum(['allNewChats']).default('allNewChats'),
  tools: z.object({
    preset: z.enum(['strict', 'standard', 'custom']).default('standard'),
    /** Extra tools to keep when `preset: custom`; dispatch tools are always kept. */
    allow: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  }).default({ preset: 'standard', allow: [] }),
  /** A guard refuses any call outside the allow list with an instruction to dispatch instead. */
  forceDispatch: z.boolean().default(true),
  worker: z.object({
    preset: z.string().trim().min(1).max(80).default('standard'),
    maxParallel: z.number().int().min(1).max(8).default(3),
  }).default({ preset: 'standard', maxParallel: 3 }),
  reply: z.object({
    mode: z.enum(['brief', 'none']).default('brief'),
    onProgress: z.boolean().default(false),
  }).default({ mode: 'brief', onProgress: false }),
}).strict()

export type ChatRouterSettings = z.infer<typeof ChatRouterSettingsSchema>
export type ChatToolPreset = ChatRouterSettings['tools']['preset']

export const DEFAULT_CHAT_ROUTER_SETTINGS: ChatRouterSettings = ChatRouterSettingsSchema.parse({})

/** The final allow list for a chief-of-staff session. `strict` keeps only dispatch, `standard` adds read-only tools. */
export function allowedChatTools(settings: ChatRouterSettings): string[] {
  switch (settings.tools.preset) {
    case 'strict': return [...CHAT_TOOLS]
    case 'standard': return [...CHAT_TOOLS, ...READ_TOOLS]
    case 'custom': return [...new Set([...CHAT_TOOLS, ...settings.tools.allow])]
  }
}

/** Trims a worker report to a short brief. The full transcript deliberately stays in the worker session. */
export function briefOf(text: string, max = 400): string {
  const clean = text.replace(/\r/g, '').split('\n').map(line => line.trim()).filter(Boolean).join('\n')
  return clean.length <= max ? clean : `${clean.slice(0, max)}\n…(truncated; the full report stays in the worker session)`
}
