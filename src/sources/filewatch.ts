/**
 * File Watch source kind: the signal primitive of the ReActive loop. A file landing, being renamed, or disappearing is
 * one event shape no matter who caused it, so the same downstream pipeline (experience lookup, thinking, action,
 * observation) serves a download folder, a build output directory, or a game crash log.
 *
 * Unlike the inbox Source, which polls a directory for task files, this Source keeps an OS watch open and reacts within
 * milliseconds. The watch is the trigger; nothing here depends on GitHub or on a second machine.
 */
import type { Context } from '@deepseek-ai/cordis'
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { key, threadKey, type ScopeResult, type Trigger } from '../core/index.ts'
import { health, sourceContext, type SourceContext } from './host.ts'
import type { SourceKind } from './kind.ts'
import { loadExperiences, markUsed, matchExperiences, type Experience } from '../experience/store.ts'

const SOURCE = 'filewatch'
/** The event names an experience can bind to; the panel and the CLI use the same list. */
export const FILE_EVENTS = ['file.created', 'file.changed', 'file.renamed', 'file.deleted'] as const
export type FileEvent = (typeof FILE_EVENTS)[number]
/** Bytes of a text file quoted into the Trigger so the agent can judge content without a second read. */
const PREVIEW_BYTES = 4000
/** A burst of OS events for one file (Windows reports several per save) collapses into one signal. */
const DEBOUNCE_MS = 800

const FileWatchConfigSchema = z.object({
  /** Directories to watch. Each entry is one absolute path; subdirectories are included when `recursive` is on. */
  dirs: z.array(z.object({ path: z.string().trim().min(1).max(500) }).strict()).default([]),
  /** Watch subdirectories too. One OS handle per configured directory either way. */
  recursive: z.boolean().default(true),
  /** Stable actor id events are attributed to; it is the sender name on the Policy's allowed list. */
  actor: z.string().regex(/^[a-z0-9_-]{1,64}$/).default('filewatch'),
  // One switch per event name, matching how the GitHub Source declares `observeIssues` and its siblings: the panel has
  // no multi-select field, so an array of event names would have no control to edit it.
  observeCreated: z.boolean().default(true),
  observeChanged: z.boolean().default(false),
  observeRenamed: z.boolean().default(true),
  observeDeleted: z.boolean().default(false),
  /** Comma-separated filename patterns (`*.pdf, *.srt`); empty means every file. */
  patterns: z.string().trim().max(500).default(''),
  /** Quote the first bytes of a new text file into the signal so the agent can classify it without reading it again. */
  previewText: z.boolean().default(true),
  /** Report files already present at startup. Off by default: a folder of old downloads is not a queue of requests. */
  scanOnStart: z.boolean().default(false),
}).strict()
export type FileWatchConfig = z.infer<typeof FileWatchConfigSchema>

/** The event names the operator switched on, in the order the panel lists them. */
export function wantedEvents(config: FileWatchConfig): FileEvent[] {
  return [
    ...(config.observeCreated ? ['file.created' as const] : []),
    ...(config.observeChanged ? ['file.changed' as const] : []),
    ...(config.observeRenamed ? ['file.renamed' as const] : []),
    ...(config.observeDeleted ? ['file.deleted' as const] : []),
  ]
}

/** The configured name patterns, split from one comma-separated field. */
export function namePatterns(config: FileWatchConfig): string[] {
  return config.patterns.split(',').map(pattern => pattern.trim()).filter(Boolean)
}

/** One watched directory plus the event that named it. */
export interface FileSignal { event: FileEvent; dir: string; relPath: string; name: string; bytes: number; at: string }

const normalize = (path: string): string => path.replace(/\\/g, '/')

/** Does this filename interest the Source, given its configured patterns? Empty patterns means everything. */
export function nameMatches(patterns: readonly string[], name: string): boolean {
  if (!patterns.length) return true
  const lower = name.toLowerCase()
  return patterns.some(pattern => {
    const p = pattern.trim().toLowerCase()
    if (!p) return false
    if (p.startsWith('*.')) return lower.endsWith(p.slice(1))
    if (p.endsWith('.*')) return lower.startsWith(p.slice(0, -1))
    return lower === p || lower.includes(p)
  })
}

/**
 * The Trigger of one file signal. Its id names event + path + mtime + size, so the OS reporting the same save three
 * times stays one signal, while a later edit of the same file becomes a new one.
 */
