/** Probes repository and account CLIs, configures the worker execution environment and command shims, and tracks setup readiness. */
import type { Context } from '@deepseek-ai/cordis'
import { UserError } from '../core/index.ts'
import { SETUP_FIELDS, localDeployment, resolveDeployment, resolveFeishuBot, workerProbe, type Deployment, type Machine } from '../deployment.ts'
import { agentVariables, applyEnvironment, verifyEnvironment, withoutDirectory, workerBin, writeEnvironment } from '../infra/environment.ts'
import { instancesOf, type Settings, type SettingsBlock } from '../policy.ts'
import { SetupError, type SetupProblem } from '../setup.ts'

export interface SetupHost {
  readonly context: Context
  readonly machine: Machine
  readonly lifetime: AbortSignal
  restart(): void
}

const setupFields = (settings: Settings) =>
  JSON.stringify(Object.entries(SETUP_FIELDS).map(([id, keys]) => keys.map(key => settings.sources[id]?.config[key] ?? '')))
export const setupChanged = (before: Settings, after: Settings): boolean => setupFields(before) !== setupFields(after)

/**
 * Resolves the target repository, GitHub account, and optional Feishu bot by probing CLIs, then writes and applies the isolated git and shim environment used by worker processes.
 * `Runtime` runs it at startup to gate orchestration readiness, while `Settings` uses it to validate account changes, update blocked command shims, and schedule restarts.
 */
