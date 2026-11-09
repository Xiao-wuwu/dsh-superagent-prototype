/** The built-in workspace of a `mode: local` ticket with no prepare command: the decision, its commands, and a real git run. */
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { initLocalWorkspace, localWorkspaceCommands, usesLocalWorkspace } from '../src/executor/local-workspace.ts'
import { gitEnv } from './fixtures/git.ts'

const exec = promisify(execFile)
const roots: string[] = []
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }) })

it('uses the built-in workspace only for local delivery without a prepare command', () => {
  expect(usesLocalWorkspace('local', '')).toBe(true)
  expect(usesLocalWorkspace('local', '  \n')).toBe(true)
  expect(usesLocalWorkspace('local', 'git clone <base> <dir>')).toBe(false)
  // The default deployment keeps the empty directory it has always had.
  expect(usesLocalWorkspace('github', '')).toBe(false)
})

it('initializes one branch, one base commit and no remote', () => {
  const commands = localWorkspaceCommands('fix-local-abcdef123456')
  expect(commands.at(-1)).toEqual(['git', 'checkout', '-q', '-b', 'agent/fix-local-abcdef123456'])
  const text = commands.map(argv => argv.join(' ')).join('\n')
  expect(text).not.toMatch(/\bpush\b|\bremote\b|\bclone\b/)
})

it('creates the repository the worker commit needs, under the placeholder identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'local-workspace-')); roots.push(root)
  // The workers' git configuration forbids guessing an identity, so the repository must supply one itself.
  const global = join(root, 'worker-gitconfig')
  writeFileSync(global, '[user]\n\tuseConfigOnly = true\n')
  const env = gitEnv({ GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' })
  const run = async (argv: string[], cwd: string): Promise<string> => (await exec(argv[0] as string, argv.slice(1), { cwd, env })).stdout
  const git = async (cwd: string, args: string[]): Promise<string> => (await exec('git', args, { cwd, env })).stdout.trim()

  const directory = join(root, 'work', 'fix-local-abcdef123456')
  await initLocalWorkspace(directory, 'fix-local-abcdef123456', run)

  expect(await git(directory, ['branch', '--show-current'])).toBe('agent/fix-local-abcdef123456')
  expect(await git(directory, ['log', '-1', '--format=%an <%ae>'])).toBe('dsh-superagent <superagent@localhost>')
  expect(await git(directory, ['rev-list', '--count', 'main'])).toBe('1')
  expect(await git(directory, ['remote', '-v'])).toBe('')
  expect(await git(directory, ['status', '--porcelain'])).toBe('')

  // A later plain commit, as a worker makes it, succeeds and carries the sign-off the delivery requires.
  writeFileSync(join(directory, 'note.txt'), 'done\n')
  await git(directory, ['add', 'note.txt'])
  await git(directory, ['commit', '-q', '-s', '-m', 'work'])
  expect(await git(directory, ['log', '-1', '--format=%B'])).toContain('Signed-off-by: dsh-superagent <superagent@localhost>')
})
