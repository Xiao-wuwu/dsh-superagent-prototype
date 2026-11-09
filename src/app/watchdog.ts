/**
 * Watchdog: the external control loop of the official design (article §6).
 *
 * The main system cannot guarantee its own long-term health — a process that dies stays dead, and a Worker that spins
 * without progress looks exactly like a busy one from the inside. The Watchdog therefore lives *outside* the Router: a
 * separate Session with full tools, woken by a scheduled message, which receives a digest of what the system believes is
 * happening and is asked to judge two things the infrastructure cannot: whether the Workers make real progress and
 * whether they drift from the goal. Infrastructure faults (a part in error, a stalled queue) are in the same digest, so
 * one loop covers both.
 */
import type { Ticket } from '../core/index.ts'

export interface WatchdogSnapshot {
  /** Open Tickets with their Assignment states, oldest activity first. */
  tickets: readonly { id: string; title: string; states: readonly string[]; quietMinutes: number; stalled: boolean }[]
  /** Executor load at the moment of the digest. */
  running: number
  queued: number
  maxWorkers: number
  /** Health entries that are not ready, with the detail they report. */
  problems: readonly { part: string; state: string; detail: string }[]
  /** Local management API the Watchdog may call to act, with the header its panel uses. */
  apiBase: string
  paused: boolean
  /** Standing instruction from the operator, repeated in every digest. */
  guidance?: string
}

const minutes = (value: number): string => (value < 1 ? 'under a minute' : `${Math.round(value)} min`)

/**
 * Builds the scheduled message. It states what is known, then asks for the judgement only a model can make, and keeps
 * the rules short: silence is the default, intervention needs a reason.
 */
export function watchdogDigest(snapshot: WatchdogSnapshot, intervalMinutes: number): string {
  const lines: string[] = []
  lines.push(`[dsh-superagent watchdog, every ${intervalMinutes} min]`)
  lines.push('')
  lines.push('You are the external control loop of this dsh-superagent instance. You are not the Router: do not take work, do')
  lines.push('not answer people, do not edit Tickets. Your only job is to notice what the system cannot notice about itself,')
  lines.push('then fix it or report it.')
  lines.push('')
  lines.push('Current state:')
  lines.push(`- Executor: ${snapshot.running}/${snapshot.maxWorkers} running, ${snapshot.queued} queued${snapshot.paused ? ', processing paused' : ''}.`)
  if (snapshot.tickets.length === 0) {
    lines.push('- No open Tickets.')
  } else {
    lines.push('- Open Tickets:')
    for (const ticket of snapshot.tickets) {
      const states = ticket.states.length ? ticket.states.join('/') : 'no Assignment'
      lines.push(`  - ${ticket.id} "${ticket.title}" — ${states}, quiet for ${minutes(ticket.quietMinutes)}${ticket.stalled ? ', STALLED' : ''}`)
    }
  }
  if (snapshot.problems.length === 0) {
    lines.push('- Every health part is ready.')
  } else {
    lines.push('- Parts that are not ready:')
    for (const problem of snapshot.problems) lines.push(`  - ${problem.part}: ${problem.state} — ${problem.detail}`)
  }
  if (snapshot.guidance) {
    lines.push('')
    lines.push('Standing instruction from the operator (follow it over your own judgement when they conflict):')
    lines.push(snapshot.guidance)
  }
  lines.push('')
  lines.push('Judge, in this order:')
  lines.push('1. A part in error, or a queue that cannot drain: is it a transient fault to retry, or a configuration problem? A')
  lines.push('   configuration problem is reported, never worked around by editing code.')
  lines.push('2. A Ticket whose Assignment states and quiet time suggest no real progress: read its Session, decide whether it')
  lines.push('   is working or stuck, and either unblock it (retry) or stop it and say why.')
  lines.push('3. A Ticket drifting from the goal in its request: say so plainly; the person decides.')
  lines.push('')
  lines.push(`Act through the local management API, which needs the header x-orchestrator-request: 1: ${snapshot.apiBase}`)
  lines.push('(`GET state`, `GET sources`, `POST tickets/<id>/retry`, `POST tickets/<id>/stop`, `POST executor/pause`.)')
  lines.push('')
  lines.push('Stay quiet when everything is healthy: no progress report, no summary, no "all clear". If you act or find something a')
  lines.push('person must know, say it in two sentences and name the Ticket or part. Never repeat a report already made.')
  return lines.join('\n')
}

