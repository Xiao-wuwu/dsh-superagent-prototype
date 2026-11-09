/** The built-in workspace of a `mode: local` ticket when no `executor.prepare` command is configured. */
import { mkdir } from 'node:fs/promises'

/** The placeholder identity a local workspace commits under; it never reaches GitHub, since a local delivery pushes nothing. */
export const LOCAL_AUTHOR = 'dsh-superagent', LOCAL_EMAIL = 'superagent@localhost'

/** Runs one git command in a directory, resolving with its output; the executor supplies the worker subprocess service. */
export type WorkspaceRunner = (argv: string[], directory: string) => Promise<unknown>

/**
 * True when a new ticket workspace is the built-in local one: local delivery is chosen explicitly and no prepare command
 * is configured. `github` deployments keep the empty directory they always had, so the default is untouched.
 */
export const usesLocalWorkspace = (mode: 'github' | 'local', prepare: string): boolean => mode === 'local' && !prepare.trim()

/**
 * The commands that make a fresh ticket directory a git repository on `agent/<name>`: an empty base commit on `main`
 * gives the branch a parent, and the repository-local placeholder identity satisfies the workers' `user.useConfigOnly`
 * without borrowing the operator's own git identity. Nothing here adds a remote, so a delivery can only be local.
 */
export const localWorkspaceCommands = (name: string): string[][] => [
  ['git', 'init', '-q', '-b', 'main'],
  ['git', 'config', '--local', 'user.name', LOCAL_AUTHOR],
  ['git', 'config', '--local', 'user.email', LOCAL_EMAIL],
  ['git', 'commit', '-q', '--allow-empty', '-m', 'ticket base'],
  ['git', 'checkout', '-q', '-b', `agent/${name}`],
]

/** Initializes a ticket directory as the built-in local workspace, running each command through `run`. */
export async function initLocalWorkspace(directory: string, name: string, run: WorkspaceRunner): Promise<void> {
  await mkdir(directory, { recursive: true })
  for (const argv of localWorkspaceCommands(name)) await run(argv, directory)
}
