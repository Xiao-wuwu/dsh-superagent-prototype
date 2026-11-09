/**
 * Process environment and CLI shims that bind git, gh, and lark-cli to the deployment's accounts and block disallowed commands.
 * Variables read by workers avoid `KEY|PASSWORD|SECRET|TOKEN` in their names because DSH strips credential-shaped variables from child environments.
 * Provides default-path guardrails rather than an OS-level security boundary, as workers run under the operator's OS user.
 */
import { lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import type { SubprocessOutputReader, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { Deployment } from '../deployment.ts'
import { SetupError } from '../setup.ts'
import { CliError } from './commands.ts'

const MARKER = '# Written by dsh-superagent on every start; edits are lost.'
/**
 * Some networks drop github.com:443 while ssh.github.com:443 stays reachable, which would make every worker
 * `git fetch` fail even though the GitHub API (api.github.com) works. Setting SUPERAGENT_GIT_SSH=1 rewrites the
 * github.com HTTPS URLs worker git uses to SSH, so the transport can follow the network without touching accounts.
 */
const sshTransport = (): boolean => process.env.SUPERAGENT_GIT_SSH === '1'
/** Markers of files written under the project's earlier names (`dsh-tag`, `dsh-go`, `dsh-freelancer`), which `dsh-superagent` owns and replaces too. */
const LEGACY_MARKERS = ['dsh-tag', 'dsh-go', 'dsh-freelancer'].map(name => `# Written by ${name} on every start; edits are lost.`)
/** Windows needs batch shims and drive-qualified paths; every other platform keeps the POSIX forms below. */
const windows = process.platform === 'win32'
/** Commands workers need, which `blockedCommands` cannot block: the shims and git. */
export const WORKER_COMMANDS: readonly string[] = ['gh', 'git', 'lark-cli']
export const workerBin = (stateDir: string): string => join(stateDir, 'worker-bin')
export const workerGitConfig = (stateDir: string): string => join(stateDir, 'worker-gitconfig')
/**
 * The agent's own GitHub CLI configuration directory. Windows selects the agent account through GH_CONFIG_DIR because
 * Node refuses to spawn a `.cmd` wrapper (`spawn EINVAL`), so the upstream wrapper-script trick cannot be the CLI here.
 */
export const agentGhConfig = (stateDir: string): string => join(stateDir, 'gh-config')
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`
const gitQuote = (value: string): string => `"${value.replace(/[\\"]/g, char => `\\${char}`)}"`
export const credentialHelper = (cli: string): string => `!${shellQuote(cli)} auth git-credential`

export function sameDirectory(a: string, b: string): boolean {
  const real = (path: string): string => { try { return realpathSync(path) } catch { return resolve(path) } }
  return real(a) === real(b)
}
export function withoutDirectory(path: string, dir: string): string {
  return path.split(delimiter).filter(entry => !sameDirectory(entry, dir)).join(delimiter)
}

/**
 * The variables that tell git which repository, work tree and index to act on. A host started inside git, such as by
 * `git rebase --exec`, passes them on, and a git started below it would act on that repository. GIT_CEILING_DIRECTORIES is
 * kept: it names no repository, and it stops git's search for one where the operator chose.
 */
export const GIT_LOCATION: readonly string[] = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE']

/**
 * Returns environment variable overrides that strip ambient GitHub tokens, interactive prompts, the repository the host's own
 * environment may name, and operator git identity/config overrides.
 */
export function agentVariables(stateDir: string): Record<string, string | undefined> {
  return {
    GH_TOKEN: undefined, GITHUB_TOKEN: undefined,
    // Select the agent account by configuration directory: a `.cmd` wrapper cannot be spawned by Node on Windows.
    ...windows ? { GH_CONFIG_DIR: agentGhConfig(stateDir) } : {},
    // A worker's git finds the repository from its directory, never from the host's environment.
    ...Object.fromEntries(GIT_LOCATION.map(name => [name, undefined])),
    GIT_CONFIG_GLOBAL: workerGitConfig(stateDir), GIT_CONFIG_NOSYSTEM: '1',
    // Clear environment git config overrides; configuration passed through the environment would otherwise reach every git command the agent runs.
    GIT_CONFIG_COUNT: undefined, GIT_CONFIG_PARAMETERS: undefined,
    // When the credential helper has no answer, git must fail rather than prompt; `GIT_ASKPASS: ''` also overrides `core.askPass` and `SSH_ASKPASS`.
    GIT_ASKPASS: '', SSH_ASKPASS: undefined, GIT_TERMINAL_PROMPT: '0',
    // Clear operator commit identity variables; prompts specify commit identity and operator env vars would override what a worker sets.
    GIT_AUTHOR_NAME: undefined, GIT_COMMITTER_NAME: undefined, GIT_AUTHOR_EMAIL: undefined, GIT_COMMITTER_EMAIL: undefined,
  }
}

