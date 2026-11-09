/** Scoped runtime context exposed to each Source kind, isolating Sources from direct Store or Engine access. */
import type { EngineForSources, ReceiveResult, Trigger } from '../core/index.ts'
import type { Deployment } from '../deployment.ts'
import type { Commands } from '../infra/commands.ts'
import type { SetupProblem } from '../setup.ts'
import type { SourceContext } from '../sources/host.ts'
import type { SourceRegistry } from '../sources/registry.ts'
import type { Outbox } from './outbox.ts'
import type { Store } from './store.ts'
import { stateStoreOf } from './state-store.ts'

export interface SourceContextDeps {
  readonly store: Pick<Store, 'atomic' | 'get' | 'set' | 'delete' | 'keys' | 'threads' | 'tickets' | 'triggers' | 'read'>
  readonly outbox: Pick<Outbox, 'send'>
  readonly engine: Pick<EngineForSources, 'bindThread' | 'threadClosed'>
  readonly commands: Commands
  /** Commands scoped to one Source instance (its repository and account), defaulting to the shared one. */
  commandsFor?(instance?: string): Commands
  readonly sources: SourceRegistry
  /** Throws when accessed before initial setup completes. */
  readonly deployment: Deployment
  /** The deployment of one Source instance, which is the primary while only one is served. */
  deploymentFor?(instance?: string): Deployment
  readonly ready: Promise<void>
  configured(): boolean
  /** Setup problem whose `place` matches the Source kind receives it on `context.problem`. */
  readonly setupProblem?: SetupProblem | undefined
  /** The setup problem recorded for one Source instance. */
  problemFor?(instance?: string): SetupProblem | undefined
  /** Why setup found no Feishu bot even though the Feishu Source names a CLI. */
  readonly feishuProblem?: SetupProblem | undefined
  /** Hands a Trigger to the Engine and schedules the pass that assesses it. */
  receive(trigger: Trigger): ReceiveResult | Promise<ReceiveResult>
}

/**
 * Builds the context for one Source kind. Health reports are restricted to entries declared by the kind and
 * bound to the active registration, becoming no-ops once unregistered.
 */
export function sourceContextOf(deps: SourceContextDeps, kind: { kind: string; health: readonly string[] }, instance?: string): SourceContext {
  const { store } = deps
  // Every context carries the instance it belongs to, so a deployment, its Commands, its health entries and its setup
  // problem follow the instance rather than the process. With one instance the instance is the kind and nothing changes.
  const scope = instance ?? kind.kind
  const health = deps.sources.instanceHealth(kind, scope)
  const statePrefix = scope === kind.kind ? '' : `${scope}:`
  return {
    source: scope,
    get deployment() { return deps.deploymentFor ? deps.deploymentFor(scope) : deps.deployment },
    commands: deps.commandsFor ? deps.commandsFor(scope) : deps.commands,
    ready: deps.ready,
    configured: () => deps.configured(),
    get problem() {
      return [deps.feishuProblem, deps.problemFor ? deps.problemFor(scope) : deps.setupProblem]
        .find(problem => problem?.place === kind.kind)
    },
    config: <C extends Record<string, unknown>>(id: string) => {
      const resolved = deps.sources.instance<C>(id === kind.kind ? scope : id)
      return resolved?.enabled ? resolved.config : undefined
    },
    receive: trigger => deps.receive(trigger),
    atomic: work => store.atomic(work),
    // A Source's own state follows its instance (docs/017 P4 seam): cursors, retry tables and stream positions must not
    // be shared, or one instance would read another's items through the wrong repository scope.
    // The seam is structurally the same accessor; the cast only bridges its generic `get<V>` signature.
    state: stateStoreOf(store, statePrefix) as unknown as SourceContext['state'],
    threads: {
      get: key => store.threads.get(key),
      subscribed: source => store.read.subscribedThreads(source),
      describe: (key, description) => store.threads.describe(key, description),
      patch: (key, meta) => { store.threads.patchMeta(key, meta) },
    },
    tickets: {
      get: id => store.tickets.get(id),
      open: () => store.tickets.open(),
      bindThread: (id, thread, own) => { deps.engine.bindThread(id, thread, own) },
      threadClosed: (thread, outcome, at) => { deps.engine.threadClosed(thread, outcome, at) },
    },
    triggers: { get: id => store.triggers.get(id), latest: thread => store.read.threadTriggers(thread, 1)[0] },
    notify: message => { deps.outbox.send(message) },
    report: (entry, value) => {
      if (!kind.health.includes(entry)) throw new Error(`The ${kind.kind} Source has no health entry ${entry}`)
      health.get(entry)?.set(value)
    },
  }
}
