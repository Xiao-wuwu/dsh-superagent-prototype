/**
 * Where one instance's workspace registry and Session log live. The default instance keeps DSH's shared roots, so its
 * behaviour does not change; any other state directory gets its own pair, so a sidebar cannot list a workspace that
 * another instance created.
 *
 * The composition cannot read `stateDir`: a `!!js` root expression sees only `process` and `dshHomePath`. So
 * `cordis.patch.yml` mirrors this rule through `SUPERAGENT_DATA_HOME` — unset evaluates to the original
 * `dshHomePath('storages')` / `dshHomePath('sessions')`, and a second instance sets it to its state directory.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { sameDirectory } from '../infra/environment.ts'

/** The environment variable that carries a non-default state directory into the composition, never into the code. */
export const DATA_HOME_ENV = 'SUPERAGENT_DATA_HOME'

/** The state directory a profile names for the default, single instance. */
export const defaultStateDir = (home: string): string => join(resolve(home), 'state', 'superagent')

/** `$DSH_HOME`, or `~/.dsh`: the same precedence DSH's own `dshHomePath` applies, including a blank override. */
export function dshHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.DSH_HOME
  return resolve(configured !== undefined && configured.trim().length > 0 ? configured : join(homedir(), '.dsh'))
}

export interface InstanceRoots {
  /** The `storage-json` root holding `workspace.json`. */
  storages: string
  /** The `session-persistence-jsonl` root the sidebar lists from. */
  sessions: string
  /** True when the roots belong to this instance rather than to DSH's shared home. */
  scoped: boolean
}

/** Resolves both roots for `stateDir`: DSH's shared ones for the default instance, its own pair otherwise. */
export function instanceRoots(stateDir: string, home: string = dshHome()): InstanceRoots {
  const root = resolve(home)
  if (sameDirectory(stateDir, defaultStateDir(root))) return { storages: join(root, 'storages'), sessions: join(root, 'sessions'), scoped: false }
  const own = resolve(stateDir)
  return { storages: join(own, 'storages'), sessions: join(own, 'sessions'), scoped: true }
}

/**
 * Why a non-default instance still reads the shared roots, or undefined when it does not: absent or disagreeing
 * `SUPERAGENT_DATA_HOME` leaves the sidebar listing workspaces of other instances.
 */
export function dataHomeProblem(stateDir: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!instanceRoots(stateDir, dshHome(env)).scoped) return undefined
  const configured = env[DATA_HOME_ENV]?.trim()
  if (configured && sameDirectory(configured, stateDir)) return undefined
  const value = configured ? `set to ${configured}` : 'not set'
  return `stateDir ${stateDir} is not the default instance, but ${DATA_HOME_ENV} is ${value}; the workspace and session roots stay shared with the default instance, so the sidebar lists other instances' workspaces. Set ${DATA_HOME_ENV}=${stateDir} for this process.`
}