/** True when a regular file starts with the dsh-superagent marker in its first two lines; a symbolic link, directory, or other non-regular file never counts as written by dsh-superagent. */
async function written(file: string): Promise<boolean> {
  if (!(await lstat(file)).isFile()) return false
  // Windows shims are batch files, where a `#` comment would be executed; they carry the same marker behind `@REM`.
  const head = (await readFile(file, 'utf8')).split(/\r?\n/, 2).map(line => line.replace(/^@rem\s+/i, ''))
  return [MARKER, ...LEGACY_MARKERS].some(marker => head.includes(marker))
}
async function own(file: string, text: string, mode = 0o644): Promise<void> {
  let foreign = false
  try { foreign = !await written(file) } catch { /* The file does not exist yet. */ }
  if (foreign) throw new SetupError('foreignFile', { file })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, text, { mode })
  await rename(temporary, file)
}

/**
 * Atomically writes worker CLI shims and the isolated git configuration file into the state directory, refusing to overwrite foreign files.
 * Each shim strips the shim directory from PATH before exec so wrapper scripts resolving `gh` or `lark-cli` by name reach the real binary.
 */
export async function writeEnvironment(deployment: Pick<Deployment, 'stateDir' | 'repository' | 'github' | 'feishu'>, blockedCommands: readonly string[]): Promise<void> {
  const { stateDir, repository, github, feishu } = deployment
  const dir = workerBin(stateDir)
  await mkdir(dir, { recursive: true })
  await mkdir(agentGhConfig(stateDir), { recursive: true })
  const before = await readdir(dir)
  for (const name of before) { const file = join(dir, name); if (!await written(file)) throw new SetupError('foreignFile', { file }) }
  // Workers may be running concurrently: write each shim to a temp file and atomically rename it so no command ever resolves past the shim directory.
  const kept = new Set<string>()
  const shim = async (name: string, body: string): Promise<void> => {
    const entry = windows ? `${name}.cmd` : name
    const temporary = join(dir, `.${name}.${process.pid}.tmp`)
    // A batch file is reachable through PATHEXT; an extensionless `#!/bin/sh` file is invisible to a Windows PATH lookup.
    const text = windows ? `@echo off\r\n@REM ${MARKER}\r\n${body}\r\n` : `#!/bin/sh\n${MARKER}\n${body}\n`
    await writeFile(temporary, text, { mode: windows ? 0o644 : 0o755 })
    await rename(temporary, join(dir, entry))
    kept.add(entry)
  }
  const withoutShims = [
    `self=${shellQuote(dir)}`, 'rest=', 'IFS=:', 'set -f',
    'for entry in $PATH; do [ "$entry" = "$self" ] || rest="${rest:+$rest:}$entry"; done',
    'set +f', 'unset IFS', 'PATH=$rest', 'export PATH',
  ].join('\n')
  // A batch shim cannot strip PATH as the POSIX one does, so it must call the real executable by absolute path: a
  // name-based call inside the configured wrapper would re-enter this shim, and Node refuses to spawn a `.cmd` anyway.
  // The batch twin of `withoutShims`: a wrapper script that resolves `gh` or `lark-cli` by name must reach the real
  // binary, never this shim again. `%%~dp0` ends with a separator, so the last character is dropped for the comparison.
  const withoutShimsWindows = [
    'set "_SELF=%~dp0"',
    'if "%_SELF:~-1%"=="\\" set "_SELF=%_SELF:~0,-1%"',
    'setlocal EnableDelayedExpansion',
    'set "_NEW="',
    'for %%P in ("!PATH:;=" "!") do if /I not "%%~P"=="!_SELF!" set "_NEW=!_NEW!;%%~P"',
    'endlocal & set "PATH=%_NEW:~1%"',
  ].join('\r\n')
  const run = (program: string): string => windows
    ? `${withoutShimsWindows}\r\n"${program}" %*\r\nexit /b %ERRORLEVEL%`
    : `${withoutShims}\nexec ${shellQuote(program)} "$@"`
  const fail = (message: string): string => windows
    ? `>&2 echo ${message}\r\nexit /b 1`
    : `echo ${shellQuote(message)} >&2\nexit 1`
  if (github.cli) await shim('gh', run(github.cli))
  await shim('lark-cli', feishu ? run(feishu.cli) : fail('lark-cli is unavailable: this installation has no Feishu bot.'))
  for (const name of new Set(blockedCommands.filter(name => !WORKER_COMMANDS.includes(name)))) {
    await shim(name, fail(github.login
      ? `${name} is blocked in this installation; use gh, which acts as ${github.login}.`
      : `${name} is blocked in this installation.`))
  }
  for (const name of before) if (!kept.has(name)) await unlink(join(dir, name))
  await own(workerGitConfig(stateDir), [
    MARKER,
    // Make git refuse to commit without an explicit identity set by the worker instead of guessing from the operator's OS user.
    '[user]', '\tuseConfigOnly = true',
    '[credential]', '\thelper =',
    // No GitHub Source: nothing is pushed to or fetched from github.com, so a credential helper and the
    // SSH rewrites would only describe a remote this installation does not have.
    ...github.cli ? [
      '[credential "https://github.com"]', `\thelper = ${gitQuote(credentialHelper(github.cli))}`,
      '[url "https://github.com/"]', '\tinsteadOf = git@github.com:', '\tinsteadOf = ssh://git@github.com/',
      // Opt-in: send the HTTPS URLs git would use over SSH instead, for networks that block github.com:443.
      ...sshTransport() ? ['[url "ssh://git@github.com/"]', '\tinsteadOf = https://github.com/'] : [],
    ] : [],
    // Include Git LFS filters because the operator's global gitconfig (which usually holds them) is ignored.
    '[filter "lfs"]', '\tclean = git-lfs clean -- %f', '\tsmudge = git-lfs smudge -- %f', '\tprocess = git-lfs filter-process', '\trequired = true',
  ].join('\n') + '\n')
}