export function fileTrigger(signal: FileSignal, config: FileWatchConfig, experiences: readonly Experience[]): Trigger {
  const stableId = key(SOURCE, normalize(signal.dir), signal.relPath)
  const id = key(SOURCE, signal.event, normalize(signal.dir), signal.relPath, signal.at, String(signal.bytes))
  const matched = experiences.map(item => `- ${item.when} => ${item.then}${item.note ? ` (${item.note})` : ''}`).join('\n')
  const lines = [
    `${signal.event} · ${normalize(join(signal.dir, signal.relPath))} · ${signal.bytes} bytes`,
    matched ? `matched experience:\n${matched}` : 'no experience matches this signal yet',
  ]
  if (signal.event === 'file.created' || signal.event === 'file.changed') {
    const preview = readPreview(join(signal.dir, signal.relPath))
    if (preview) lines.push(`first ${preview.length} characters:\n${preview}`)
  }
  return {
    id, source: SOURCE, threads: [{ source: SOURCE, id: stableId }],
    actor: { source: SOURCE, id: config.actor },
    // A file event is not a person speaking, but the habit that binds to it was written by one: the operator taught the
    // rule earlier, and this signal is that instruction arriving in event form. `direct` keeps that intent actionable.
    human: true, addressed: 'direct',
    at: signal.at, text: lines.join('\n\n'),
    url: `file:///${normalize(join(signal.dir, signal.relPath))}`,
    channel: { source: SOURCE, thread: threadKey({ source: SOURCE, id: stableId }),
      address: { dir: normalize(signal.dir), file: signal.relPath } },
    meta: { event: signal.event, dir: signal.dir, relPath: signal.relPath, name: signal.name, bytes: signal.bytes, stableId },
  }
}

/** The first bytes of a small text file, or empty for anything binary, large, or unreadable. */
function readPreview(path: string): string {
  try {
    const st = statSync(path)
    if (!st.isFile() || st.size > 512_000) return ''
    const text = readFileSync(path, 'utf8').slice(0, PREVIEW_BYTES)
    // A text file has no NUL bytes; this cheap check keeps a binary payload out of the prompt.
    return text.includes('\u0000') ? '' : text
  } catch { return '' }
}

export const fileWatchKind: SourceKind<FileWatchConfig> = {
  kind: SOURCE,
  title: { zh: '文件监听', en: 'File watch' },
  description: {
    zh: '监听目录里的文件落地、改名、变化与删除，每种都发成同一种信号；信号先查经验库再进入思考与行动。',
    en: 'Watches directories for created, changed, renamed, and deleted files, reports each as one signal shape, and attaches the experiences that match before thinking.',
  },
  schema: FileWatchConfigSchema,
  fields: [
    { key: 'dirs', type: 'rows', label: { zh: '监听目录', en: 'Watched directories' },
      hint: { zh: '每个绝对路径一行；本源只发信号，不移动文件。', en: 'One absolute path per row; this Source reports events and never moves a file.' },
      columns: [{ key: 'path', type: 'text', label: { zh: '目录', en: 'Directory' } }] },
    { key: 'patterns', type: 'text', label: { zh: '文件名过滤', en: 'Name filter' },
      hint: { zh: '逗号分隔，如 *.pdf, *.srt；留空表示全部文件。', en: 'Comma-separated, e.g. *.pdf, *.srt; empty means every file.' } },
    { key: 'observeCreated', type: 'switch', label: { zh: '接收新文件 (file.created)', en: 'Receive new files (file.created)' } },
    { key: 'observeChanged', type: 'switch', label: { zh: '接收内容变化 (file.changed)', en: 'Receive changes (file.changed)' } },
    { key: 'observeRenamed', type: 'switch', label: { zh: '接收改名/移入 (file.renamed)', en: 'Receive renames (file.renamed)' } },
    { key: 'observeDeleted', type: 'switch', label: { zh: '接收删除 (file.deleted)', en: 'Receive deletions (file.deleted)' } },
    { key: 'recursive', type: 'switch', label: { zh: '含子目录', en: 'Include subdirectories' } },
    { key: 'previewText', type: 'switch', label: { zh: '附带文本预览', en: 'Attach text preview' }, advanced: true },
    { key: 'scanOnStart', type: 'switch', label: { zh: '启动时上报已有文件', en: 'Report existing files at startup' }, advanced: true },
    { key: 'actor', type: 'text', label: { zh: '信号归属的发送者', en: 'Sender of events' }, advanced: true,
      hint: { zh: '须出现在策略名单里才能发起工作。', en: 'Must be on the Policy list to originate work.' } },
  ],
  health: [SOURCE],
  scope: (): ScopeResult => ({ listened: true, observed: true, row: SOURCE }),
  // Replies land in the watch log rather than a remote thread: the operator reads what the agent decided there.
  channel: {
    allowed: address => typeof address.dir === 'string' && address.dir.length > 0,
    send: async () => 'gone',
    link: address => ({ url: `file:///${normalize(address.dir ?? '')}`, label: { zh: `监听目录 ${basename(address.dir ?? '')}`, en: `Watched ${basename(address.dir ?? '')}` } }),
  },
  threadContext: {
    messageId: trigger => String(trigger.meta.stableId ?? ''),
    read: async (_commands, trigger) => {
      const messages = [{ id: String(trigger.meta.stableId ?? ''), from: trigger.actor.id, at: trigger.at, text: trigger.text }]
      return { messages, body: { messages } }
    },
  },
  policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string().min(1), name: z.string().trim().max(100).optional() }).strict())
      .default([{ id: 'filewatch', name: '文件监听' }]) }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起工作的发送者', en: 'Senders who may originate work' }, columns: [
      { key: 'id', type: 'text', label: { zh: '发送者', en: 'Sender' } },
      { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] }],
    explicit: { zh: '文件落进被监听的目录。', en: 'A file lands in a watched directory.' },
    rows: () => [{ id: SOURCE, label: { zh: '文件监听', en: 'File watch' }, note: { zh: '本机的文件事件', en: 'Local file events' },
      cells: { listedUnaddressed: true, unlistedAddressed: true, unlistedUnaddressed: true } }],
  },
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_FILE_EVENT', description: { zh: '触发本工单的事件名，如 file.created', en: 'The event that started this ticket, e.g. file.created' } },
      { key: 'DSH_SUPERAGENT_FILE_PATH', description: { zh: '触发本工单的文件绝对路径', en: 'Absolute path of the file that started this ticket' } },
    ],
    values: ({ trigger }) => trigger?.source === SOURCE
      ? { DSH_SUPERAGENT_FILE_EVENT: String(trigger.meta.event ?? ''), DSH_SUPERAGENT_FILE_PATH: normalize(join(String(trigger.meta.dir ?? ''), String(trigger.meta.relPath ?? ''))) }
      : { DSH_SUPERAGENT_FILE_EVENT: '', DSH_SUPERAGENT_FILE_PATH: '' },
  },
}