/** Minutes since `at`, never negative. */
export function quietMinutes(at: string | undefined, now: number): number {
  const then = Date.parse(at ?? '')
  return Number.isFinite(then) ? Math.max(0, (now - then) / 60_000) : 0
}

/** The Assignment states of one Ticket, which is what "looks busy but is it moving" is judged from. */
export const assignmentStates = (ticket: Ticket): string[] => (ticket.assignments ?? []).map(assignment => assignment.state)

/** Health entries worth reporting to the Watchdog: everything that is not ready, with `runtime` first when it is bad. */
export const watchdogProblems = (health: Readonly<Record<string, { state: string; detail: string }>>): { part: string; state: string; detail: string }[] =>
  Object.entries(health)
    .filter(([, entry]) => entry.state !== 'ready')
    .map(([part, entry]) => ({ part, state: entry.state, detail: entry.detail }))
    .sort((a, b) => (a.part === 'runtime' ? -1 : b.part === 'runtime' ? 1 : a.part.localeCompare(b.part)))

/**
 * The schedule itself: prompt the Watchdog Session once per interval. A tick that fails is logged and forgotten — the
 * loop belongs outside the main system, so it must survive its own errors like everything else it watches.
 */
export class WatchdogLoop {
  private timer?: ReturnType<typeof setInterval>
  /** When `tick()` last ran; read by the instance status file, never used to decide whether to tick. */
  lastTickAt: string | null = null
  constructor(private readonly host: {
    everyMinutes: () => number
    digest: () => string
    deliver: (text: string) => Promise<void>
    log: (message: string) => void
  }) {}

  start(): void {
    const every = this.host.everyMinutes()
    if (every <= 0 || this.timer) return
    this.timer = setInterval(() => { void this.tick() }, every * 60_000)
    // Never hold the process open for the watchdog alone.
    this.timer.unref?.()
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
  /** One digest delivery; public so a restart or a test can drive it without waiting for the interval. */
  async tick(): Promise<void> {
    if (this.host.everyMinutes() <= 0) return
    this.lastTickAt = new Date().toISOString()
    try {
      const text = this.host.digest()
      if (!text) return
      await this.host.deliver(text)
    } catch (error) {
      this.host.log(`the watchdog digest could not be delivered: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** A Ticket counts as stalled once its Assignment states have not changed for `stallMinutes` while it still has work. */
export const stalledIds = (tickets: WatchdogSnapshot['tickets'], stallMinutes: number): Set<string> =>
  new Set(tickets.filter(ticket => ticket.states.some(state => state === 'running' || state === 'queued') && ticket.quietMinutes >= stallMinutes)
    .map(ticket => ticket.id))

/** Whether anything a digest is worth sending for changed since the previous tick. */
export function watchdogChanged(previous: WatchdogSnapshot | undefined, next: WatchdogSnapshot, stallMinutes: number): boolean {
  if (!previous) return true
  if (previous.paused !== next.paused || previous.running !== next.running || previous.queued !== next.queued) return true
  // A standing instruction is news when it changes, not every tick: repeating it each time would wake the model for free.
  if ((previous.guidance ?? '') !== (next.guidance ?? '')) return true
  // A part entering or leaving trouble is always worth a message.
  const key = (problems: WatchdogSnapshot['problems']) => problems.map(problem => problem.part + ':' + problem.state).join('|')
  if (key(previous.problems) !== key(next.problems)) return true
  // A Ticket that just became stalled is news; one that was already stalled and is still stalled is not.
  const before = new Set(previous.tickets.filter(ticket => ticket.stalled).map(ticket => ticket.id))
  return next.tickets.some(ticket => ticket.stalled && !before.has(ticket.id))
}

/** True when a digest has something to say: a change, an unhealthy part, a stall, or operator guidance. */
export const watchdogDue = (previous: WatchdogSnapshot | undefined, next: WatchdogSnapshot, stallMinutes: number): boolean =>
  next.problems.length > 0 || watchdogChanged(previous, next, stallMinutes)
