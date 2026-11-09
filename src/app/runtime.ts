/** Application composition root and lifecycle manager for dsh-superagent. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-subprocess'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Engine, key, reasonText, type EngineForSettings, type ReceiveResult, type Ticket, type Trigger } from '../core/index.ts'
import { allowedSender, settingsPolicy } from '../policy.ts'
import { SourceRegistry } from '../sources/registry.ts'
import { Commands } from '../infra/commands.ts'
import type { Deployment, Machine } from '../deployment.ts'
import { environmentOf, ticketEnvironment, type Variable } from './execution-environment.ts'
import { WatchdogLoop, assignmentStates, quietMinutes, stalledIds, watchdogDigest, watchdogDue, watchdogProblems } from './watchdog.ts'
import { shardSessionIds, triggerSessionId } from './shards.ts'
import type { SetupProblem } from '../setup.ts'
import { DshExecutor, sourceTrigger, triggerMessage, workerSessionId } from '../executor/dsh.ts'
import { ticketCard } from './cards.ts'
import { MasterAssessor } from './assessment.ts'
import { KV } from '../kv.ts'
import { Store } from './store.ts'
import { evalsHealth } from './views/overview.ts'
import { executorLoad } from './views/tickets.ts'
import { INSTANCE_STATUS_INTERVAL_MS, INSTANCE_STATUS_SCHEMA, touchInstanceStatus, writeInstanceStatus, type InstanceStatus } from './instance-status.ts'
import { acquireStateLock } from './state-lock.ts'
import { dataHomeProblem } from './instance-roots.ts'
import { TextCache } from './cache.ts'
import { Effects } from './effects.ts'
import { Prompts } from './prompts.ts'
import { registerHttp, type HttpHost } from './http.ts'
import type { LinkTarget } from './views/records.ts'
import { candidateCard, repliedTo, sourceLink, type LinkHost } from './links.ts'
import { eventNotice, followupNotice } from './notices.ts'
import { pullEndNotices } from '../sources/github-pull.ts'
import { HealthBoard } from '../infra/health.ts'
import { Outbox } from './outbox.ts'
import { Passes } from './passes.ts'
import { Setup } from './setup.ts'
import { feishuSettings } from '../sources/feishu.ts'
import { health, type Health, type SourceContext, type SourceHost } from '../sources/host.ts'
import { Sessions } from './sessions.ts'
import { Settings } from './settings.ts'
import { instancesOf, type Settings as SettingsValue, type SettingsSave } from '../policy.ts'
import { declarativeFileNames, loadDeclarative, resolveDeclarativePath } from './config-file.ts'
import { DeclarativeWriteBack } from './config-write.ts'
import { watchDeclarative } from './config-watch.ts'
import { sourceContextOf, type SourceContextDeps } from './source-context.ts'
import type { ResourceHost } from './resources.ts'
import { mainTools, type MainToolsHost } from './tools/main.ts'
import { executorTools, type ExecutorToolsHost } from './tools/executor.ts'
import { CHAT_ROUTER_PROMPT, type ChatRouterHost } from '../chat-router/host.ts'
import { chatRouterTools } from '../chat-router/tools.ts'
import { submitChatTicket } from '../chat-router/submit.ts'
import { ChatReplyWatcher } from '../chat-router/channel.ts'
import { inboxDir } from '../sources/inbox.ts'

// Source plugins interact with dsh-superagent exclusively through the `SourceHost` service interface.
declare module '@deepseek-ai/cordis' { interface Context { orchestrator: SourceHost } }
const now = (): string => new Date().toISOString()

/** Settings blocks whose values differ; an external declarative change advances their revisions so a stale panel reloads. */
function changedBlocks(from: SettingsValue, to: SettingsValue): SettingsSave[] {
  const blocks: SettingsSave[] = []
  if (JSON.stringify(from.paused) !== JSON.stringify(to.paused)) blocks.push('pause')
  for (const block of ['policy', 'eval', 'executor', 'chatRouter'] as const) {
    if (JSON.stringify(from[block]) !== JSON.stringify(to[block])) blocks.push(block)
  }
  for (const id of new Set([...Object.keys(from.sources), ...Object.keys(to.sources)])) {
    if (JSON.stringify(from.sources[id]) !== JSON.stringify(to.sources[id])) blocks.push(`source:${id}`)
  }
  return blocks
}