/** One watch callback entry mapped to the event name the operator asked for, or undefined when it is not interesting. */
export function classify(event: 'rename' | 'change', exists: boolean, previous: boolean): FileEvent | undefined {
  if (event === 'change') return exists ? 'file.changed' : undefined
  if (exists && !previous) return 'file.created'
  if (exists && previous) return 'file.renamed'
  if (!exists && previous) return 'file.deleted'
  return undefined
}

/**
 * Opens one `fs.watch` per configured directory and feeds each event through the debounce window into the callback.
 * It reads nothing but `report`, so the caller's type is narrowed to that: the watch stays usable from a test and from
 * any host that can report health, without a whole SourceContext. Returns a disposer that closes every watcher.
 */
export function startWatch(ctx: Pick<SourceContext, 'report'>, config: FileWatchConfig, signal: AbortSignal,
  onEvent: (file: FileSignal) => void): () => void {
  const watchers: FSWatcher[] = []
  const seen = new Map<string, { exists: boolean; at: number }>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const dirs = config.dirs.map(entry => entry.path).filter(Boolean)
  const patterns = namePatterns(config)
  const wanted = new Set<FileEvent>(wantedEvents(config))
  if (!wanted.size) { ctx.report(SOURCE, { state: 'paused', detail: 'no event kind is switched on', at: new Date().toISOString() }) }
  for (const dir of dirs) {
    if (!existsSync(dir)) { ctx.report(SOURCE, { state: 'error', detail: `watched directory does not exist: ${dir}` }); continue }
    try {
      const watcher = watch(dir, { recursive: config.recursive }, (type, relative) => {
        if (!relative || signal.aborted) return
        const name = basename(String(relative))
        if (!nameMatches(patterns, name)) return
        const path = join(dir, String(relative))
        const id = `${normalize(dir)}|${normalize(String(relative))}`
        const exists = existsSync(path)
        const previous = seen.get(id)?.exists ?? false
        const event = classify(type, exists, previous)
        seen.set(id, { exists, at: Date.now() })
        if (!event || !wanted.has(event)) return
        // Windows reports several events per save; hold one path briefly and report the settled state once.
        clearTimeout(timers.get(id))
        timers.set(id, setTimeout(() => {
          timers.delete(id)
          const now = existsSync(path)
          const st = now ? (() => { try { return statSync(path) } catch { return undefined } })() : undefined
          if (now && !st?.isFile()) return
          // The state may have moved during the debounce window (created, then deleted), so re-check that the settled
          // event is one the operator switched on before reporting it.
          const settled: FileEvent = now ? event : 'file.deleted'
          if (!wanted.has(settled)) return
          const at = new Date().toISOString()
          onEvent({ event: settled, dir, relPath: String(relative), name, bytes: st?.size ?? 0, at })
        }, DEBOUNCE_MS))
      })
      watchers.push(watcher)
      watcher.on('error', (error: Error) => ctx.report(SOURCE, { state: 'error', detail: `watch failed on ${dir}: ${error.message}` }))
    } catch (error) {
      ctx.report(SOURCE, { state: 'error', detail: `cannot watch ${dir}: ${String(error)}` })
    }
  }
  return () => {
    for (const timer of timers.values()) clearTimeout(timer)
    for (const watcher of watchers) { try { watcher.close() } catch { /* already closed */ } }
  }
}