/** Applies environment overrides and prepends worker shims to `process.env.PATH`, returning a restore callback. */
export function applyEnvironment(variables: Record<string, string | undefined>, stateDir: string, path: string): () => void {
  const values = { ...variables, PATH: [workerBin(stateDir), path].join(delimiter) }
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]))
  const apply = (env: Record<string, string | undefined>): void => { for (const [name, value] of Object.entries(env)) { if (value === undefined) delete process.env[name]; else process.env[name] = value } }
  apply(values)
  return () => { apply(previous) }
}

/** Spawns a command through the DSH subprocess runtime, which strips credential-shaped environment variables. */
export async function runAsWorker(subprocess: SubprocessRuntime, argv: string[], cwd: string, signal: AbortSignal, env?: Record<string, string>): Promise<string> {
  // Node refuses to spawn `.cmd`/`.bat` directly (the CVE-2024-27980 hardening), so a batch wrapper CLI — the account model
  // docs/006-deployment.md describes — is handed to cmd.exe, which is also the only place its quoting rules apply.
  const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(argv[0] ?? '')
  // Hand the program and its arguments as SEPARATE argv entries: Node then quotes each one for cmd, whereas joining
  // them into one command line lets cmd re-parse the quotes and hand the program literal backslash-quotes.
  const spawnArgv = batch ? ['cmd.exe', '/d', '/c', argv[0]!, ...argv.slice(1)] : argv
  const handle = subprocess.spawn({ argv: spawnArgv, cwd, graceMs: 2000, signal, ...env ? { env } : {}, stdio: { stdin: 'ignore', stdout: { maxBytes: 1 << 20 }, stderr: { maxBytes: 1 << 16 } } })
  const { exitCode } = await handle.done
  const read = (reader: SubprocessOutputReader | undefined): string => reader?.readFrom(0).text ?? ''
  if (exitCode === 0) return read(handle.collected.stdout)
  const ended = exitCode === null ? 'was stopped before it finished' : `exited with ${exitCode}`
  throw new CliError(read(handle.collected.stderr).trim() || `${argv.join(' ')} ${ended}`, undefined, exitCode ?? undefined)
}

/** Verifies that worker git invocations resolve the deployment's GitHub credential helper. */
export async function verifyEnvironment(deployment: Pick<Deployment, 'github' | 'stateDir'>, subprocess: SubprocessRuntime, signal: AbortSignal): Promise<void> {
  const { github, stateDir } = deployment
  // No GitHub Source: the worker git config was written without a credential helper, so there is nothing to compare.
  if (!github.cli) return
  // `-z` separates fields with NUL and never quotes paths.
  const helpers = (await runAsWorker(subprocess, ['git', 'config', '-z', '--show-origin', '--get-all', 'credential.https://github.com.helper'], stateDir, AbortSignal.any([signal, AbortSignal.timeout(60_000)])).catch(() => '')).split('\0')
  if (helpers.join('\0') !== [`file:${workerGitConfig(stateDir)}`, credentialHelper(github.cli), ''].join('\0')) throw new SetupError('gitTooOld')
}

/**
 * Verifies that a ticket directory's local or worktree git config defines no custom `credential.*` or `http.*extraheader`
 * keys, which the agent's git would read from the repository's own config and act on.
 */
export async function verifyDirectory(directory: string, subprocess: SubprocessRuntime, signal: AbortSignal): Promise<void> {
  const keys = ['git', 'config', '-z', '--show-scope', '--get-regexp', '^(credential\\..*|http\\..*extraheader)$']
  // `git config --get-regexp` exits with code 1 when no keys match.
  const output = await runAsWorker(subprocess, keys, directory, AbortSignal.any([signal, AbortSignal.timeout(60_000)]))
    .catch((error: unknown) => { if (error instanceof CliError && error.exitCode === 1) return ''; throw error })
  const scoped = output.split('\0')
  const local = scoped.flatMap((scope, index) => index % 2 === 0 && (scope === 'local' || scope === 'worktree') ? [scoped[index + 1]!.split('\n')[0]!] : [])
  if (local.length) throw new Error(`The git configuration of the repository in ${directory} sets ${local.join(', ')}, which the agent's git would also read; remove them.`)
}