/**
 * Composition root of dsh-superagent that connects `Store`, `Setup`, `Engine`, `SourceRegistry`, `Effects`, `Outbox`, `Passes`, `Sessions`, `Settings`, `Prompts`, `DshExecutor`, and `MasterAssessor`.
 * Exposes the `SourceHost` service on the Cordis context for source plugins and coordinates startup, setup checks, HTTP route registration, and graceful shutdown.
 * Locks the state directory before opening SQLite so concurrent processes cannot corrupt or double-migrate state.
 */
export class Runtime extends Service implements SourceHost {
  readonly store: Store
  readonly setup: Setup
  readonly prompts: Prompts
  readonly effects: Effects
  readonly sources: SourceRegistry
  readonly commands: Commands
  readonly sessions: Sessions
  readonly settings: Settings
  readonly executor: DshExecutor
  readonly assessor: MasterAssessor
  readonly outbox: Outbox
  readonly engine: Engine
  readonly passes: Passes
  readonly ready: Promise<void>
  private readonly board = new HealthBoard()
  private readonly runtimeHealth = this.board.claim('runtime', { state: 'starting', detail: '' })
  readonly masterId: string
  private readonly sourceLinks = new TextCache(200_000)
  private readonly stopped = new AbortController()
  private readonly disposers: (() => void)[] = []
  private releaseLock?: () => Promise<void>
  private closingFlag = false
  /** Whether the declarative settings file is already watched; the watcher lives in `disposers`. */
  private declarativeWatched = false
  private stopping?: Promise<void>
  /** Every Router Session this process runs, in shard order; shard 0 is `masterId`. */
  private routerIdsValue: string[] = []
  /** Shard Router Sessions created so far; the master is always present. */
  private readonly routerSessions = new Set<string>()
  /** The `router` health entry, claimed once so a restart does not claim it twice. */
  private routerHealth?: ReturnType<HealthBoard['claim']>
  /** The Watchdog Session, which the external control loop prompts on a schedule. */
  readonly watchdogId!: string
  private watchdog?: WatchdogLoop
  /** The snapshot the last digest was built from, so an unchanged system costs no model turn. */
  private watchdogPrevious?: import('./watchdog.ts').WatchdogSnapshot
  /** The interval that publishes `instance-status.json` and the last content it wrote, so an unchanged system is only touched. */
  private statusTimer?: ReturnType<typeof setInterval>
  private statusText?: string
  private statusWarned = false
  /** This instance's own declarative settings file, when the machine configuration names one. */
  private readonly declarative?: DeclarativeWriteBack
  private readonly startedAt = new Date().toISOString()
  private readonly sourceDeps: SourceContextDeps
  private readonly toolHost: MainToolsHost & ExecutorToolsHost
  /** Non-zero while a main-Session tool is executing an Engine command, suppressing self-triggered domain event notices. */
  private quiet = 0
  constructor(ctx: Context, readonly machine: Machine, restart: () => void) {
    super(ctx, 'orchestrator')
    const runtime = this
    // Lock the state directory before opening the database so another process cannot migrate or write concurrently.
    mkdirSync(machine.stateDir, { recursive: true, mode: 0o700 })
    // A non-default instance that does not carry its state directory into the composition keeps DSH's shared roots,
    // so its sidebar lists the workspaces of other instances (docs/015 §5). Say it once, with the fix.
    const sharedRoots = dataHomeProblem(machine.stateDir)
    if (sharedRoots) ctx.logger.warn('dsh-superagent: %s', sharedRoots)
    const compromised = (error: Error) => { this.runtimeHealth.set({ state: 'error', detail: error.message }); this.stopped.abort() }
    const release = acquireStateLock(machine.stateDir, { onCompromised: compromised })
    this.releaseLock = async () => { release() }
    let opened: Store | undefined
    try {
      const report = (error: unknown) => { ctx.logger.warn('dsh-superagent: %s', String(error)) }
      const store = opened = this.store = new Store(join(machine.stateDir, 'orchestrator.sqlite'), report)
      // Panel saves go back into this instance's own file; without one, they stay in the store, which is per instance anyway.
      this.declarative = machine.configPath ? new DeclarativeWriteBack(machine.configPath) : undefined
      const setup = this.setup = new Setup({ context: ctx, machine, lifetime: this.lifetime, restart })
      const githubId = () => instancesOf(store.settings(), 'github')[0]
      const deployed = () => setup.configured()
        ? environmentOf({ deployment: setup.deployment, sources: this.sources, settings: store.settings() }) : undefined
      const feishu = () => setup.configured() && !!setup.deployment.feishu
      const prompts = this.prompts = new Prompts(store, () => machine.promptMaxChars.get(), deployed, feishu)
      const masterId = this.masterId = store.get(KV.runtime.masterId) ?? `orchestrator-${key(machine.stateDir)}`
      // Router Sessions: the master, plus one per shard when the operator asked for sharding (article §2.1).
      this.routerIdsValue = shardSessionIds(masterId, store.settings().executor.routerShards)
      // A Session of its own, outside the Router: the external control loop of the official design (article §6).
      this.watchdogId = `watchdog-${key(machine.stateDir)}`
      store.set(KV.runtime.masterId, masterId)
      const commands = this.commands = new Commands(() => setup.deployment, setup.commandEnvironment, this.lifetime)
      const board = this.board
      const effects = this.effects = new Effects(store, board)
      const sources = this.sources = new SourceRegistry(() => store.settings(), board, kind => {
        // Sync source member lists once startup completes when a source plugin loads dynamically.
        if (kind.policy?.sync) void this.ready?.then(() => this.settings.syncable().includes(kind.kind) ? this.settings.sync(kind.kind) : undefined)
          .catch(() => { /* sync() records its failure in health. */ })
        return () => {}
      })
      const links: LinkHost = { store, links: this.sourceLinks, commands, sources, lifetime: this.lifetime }
      const link = (trigger: Trigger, signal?: AbortSignal) => sourceLink(links, trigger, signal)
      const environment = (ticket: Ticket) => this.ticketEnvironment(ticket)
      const resources: ResourceHost = { store, pages: new TextCache(4_000_000), prompts, commands, masterId, context: ctx,
        promptVersion: id => this.sessions.promptVersion(id), mayRead: (id, revision) => this.sessions.mayRead(id, revision),
        feishuPageSize: () => feishuSettings(sources).readPageSize, sourceLink: link }
      // The chat chief of staff writes ordinary inbox files, so dispatching uses the exact same Trigger → Ticket →
      // isolated worker Session path as a dropped .md. Nothing about it depends on a fixed main-chat session id.
      const chatInboxRoot = (): string => {
        const inbox = sources.instances().find(instance => (instance.kind ?? instance.id) === 'inbox' && instance.enabled)
        if (!inbox) throw new Error('No enabled local inbox Source: turn it on under Settings → Source before using the chat chief of staff.')
        const config = (inbox.config ?? {}) as { inboxDir?: string; actor?: string; pollSeconds?: number }
        return inboxDir({ stateDir: machine.stateDir }, { inboxDir: config.inboxDir ?? '', actor: config.actor ?? 'local',
          pollSeconds: config.pollSeconds ?? 10 })
      }
      const chatRouter: ChatRouterHost = {
        settings: () => store.settings().chatRouter,
        prompt: () => CHAT_ROUTER_PROMPT,
        tools: agent => chatRouterTools({
          submit: async (title, request, context) => submitChatTicket(chatInboxRoot(), title, request, agent.id, context),
          status: async () => ({ tickets: store.tickets.list().slice(0, 20).map(ticketCard) }),
          answer: async (ticketId, text) => { this.engine.note(ticketId, text); return { noted: true } },
        }),
      }
      const sessions = this.sessions = new Sessions({ context: ctx, store, prompts, effects, health: board.claim('models'), masterId,
        routerIds: () => this.routerIdsValue,

        lifetime: this.lifetime,
        closing: () => this.closing(), environment,
        tools: (agent, ticket) => ticket ? executorTools(this.toolHost, ticket) : mainTools(this.toolHost, agent),
        chatRouter })
      const policyChanged: EngineForSettings['policyChanged'] = (from, to, effects) => { this.engine.policyChanged(from, to, effects) }
      this.settings = new Settings({ store, sources, engine: { policyChanged }, health: board, context: ctx, lifetime: this.lifetime, sessions,
        sourceHost: this, setup, requestPass: () => { this.passes.request() }, declarative: this.declarative })
      this.executor = new DshExecutor({ context: ctx, get engine() { return runtime.engine }, store, effects, health: board.claim('worker'), machine,
        lifetime: this.lifetime, sessions, closing: () => this.closing(), paused: () => this.paused(), environment, sourceLink: link,
        repliedTo: trigger => repliedTo({ store, sources }, trigger) })
      this.assessor = new MasterAssessor({ get engine() { return runtime.engine }, commands, get deployment() { return setup.deployment }, effects,
        settings: () => store.settings(), paused: () => this.paused(), threadContext: trigger => sources.threadContext(trigger),
        deliver: async (id, text, thread) => {
          const target = this.routerFor(thread)
          await this.ensureRouterSession(target)
          await sessions.prompt(target, id, text, 'steer')
        },
        candidateCard: candidate => candidateCard(links, candidate) })
      const outbox = this.outbox = new Outbox({ store, effects, sources, commands, paused: () => this.paused() })
      const { assessor, executor } = this
      const policy = () => settingsPolicy(store.settings(), sources)
      const engine = this.engine = new Engine({ repo: store, scope: sources, policy, assessor, executor,
        outbox, prepareTicket: (ticket, outcome) => executor.prepare(ticket, outcome), emit: event => {
          // Notify the main Session only about domain events it did not initiate itself.
          const notice = this.quiet ? undefined : eventNotice(event, id => store.tickets.get(id))
          if (notice) sessions.notify(...notice)
          // A person's message that reached an open ticket is the ticket's; the main Session hears of it in the same transaction,
          // and of one for an ended ticket once it resumes, unless it routed the message there itself.
          const followed = !this.quiet && (event.type === 'trigger.received' || event.type === 'ticket.resumed' || event.type === 'trigger.followup')
          const followup = followed ? followupNotice(store, sources, event.data.triggerId) : undefined
          if (followup) sessions.relay(followup.id, followup.text)
          // Notify the ticket's conversations whenever it ends via a pull request.
          const ended = event.type === 'ticket.ended' ? store.tickets.get(event.data.ticketId) : undefined
          if (ended && setup.configured()) {
            const request = store.triggers.get(ended.origin.triggerId)?.text ?? ''
            for (const message of pullEndNotices(ended, request, setup.deploymentFor(ended.channels[0]?.source).repository)) outbox.send(message)
          }
        } })
      // Update the `evals` health entry on every pass if an evaluation failed as unavailable within the last hour.
      const evals = board.claim('evals', { state: 'ready', detail: 'No unavailable Eval in the last hour' })
      const evaluateDue = () => { engine.evaluateDue(); evals.set(evalsHealth(store)) }
      const passes = this.passes = new Passes({ engine: { receive: trigger => engine.receive(trigger), evaluateDue }, effects,
        health: this.runtimeHealth, lifetime: this.lifetime, configured: () => setup.configured(), closing: () => this.closing() })
      const commandsFor = (instance?: string) => instance === undefined || instance === (githubId() ?? 'github')
        ? commands
        : new Commands(() => setup.deploymentFor(instance), setup.commandEnvironment, this.lifetime)
      this.sourceDeps = { store, engine, outbox, commands, commandsFor, sources, get ready() { return runtime.ready },
        get deployment() { return setup.deployment }, deploymentFor: instance => setup.deploymentFor(instance),
        configured: () => setup.configured(),
        get setupProblem() { return setup.problem }, problemFor: instance => setup.problemFor(instance),
        get feishuProblem() { return setup.feishuProblem }, receive: trigger => passes.receive(trigger) }
      this.toolHost = { context: ctx, engine, store, prompts, sessions, settings: this.settings, assessor, resources,
        get github() { return runtime.context({ kind: 'github', health: ['github'] }) },
        requestPass: () => { passes.request() }, sendReplies: () => outbox.sent(),
        quietly: run => { this.quiet++; try { return run() } finally { this.quiet-- } } }
      this.ready = this.initialize()
      // The cross-instance viewer reads this file instead of opening our database, so start publishing before the
      // asynchronous startup finishes: an instance waiting for setup is exactly one an operator wants to see.
      this.publishStatus('starting')
      this.statusTimer = setInterval(() => { this.publishStatus('running') }, INSTANCE_STATUS_INTERVAL_MS)
      this.statusTimer.unref?.()
      // Mode A reply files are the bridge back to the main chat that dispatched a task: only a bounded brief is sent.
      const briefs = new ChatReplyWatcher(chatInboxRoot, async (sessionId, text) => {
        try { await sessions.prompt(sessionId, `chat-brief:${key(text)}`, text, 'steer') }
        catch { /* The main chat may have been closed; the reply itself stays archived under done/. */ }
      })
      const briefTimer = setInterval(() => {
        if (store.settings().chatRouter.reply.mode === 'brief') void briefs.tick().catch(() => {})
      }, 5000)
      briefTimer.unref?.()
      this.disposers.push(() => clearInterval(briefTimer))
    } catch (error) {
      // Release the database and state lock if initialization fails so an in-process restart can reacquire them.
      try { opened?.close() } finally { release() }
      throw error
    }
  }
  get health(): Readonly<Record<string, Health>> { return this.board.all }
  /** Aborted when dsh-superagent stops or loses its state directory lock, cancelling running reads and subprocesses. */
  get lifetime(): AbortSignal { return this.stopped.signal }
  context(kind: { kind: string; health: readonly string[] }, instance?: string): SourceContext { return sourceContextOf(this.sourceDeps, kind, instance) }
  /** Resolved deployment; throws while waiting for setup (`!configured()`). */
  get deployment(): Deployment { return this.setup.deployment }
  configured(): boolean { return this.setup.configured() }
  get setupProblem(): SetupProblem | undefined { return this.setup.problem }
  /** Why the Feishu bot is unavailable even though the Feishu Source configures a CLI. */
  get feishuProblem(): SetupProblem | undefined { return this.setup.feishuProblem }
  links(): LinkTarget {
    const resolved = this.setup.configured() ? this.setup.deployment : undefined
    const links = resolved ? { repository: resolved.repository, ...(resolved.feishu ? { feishu: resolved.feishu } : {}) } : {}
    return channel => this.sources.link(channel, links)
  }
  ticketEnvironment(ticket: Ticket): Variable[] {
    const trigger = sourceTrigger(this, ticket)
    const { setup: { deployment }, sources } = this
    // The variables follow the ticket's own Source, so a ticket from the second repository carries that repository.
    return ticketEnvironment({ deployment: this.setup.deploymentFor(ticket.channels[0]?.source), sources, settings: this.store.settings(), ticket, ...trigger ? { trigger } : {} })
  }
  checkSetup(): void { this.setup.check() }
  receive(trigger: Trigger): ReceiveResult { return this.passes.receive(trigger) }
  idle(): Promise<void> { return this.passes.idle() }
  pump(): Promise<void> { return this.passes.pump() }
  sendReplies(): Promise<void> { return this.outbox.sent() }
  private closing(): boolean { return this.closingFlag }
  /** Hold evaluation, dispatch, and outbound delivery while paused or awaiting setup; sources still record incoming triggers. */
  private paused(): boolean { return !this.setup.configured() || this.store.settings().paused }
  private async initialize(): Promise<void> {
    // Register management HTTP routes before setup completes so operators can fix setup problems in the UI.
    this.disposers.push(registerHttp(this.ctx, this.httpHost()))
    this.applyDeclarativeSettings()
    if (!await this.setup.run(this.store.settings())) {
      this.runtimeHealth.set({ ...health('paused', 'setupPending'), at: now() })
      return
    }
    this.sessions.install()
    this.executor.install()
    await this.sessions.ensure(this.masterId, this.machine.stateDir, 'dsh-superagent orchestrator', 'orchestrator')
    this.reportRouterHealth()
    for (const id of this.settings.syncable()) await this.settings.sync(id).catch(() => { /* sync() records its failure in health. */ })
    // If stop() was called while awaiting setup, session creation, or policy sync, do not start background loops.
    if (this.closing()) return
    this.executor.resume()
    this.passes.start()
    await this.startWatchdog()
    this.effects.start()
    this.runtimeHealth.set({ state: 'ready', detail: 'Orchestrator is ready', at: now() })
  }
  /**
   * Apply the declarative settings file the machine configuration names, so Sources, Policy, Execution and Prompts
   * can live in version control. JSON and YAML are both accepted and both end in the same validation, chosen by the
   * file extension. A malformed file is logged and ignored: a typo must not stop the service, and the panel keeps
   * showing the settings that were already stored.
   *
   * The file is watched from the first apply on, so saving an edit is enough: no service restart, no panel trip.
   * Only a change to the set of Source instances still costs one restart, because a Source's polling loop is mounted
   * with the plugin and cannot be added or removed underneath a running pass.
   */
  private applyDeclarativeSettings(): void {
    const configured = this.machine.configPath
    if (!configured) return
    if (!this.declarativeWatched) {
      this.declarativeWatched = true
      const watcher = watchDeclarative(declarativeFileNames(configured), () => {
        if (this.closing()) return
        this.ctx.logger.info('dsh-superagent: %s changed; re-applying the declarative settings', configured)
        this.applyDeclarativeSettings()
      })
      this.disposers.push(() => { watcher.close() })
    }
    // The extension of the file that exists picks the reader: `.yaml`/`.yml` or JSON. The configured name wins when
    // several formats exist side by side.
    const path = resolveDeclarativePath(configured)
    if (path !== configured) this.ctx.logger.info('dsh-superagent: using %s for the configured %s', path, configured)
    const current = this.store.settings()
    // Remember the state we are about to apply, so a later panel save can tell an external edit from its own write.
    this.declarative?.observe()
    const result = loadDeclarative(path, current)
    if ('error' in result) { this.ctx.logger.warn('dsh-superagent: %s', result.error); return }
    if (JSON.stringify(result.settings) === JSON.stringify(current)) return
    const before = instancesOf(current, 'github').join(',')
    const after = instancesOf(result.settings, 'github').join(',')
    this.store.atomic(() => {
      this.store.saveSettings(result.settings, { source: 'internal', policyVersion: '', policyChanged: false, notified: [] })
      // An external edit is a settings change: advance each affected block's revision so a panel showing older values
      // has to reload before saving instead of silently reverting the edit.
      for (const block of changedBlocks(current, result.settings)) this.store.bumpBlock(block)
    })
    this.ctx.logger.info('dsh-superagent: applied the declarative settings in %s', path)
    // A Source's polling loop is started when its plugin mounts, which happens before this file is applied. A changed set
    // of instances therefore needs one restart, exactly like a changed account: otherwise a Source added here would be
    // listed but never poll, and one removed here would keep polling.
    if (before !== after) {
      this.ctx.logger.info('dsh-superagent: the declarative settings changed the Source instances (%s -> %s); restarting to mount them', before, after)
      this.setup.restart()
    }
  }
  /**
   * Creates one Router shard Session the first time a delivery needs it. Eager provisioning was removed: an idle shard
   * Session appears in the UI, DSH's own preset selection can take it over, and DSH refuses a preset change after the
   * Session's first turn — leaving a Session that is not ours to manage.
   */
  private async ensureRouterSession(id: string): Promise<void> {
    if (id === this.masterId || this.routerSessions.has(id)) return
    const index = this.routerIdsValue.indexOf(id)
    await this.sessions.ensure(id, this.machine.stateDir, `dsh-superagent orchestrator shard ${index}`, 'orchestrator')
    this.routerSessions.add(id)
    this.reportRouterHealth()
  }
  /** The Router Session that owns a Thread: the master while sharding is off, else the shard the Thread hashes to. */
  private routerFor(thread?: string): string {
    return triggerSessionId(thread ? { thread } : {}, this.masterId, this.routerIdsValue.length)
  }
  /** Reports how many Router Sessions serve this instance, so a sharded deployment is visible in health. */
  private reportRouterHealth(): void {
    const count = this.routerIdsValue.length
    try {
      this.routerHealth ??= this.board.claim('router', { state: 'ready', detail: '' })
      const live = count === 1 ? 1 : this.routerSessions.size + 1
      this.routerHealth.set({ state: 'ready', detail: count === 1 ? 'one Router Session'
        : `${live} of ${count} Router Sessions (sharded by Thread; a shard starts on its first delivery)` })
    } catch (error) { this.ctx.logger.warn('dsh-superagent could not report Router health: %s', String(error)) }
  }
  /**
   * Ensure the Watchdog Session and start its loop. It is deliberately outside the Router: it receives no Triggers,
   * takes no work, and cannot answer people — it only observes and intervenes.
   */
  private async startWatchdog(): Promise<void> {
    const minutes = this.store.settings().executor.watchdogMinutes
    if (minutes <= 0) return
    try {
      await this.sessions.ensure(this.watchdogId, this.machine.stateDir, 'dsh-superagent watchdog', 'worker')
    } catch (error) {
      this.ctx.logger.warn('dsh-superagent could not create its watchdog Session: %s', String(error))
      return
    }
    const loop = new WatchdogLoop({
      everyMinutes: () => this.store.settings().executor.watchdogMinutes,
      digest: () => {
        const next = this.watchdogSnapshot()
        // Silence is the point: with nothing changed, nothing unhealthy, no new stall and no standing instruction,
        // the control loop must not spend a model turn. An empty digest means this tick says nothing.
        const executor = this.store.settings().executor
        if (!watchdogDue(this.watchdogPrevious, next, executor.watchdogStallMinutes)) return ''
        this.watchdogPrevious = next
        return watchdogDigest(next, executor.watchdogMinutes)
      },
      deliver: async text => {
        const settings = this.store.settings()
        await this.sessions.prompt(this.watchdogId, `watchdog-${Date.now()}`, text, 'queue', undefined,
          () => { void settings })
      },
      log: message => this.ctx.logger.warn('dsh-superagent: %s', message),
    })
    this.watchdog = loop
    loop.start()
    this.ctx.logger.info('dsh-superagent watchdog: every %d min', minutes)
  }
  /** What the system believes is happening, as the digest words it. */
  private watchdogSnapshot() {
    const now = Date.now()
    const open = this.store.tickets.open()
    const tickets = open.map(ticket => ({
      id: ticket.id,
      title: ticket.title,
      states: assignmentStates(ticket),
      quietMinutes: quietMinutes(ticket.updatedAt, now),
      stalled: false,
    }))
    const stalled = stalledIds(tickets, this.store.settings().executor.watchdogStallMinutes)
    for (const ticket of tickets) ticket.stalled = stalled.has(ticket.id)
    return {
      tickets,
      running: tickets.reduce((sum, ticket) => sum + ticket.states.filter(state => state === 'running').length, 0),
      queued: this.store.tickets.open().length,
      maxWorkers: this.store.settings().executor.maxWorkers,
      problems: watchdogProblems(this.board.all),
      apiBase: `http://127.0.0.1:${process.env.DSH_SUPERAGENT_WATCHDOG_API_PORT ?? 3082}/orchestrator/api`,
      paused: this.store.settings().paused,
      guidance: this.store.settings().executor.watchdogGuidance,
    }
  }
  /**
   * Publishes what other instances' viewers may read. Content is rewritten only when it changes; otherwise the mtime
   * is touched, which is the heartbeat the viewer measures. Nothing here feeds a Watchdog decision — the snapshot is
   * only summarised (counts, no titles) and the loop's own schedule is reported as it already stands.
   */
  private publishStatus(state: InstanceStatus['state']): void {
    try {
      const settings = this.store.settings()
      const snapshot = this.watchdogSnapshot()
      const status: InstanceStatus = {
        schema: INSTANCE_STATUS_SCHEMA,
        name: process.env.SUPERAGENT_INSTANCE || null,
        pid: process.pid,
        startedAt: this.startedAt,
        writtenAt: new Date().toISOString(),
        state,
        health: this.board.all,
        load: { ...executorLoad(this.store, this.executor.activeCount()), maxWorkers: settings.executor.maxWorkers },
        paused: this.paused(),
        setup: { configured: this.setup.configured(), problem: this.setupProblem
          ? { place: this.setupProblem.place, code: this.setupProblem.code, detail: this.setupProblem.detail } : null },
        watchdog: { everyMinutes: settings.executor.watchdogMinutes, stallMinutes: settings.executor.watchdogStallMinutes,
          lastTickAt: this.watchdog?.lastTickAt ?? null },
        tickets: { open: snapshot.tickets.length, stalled: snapshot.tickets.filter(ticket => ticket.stalled).length },
        configPath: this.machine.configPath ?? null,
      }
      const content = JSON.stringify({ ...status, writtenAt: '' })
      if (content === this.statusText) { touchInstanceStatus(this.machine.stateDir); return }
      writeInstanceStatus(this.machine.stateDir, status)
      this.statusText = content
    } catch (error) {
      // One warning per process: a state directory that cannot hold the file must not flood the log every interval.
      if (!this.statusWarned) {
        this.statusWarned = true
        this.ctx.logger.warn('dsh-superagent could not publish its instance status: %s', String(error))
      }
    }
  }
  private httpHost(): HttpHost {
    const runtime = this
    const { store, sources, prompts, sessions, settings, engine, executor, health, machine, masterId, ready, sourceLinks, setup, passes } = this
    return { store, sources, prompts, sessions, settings, engine, executor, health, machine, masterId, ready, sourceLinks,
      get deployment() { return setup.deployment },
      get setupProblem() { return setup.problem }, get feishuProblem() { return setup.feishuProblem },
      configured: () => setup.configured(), links: () => runtime.links(), ticketEnvironment: ticket => runtime.ticketEnvironment(ticket),
      checkSetup: () => { setup.check() }, requestPass: () => { passes.request() }, models: () => this.ctx.sessionController.modelCatalog() }
  }
  /** Idempotent stop; concurrent or repeated calls share the same shutdown promise. */
  stop(): Promise<void> { return this.stopping ??= this.shutdown() }
  private async shutdown(): Promise<void> {
    if (this.statusTimer) clearInterval(this.statusTimer)
    this.statusTimer = undefined
    this.publishStatus('stopping')
    this.closingFlag = true; const passes = this.passes.stop(); this.stopped.abort()
    try {
      this.assessor.stop()
      const ids = [this.masterId, ...this.store.tickets.list().map(ticket => workerSessionId(ticket.id))]
      const agents = ids.map(id => this.ctx.agents.get(id as SessionId)).filter((agent): agent is Agent => agent !== undefined)
      for (const agent of agents) agent.cancel({ kind: 'user' }, { keepInbox: true })
      await Promise.allSettled([passes, this.effects.drain(), ...agents.map(agent => agent.whenIdle())])
      // The workers' jobs and subagents stop too: their ends would start worker turns without the tool limits released below.
      this.watchdog?.stop()
      await this.executor.shutdown()
      this.executor.dispose()
      this.sessions.dispose()
      for (const dispose of this.disposers.reverse()) dispose()
      await this.ctx.sessionPersistence.flush()
    } finally {
      // Close the database before releasing the directory lock so another process cannot open the database mid-write; a compromised lock may already be released.
      this.setup.restore()
      try { this.store.close() } finally {
        const unreleased = (error: unknown) => { this.ctx.logger.warn('dsh-superagent could not release its state directory lock: %s',
          String(error)) }
        await this.releaseLock?.().catch(unreleased)
      }
    }
  }
}