/** Sleep until `ms` passes or the signal aborts, whichever comes first; an already-aborted signal resolves at once. */
function sleep(signal: AbortSignal, ms: number): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(done, ms)
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    signal.addEventListener('abort', done, { once: true })
  })
}

export const name = 'dsh-superagent-filewatch'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(fileWatchKind), 'filewatch: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, fileWatchKind)
    const controller = new AbortController()
    let close: (() => void) | undefined
    const stop = async (): Promise<void> => { controller.abort(); close?.(); close = undefined }
    const run = async (): Promise<void> => {
      await source.ready
      // Setup gates every Source: until the deployment resolves there is no state directory to read experiences from.
      if (!source.configured()) { source.report(SOURCE, health('paused', 'setupPending')); return }
      // The watch is reopened whenever the configuration changes, so an operator adding a directory in the panel takes
      // effect without a restart - the behaviour every other Source gets from rereading its config each round.
      const signature = (item: FileWatchConfig): string => JSON.stringify(item)
      while (!controller.signal.aborted) {
        const config = source.config<FileWatchConfig>(SOURCE)
        if (!config) { source.report(SOURCE, health('paused', 'sourceOff')); await sleep(controller.signal, 5000); continue }
        const dirs = config.dirs.map(entry => entry.path).filter(Boolean)
        if (!dirs.length) { source.report(SOURCE, { state: 'paused', detail: 'no watched directory is configured', at: new Date().toISOString() }); await sleep(controller.signal, 5000); continue }
        if (!wantedEvents(config).length) { source.report(SOURCE, { state: 'paused', detail: 'no event kind is switched on', at: new Date().toISOString() }); await sleep(controller.signal, 5000); continue }
        const experiences = () => { try { return loadExperiences(source.deployment.stateDir) } catch { return [] } }
        let reported = 0
        close = startWatch(source, config, controller.signal, file => {
          const matched = matchExperiences(experiences(), file)
          // `receive` is async and DSH ends its process on an unhandled rejection, so a refused signal must be
          // caught here rather than left floating; the failure lands in this Source's health instead.
          void Promise.resolve(source.receive(fileTrigger(file, config, matched)))
            .then(() => {
              reported++
              markUsed(source.deployment.stateDir, matched.map(item => item.id))
              source.report(SOURCE, { state: 'ready', detail: `${dirs.length} directories, ${reported} signals`, at: new Date().toISOString() })
            })
            .catch((error: unknown) => {
              source.report(SOURCE, { state: 'error', detail: `signal refused: ${String(error)}`, at: new Date().toISOString() })
            })
        })
        source.report(SOURCE, { state: 'ready', detail: `${dirs.length} directories watched`, at: new Date().toISOString() })
        if (config.scanOnStart) for (const dir of dirs) void scanExisting(source, config, dir, experiences).catch(() => {})
        let current = signature(config)
        // Hold this watch until it is aborted or replaced by a different configuration.
        while (!controller.signal.aborted && current === signature(source.config<FileWatchConfig>(SOURCE) ?? config)) {
          await sleep(controller.signal, 3000)
        }
        close?.(); close = undefined
      }
    }
    // DSH ends its process on an unhandled rejection, so a failure that escapes the loop becomes the Source's health.
    void run().catch((error: unknown) => { source.report(SOURCE, { state: 'error', detail: String(error) }) })
    return stop
  })
}

/** Report files already in a directory at startup, when the operator asked for that. */
async function scanExisting(source: SourceContext, config: FileWatchConfig, dir: string, experiences: () => Experience[]): Promise<void> {
  if (!wantedEvents(config).includes('file.created')) return
  const { readdirSync } = await import('node:fs')
  const patterns = namePatterns(config)
  for (const name of readdirSync(dir)) {
    if (!nameMatches(patterns, name)) continue
    const path = join(dir, name)
    try {
      const st = statSync(path)
      if (!st.isFile()) continue
      const file: FileSignal = { event: 'file.created', dir, relPath: name, name, bytes: st.size, at: new Date().toISOString() }
      await source.receive(fileTrigger(file, config, experiences()))
    } catch { /* unreadable entries are skipped, not fatal */ }
  }
}
