// The declarative settings file: a partial, reviewable overlay a team keeps in version control.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { loadDeclarative, mergeDeclarative, declarativeFileNames, resolveDeclarativePath } from '../src/app/config-file.ts'
import { SettingsSchema } from '../src/policy.ts'

const base = SettingsSchema.parse({})
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

it('overlays only the blocks the file declares, and leaves the stored ones alone', () => {
  const declared = clone({ ...base, executor: { ...base.executor, prepare: 'make worktree' } })
  const merged = mergeDeclarative(base, declared)
  expect(merged.executor.prepare).toBe('make worktree')
  // A block the file does not mention keeps its stored value byte for byte.
  expect(merged.policy).toEqual(base.policy)
  expect(merged.eval).toEqual(base.eval)
})

it('merges the Source and Policy records key by key instead of replacing them', () => {
  const stored = clone(base)
  stored.sources = { feishu: { enabled: false, config: {} } } as typeof stored.sources
  const declared = {
    sources: { github: { enabled: true, config: { repository: 'acme/widgets', cli: 'gh' } } },
  }
  const merged = mergeDeclarative(SettingsSchema.parse(stored), declared)
  expect(Object.keys(merged.sources).sort()).toEqual(['feishu', 'github'])
  expect(merged.sources.github).toEqual({ enabled: true, config: { repository: 'acme/widgets', cli: 'gh' } })
})

it('reports a missing file, bad JSON and schema failures as text instead of throwing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-config-'))
  try {
    const missing = loadDeclarative(join(dir, 'absent.json'), base)
    expect('error' in missing && missing.error).toContain('could not be read')

    const broken = join(dir, 'broken.json')
    await writeFile(broken, '{ nope', 'utf8')
    const invalid = loadDeclarative(broken, base)
    expect('error' in invalid && invalid.error).toContain('not valid JSON')

    const wrong = join(dir, 'wrong.json')
    await writeFile(wrong, JSON.stringify({ eval: { mode: 'nonsense' } }), 'utf8')
    const refused = loadDeclarative(wrong, base)
    expect('error' in refused && refused.error).toContain('invalid')

    const good = join(dir, 'good.json')
    await writeFile(good, JSON.stringify({ executor: { ...base.executor, prepare: 'make x' } }), 'utf8')
    const applied = loadDeclarative(good, base)
    expect('settings' in applied && applied.settings.executor.prepare).toBe('make x')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('removes what $prune names, so a Source dropped from the file does not linger in the stored settings', () => {
  const stored = clone(base)
  stored.sources = {
    github: { enabled: true, config: {} },
    stale: { kind: 'github', enabled: true, config: {} },
  } as typeof stored.sources
  const declared = { $prune: { sources: ['stale'] }, executor: { ...base.executor, maxWorkers: 2 } }
  const merged = mergeDeclarative(SettingsSchema.parse(stored), declared)
  expect(Object.keys(merged.sources)).toEqual(['github'])
  expect(merged.executor.maxWorkers).toBe(2)
})

it('produces the same Settings from YAML and from the equivalent JSON, $prune included', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-config-'))
  try {
    const stored = clone(base)
    stored.sources = {
      github: { enabled: true, config: {} },
      stale: { kind: 'github', enabled: true, config: {} },
    } as typeof stored.sources
    const declared = {
      $prune: { sources: ['stale'] },
      sources: { github: { enabled: true, config: { repository: 'acme/widgets', cli: 'gh' } } },
      policy: { sources: { github: { allowed: [{ id: 'alice' }, { id: 'bob' }] } } },
      executor: { ...base.executor, maxWorkers: 2, prepare: 'make worktree' },
    }
    const jsonPath = join(dir, 'superagent.settings.json')
    const yamlPath = join(dir, 'superagent.settings.yaml')
    await writeFile(jsonPath, JSON.stringify(declared), 'utf8')
    await writeFile(yamlPath, [
      '$prune:',
      '  sources:',
      '    - stale',
      'sources:',
      '  github:',
      '    enabled: true',
      '    config:',
      '      repository: acme/widgets',
      '      cli: gh',
      'policy:',
      '  sources:',
      '    github:',
      '      allowed:',
      '        - id: alice',
      '        - id: bob',
      'executor:',
      '  maxWorkers: 2',
      '  prepare: make worktree',
    ].join('\n'), 'utf8')

    const current = SettingsSchema.parse(stored)
    const fromJson = loadDeclarative(jsonPath, current)
    const fromYaml = loadDeclarative(yamlPath, current)
    if (!('settings' in fromJson) || !('settings' in fromYaml)) throw new Error('both files must apply')
    // The whole Settings object, block by block: the YAML reader must not be a second, subtly different loader.
    expect(fromYaml.settings).toEqual(fromJson.settings)
    expect(Object.keys(fromYaml.settings.sources)).toEqual(['github'])
    expect(fromYaml.settings.sources.github).toEqual({ enabled: true, config: { repository: 'acme/widgets', cli: 'gh' } })
    expect(fromYaml.settings.policy.sources.github?.allowed).toEqual([{ id: 'alice' }, { id: 'bob' }])
    expect(fromYaml.settings.executor.maxWorkers).toBe(2)
    expect(fromYaml.settings.executor.prepare).toBe('make worktree')
    // Everything the file does not name keeps the stored value, exactly like JSON.
    expect(fromYaml.settings.eval).toEqual(current.eval)
    expect(fromYaml.settings.policy.rules).toEqual(current.policy.rules)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('names the line a YAML refusal came from, for a parse error and for a schema failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-config-'))
  try {
    const invalid = join(dir, 'invalid.yaml')
    await writeFile(invalid, ['executor:', '  maxWorkers: 1', 'eval:', '  mode: nonsense'].join('\n'), 'utf8')
    const refused = loadDeclarative(invalid, base)
    expect('error' in refused && refused.error).toContain('eval.mode (line 4)')

    const broken = join(dir, 'broken.yaml')
    await writeFile(broken, 'executor:\n\tprepare: make', 'utf8')
    const unreadable = loadDeclarative(broken, base)
    expect('error' in unreadable && unreadable.error).toContain('not valid YAML')
    expect('error' in unreadable && unreadable.error).toContain('line 2, column 1')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('resolves the .yaml sibling of the configured file, and keeps the configured path when both exist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-config-'))
  try {
    const configured = join(dir, 'superagent.settings.json')
    const sibling = join(dir, 'superagent.settings.yaml')
    expect(declarativeFileNames(configured)).toEqual([
      configured,
      join(dir, 'superagent.settings.yaml'),
      join(dir, 'superagent.settings.yml'),
    ])
    await writeFile(sibling, 'executor:\n  maxWorkers: 4\n', 'utf8')
    expect(resolveDeclarativePath(configured)).toBe(sibling)
    expect(resolveDeclarativePath(configured).endsWith('.yaml')).toBe(true)

    // The explicit name wins when both formats exist: nothing switches formats behind the operator's back.
    await writeFile(configured, JSON.stringify({ executor: { maxWorkers: 1 } }), 'utf8')
    expect(resolveDeclarativePath(configured)).toBe(configured)

    // Nothing to read at all: the configured path comes back so the error names what was asked for.
    const absent = join(dir, 'absent.json')
    expect(resolveDeclarativePath(absent)).toBe(absent)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