export class Setup {
  private resolved?: Deployment
  /** Deployments by Source instance id; the first resolved one is the primary and backs `deployment`. */
  private readonly deployments = new Map<string, Deployment>()
  /** Setup problems by Source instance id, so one instance can fail without hiding another's. */
  private readonly problems = new Map<string, SetupProblem>()
  private resolvedId?: string
  problem?: SetupProblem
  feishuProblem?: SetupProblem
  /** PATH with the worker shim directory removed so the host's own CLI calls invoke the real binaries. */
  private readonly path: string
  /** Environment variables pointing agent subprocesses at the isolated git config and command shims. */
  private readonly variables: Record<string, string | undefined>
  private restoreEnvironment?: () => void
  constructor(private readonly host: SetupHost) {
    this.path = withoutDirectory(process.env.PATH ?? '', workerBin(host.machine.stateDir))
    this.variables = agentVariables(host.machine.stateDir)
  }
  /** Host command environment with agent git variables applied and the worker shim directory excluded from PATH. */
  get commandEnvironment(): Record<string, string | undefined> { return { ...this.variables, PATH: this.path } }
  get deployment(): Deployment {
    if (!this.resolved) throw new Error(`dsh-superagent is waiting for setup: ${this.problem?.detail ?? 'setup has not run'}`)
    return this.resolved
  }
  /** The deployment of one Source instance, falling back to the primary while only one is served. */
  deploymentFor(instance?: string): Deployment {
    const resolved = instance ? this.deployments.get(instance) : undefined
    return resolved ?? this.deployment
  }
  /** The setup problem recorded for one instance, falling back to the primary problem. */
  problemFor(instance?: string): SetupProblem | undefined {
    return (instance ? this.problems.get(instance) : undefined) ?? this.problem
  }
  configured(): boolean { return this.resolved !== undefined }
  /** Resolve deployment accounts and apply the worker environment, recording `SetupError` failures in `problem`/`feishuProblem` and rethrowing unexpected errors. */
  async run(settings: Settings): Promise<boolean> {
    try {
      this.resolved = await this.resolve(settings)
      this.deployments.set(this.resolvedId ?? 'github', this.resolved)
      this.problems.delete(this.resolvedId ?? 'github')
      return true
    } catch (error) {
      if (!(error instanceof SetupError)) throw error
      this.problem = error.problem
      this.problems.set(this.resolvedId ?? 'github', error.problem)
      return false
    }
  }
  /** Trigger a restart to re-run setup, refusing if setup and Feishu are already healthy so running assignments are not interrupted. */
  check(): void {
    if (this.configured() && !this.feishuProblem) throw new UserError('setupComplete')
    this.restart()
  }
  /** Defer the restart to the next macrotask so the current HTTP or tool caller receives its response first. */
  restart(): void { setTimeout(this.host.restart, 0) }
  /** Verify account CLIs for a modified source block before saving, ignoring setup errors belonging to other blocks. */
  async checkAccounts(block: SettingsBlock, settings: Settings): Promise<void> {
    const { machine } = this.host
    if (block === 'source:github' && this.host.machine.mode === 'local') return
    const check = block === 'source:feishu' ? resolveFeishuBot(machine, settings.sources.feishu?.config, this.probe())
      : resolveDeployment(machine, settings.sources.github?.config, this.probe())
    await check.catch((error: unknown) => { if (!(error instanceof SetupError) || error.place === block.slice(7)) throw error })
  }
  async blockCommands(blocked: readonly string[]): Promise<void> {
    if (this.resolved) await writeEnvironment(this.resolved, blocked)
  }
  restore(): void { this.restoreEnvironment?.(); this.restoreEnvironment = undefined }
  /** Probes CLIs the way worker shells run them, using `stateDir` as `cwd` since it exists even before the repository clone is valid. */
  private probe() {
    const { context, machine, lifetime } = this.host
    return workerProbe(context.subprocess, machine.stateDir, machine.stateDir, lifetime)
  }
  private async resolve(settings: Settings): Promise<Deployment> {
    const { context, machine } = this.host
    const probe = this.probe()
    // Local mode: there is no repository to name and no account to probe, so tickets can only arrive on the inbox and
    // the deliverable is a local commit. The operator git environment is still written - minus the credential helper and
    // the github.com rewrites - so workers can commit.
    if (machine.mode === 'local') {
      this.resolvedId = undefined
      const local = localDeployment(machine)
      context.logger.info('dsh-superagent has no GitHub Source: tickets arrive on the inbox and deliver as local commits')
      return this.applyEnvironmentFor(local, settings)
    }
    // Several GitHub Sources are describable now (an instance names its kind), but one deployment is still resolved
    // per process: refusing is better than silently serving one repository with another instance's account.
    const ids = instancesOf(settings, 'github')
    // One Super-agent instance serves one context boundary (article §8.3): repositories that must not share memory,
    // policy or credentials get their own instance, not another Source in this process. Serving several here would
    // share one Router memory and one credential helper between them, which is the opposite of the design.
    if (ids.length > 1) throw new SetupError('multipleSourcesUnsupported', { sources: ids.join(', ') })
    const [githubId = 'github'] = ids
    this.resolvedId = githubId
    // Every instance is checked, so one broken account cannot hide behind a healthy one. Several repositories are
    // served as long as they share one agent account: the worker environment holds a single credential helper until
    // per-instance accounts land (C3), and serving two accounts through one would be worse than refusing.
    const deployments = new Map<string, Deployment>()
    for (const id of ids.length ? ids : ['github']) {
      deployments.set(id, await resolveDeployment(machine, settings.sources[id]?.config, probe))
    }
    const logins = new Set([...deployments.values()].map(item => item.github.login))
    if (logins.size > 1) throw new SetupError('multiAccountUnsupported', { accounts: [...logins].join(', ') })
    for (const [id, item] of deployments) this.deployments.set(id, item)
    const deployment = deployments.get(githubId)!
    const feishu = await resolveFeishuBot(machine, settings.sources.feishu?.config, probe).catch((error: unknown) => {
      if (!(error instanceof SetupError)) throw error
      this.feishuProblem = error.problem
      context.logger.warn('dsh-superagent leaves Feishu out: %s', error.message)
      return undefined
    })
    const resolved = { ...deployment, ...(feishu ? { feishu } : {}) }
    return this.applyEnvironmentFor(resolved, settings)
  }
  /** Write the worker git config and shims for `resolved`, apply them to this process, and verify them. */
  private async applyEnvironmentFor(resolved: Deployment, settings: Settings): Promise<Deployment> {
    const { context, machine, lifetime } = this.host
    const machineProblem = (error: unknown): never => {
      if (error instanceof SetupError) throw error
      throw new SetupError('environmentFailed', { output: error instanceof Error ? error.message : String(error) })
    }
    await writeEnvironment(resolved, settings.executor.blockedCommands).catch(machineProblem)
    this.restoreEnvironment = applyEnvironment(this.variables, machine.stateDir, this.path)
    await verifyEnvironment(resolved, context.subprocess, lifetime).catch((error: unknown) => {
      this.restore()
      machineProblem(error)
    })
    return resolved
  }
}
