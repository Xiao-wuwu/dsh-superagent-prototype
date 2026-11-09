// Verifies the Windows port of the agent environment and the batch-wrapper path.
// Run with: `pnpm vitest run tests/windows-port.spec.ts`
import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { expect, it } from 'vitest'
import { agentGhConfig, agentVariables, runAsWorker, workerBin, workerGitConfig, writeEnvironment } from '../src/infra/environment.ts'

// Every path is derived, so this contract test runs on any machine.
const stateDir = join(tmpdir(), 'dsh-superagent-windows-port')
const cli = join(tmpdir(), 'dsh-superagent-fake-tools', 'gh.exe')
const deployment = {
  stateDir,
  repository: 'acme/widgets',
  github: { cli, login: 'agent-bot', noreply: '1+agent-bot@users.noreply.github.com' },
}

/** A SubprocessRuntime backed by child_process, shaped as `runAsWorker` reads it. */
function runtime(): SubprocessRuntime {
  return {
    spawn(spec: { argv: string[]; cwd: string }) {
      const child = spawn(spec.argv[0]!, spec.argv.slice(1), { cwd: spec.cwd, windowsHide: true, shell: false })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => { stdout += String(chunk) })
      child.stderr.on('data', (chunk) => { stderr += String(chunk) })
      const done = new Promise<{ exitCode: number | null }>((resolve) => {
        child.on('error', () => resolve({ exitCode: null }))
        child.on('close', (code) => resolve({ exitCode: code }))
      })
      return {
        done,
        collected: {
          stdout: { readFrom: () => ({ text: stdout }) },
          stderr: { readFrom: () => ({ text: stderr }) },
        },
      }
    },
  } as unknown as SubprocessRuntime
}

it('writes batch shims that strip their own directory from PATH', async () => {
  await rm(stateDir, { recursive: true, force: true })
  await writeEnvironment(deployment, ['python', 'gh', 'git', 'myblocked'])

  const entries = await readdir(workerBin(stateDir))
  // `lark-cli` is always written: without a Feishu bot it is a shim that explains why it is unavailable.
  expect(entries.sort()).toEqual(['gh.cmd', 'lark-cli.cmd', 'myblocked.cmd', 'python.cmd'])

  const gh = await readFile(`${workerBin(stateDir)}/gh.cmd`, 'utf8')
  expect(gh.startsWith('@echo off\r\n')).toBe(true)
  expect(gh).toContain('Written by dsh-superagent')
  expect(gh).toContain(`"${cli}" %*`)
  // The upstream guarantee: the shim removes itself from PATH, so a wrapper resolving `gh` by name reaches the real binary.
  expect(gh).toContain('set "_SELF=%~dp0"')
  expect(gh).toContain('set "_NEW="')
  expect(gh).toContain('endlocal & set "PATH=%_NEW:~1%"')

  const blocked = await readFile(`${workerBin(stateDir)}/python.cmd`, 'utf8')
  expect(blocked).toContain('is blocked in this installation')
  expect(blocked.trimEnd().endsWith('exit /b 1')).toBe(true)

  console.log('GH_CONFIG_DIR override:', agentVariables(stateDir).GH_CONFIG_DIR)
  expect(agentVariables(stateDir).GH_CONFIG_DIR).toBe(agentGhConfig(stateDir))
  await expect(readdir(agentGhConfig(stateDir))).resolves.toBeDefined()
  expect(await readFile(workerGitConfig(stateDir), 'utf8')).toContain('[credential "https://github.com"]')

  // Idempotency: setup re-runs this on every start, so an unrecognised marker would raise `foreignFile`.
  await writeEnvironment(deployment, ['python', 'gh', 'git', 'myblocked'])
  expect((await readdir(workerBin(stateDir))).sort()).toEqual(['gh.cmd', 'lark-cli.cmd', 'myblocked.cmd', 'python.cmd'])
})

it('runs a batch wrapper CLI through cmd.exe and forwards its arguments intact', async () => {
  const dir = join(tmpdir(), 'dsh-superagent-wrapper-test')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const wrapper = join(dir, 'gh-agent.cmd')
  // Echo the arguments back so the assertion sees exactly what the wrapper received.
  // Echo every argument in its own bracket, so an argument mangled by quoting cannot match.
  await writeFile(wrapper, '@echo off\r\necho [%1][%2][%3][%4]\r\nexit /b 0\r\n')

  const awkward = ['api', 'repos/acme/widgets', '--jq', '{name: .full_name, push: .permissions.push}']
  const output = await runAsWorker(runtime(), [wrapper, ...awkward], dir, new AbortController().signal)
  console.log('wrapper saw:', output.trim())
  // A batch parameter keeps the quotes cmd was given around an argument containing spaces; a program started
  // with `%*` still receives the unquoted value, because its own runtime strips them.
  const asBatchSees = (v: string): string => /[\s"]/.test(v) ? `"${v}"` : v
  expect(output.trim()).toBe(awkward.map((arg) => `[${asBatchSees(arg)}]`).join(''))

  // A non-zero exit of the batch file must still surface as an error carrying its stderr.
  const failing = join(dir, 'failing.cmd')
  await writeFile(failing, '@echo off\r\n1>&2 echo boom\r\nexit /b 3\r\n')
  await expect(runAsWorker(runtime(), [failing], dir, new AbortController().signal)).rejects.toThrow('boom')
})
