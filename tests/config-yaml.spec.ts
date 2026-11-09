// The YAML subset of the declarative settings file: enough for a reviewable configuration, and a positioned refusal
// for everything else. Run with: `pnpm vitest run tests/config-yaml.spec.ts`
import { expect, it } from 'vitest'
import { parseYaml, YamlError } from '../src/app/config-yaml.ts'

/** The refusal a document earns, so a test can assert the exact line rather than only that something threw. */
function refusal(text: string): YamlError {
  try {
    parseYaml(text)
  } catch (error) {
    if (error instanceof YamlError) return error
    throw error
  }
  throw new Error('the document was accepted')
}

it('reads block mappings, sequences, comments, block scalars and directives into plain values', () => {
  const text = [
    '# A settings file keeps the stored blocks it does not name.',
    'sources:',
    '  github:',
    '    enabled: true',
    '    config:',
    '      repository: acme/widgets          # trailing comment',
    "      cli: 'C:/tools/gh/bin/gh.exe'",
    'policy:',
    '  sources:',
    '    github:',
    '      allowed:',
    '        - id: alice',
    '          login: alice',
    '        - id: bob',
    'executor:',
    '  maxWorkers: 3',
    '  prepare: null',
    '  guidance: |',
    '    stay quiet',
    '    unless it changed',
    '$prune:',
    '  sources:',
    '    - stale',
  ].join('\n')
  const parsed = parseYaml(text)
  expect(parsed.value).toEqual({
    sources: { github: { enabled: true, config: { repository: 'acme/widgets', cli: 'C:/tools/gh/bin/gh.exe' } } },
    policy: { sources: { github: { allowed: [{ id: 'alice', login: 'alice' }, { id: 'bob' }] } } },
    executor: { maxWorkers: 3, prepare: null, guidance: 'stay quiet\nunless it changed\n' },
    $prune: { sources: ['stale'] },
  })
  // Positions are keyed by the same path the settings schema reports, so a schema failure can name its line.
  expect(parsed.lineAt('sources.github.config.repository')).toBe(6)
  expect(parsed.lineAt('sources.github.enabled')).toBe(4)
  expect(parsed.lineAt('policy.sources.github.allowed.1')).toBe(14)
  expect(parsed.lineAt('executor.guidance')).toBe(18)
  expect(parsed.lineAt('sources.unknown')).toBeUndefined()
})

it('reads flow collections, quoted escapes and folded blocks', () => {
  const text = [
    "tags: [alpha, 'beta', { gamma: 1 }]",
    'quoted: "a \\"b\\" \\u00e9"',
    'folded: >',
    '  one',
    '  two',
    '',
    'tail: done',
  ].join('\n')
  expect(parseYaml(text).value).toEqual({
    tags: ['alpha', 'beta', { gamma: 1 }],
    quoted: 'a "b" é',
    folded: 'one two\n',
    tail: 'done',
  })
})

it('starts a mapping on a sequence item line and accepts a sequence at its key indentation', () => {
  const text = ['allowed:', '- id: alice', '  login: alice', '- id: bob'].join('\n')
  expect(parseYaml(text).value).toEqual({ allowed: [{ id: 'alice', login: 'alice' }, { id: 'bob' }] })
})

it('refuses tabs, document markers, duplicate keys and the constructs it does not implement, at their line', () => {
  const tab = refusal('sources:\n\tgithub: true')
  expect(tab.line).toBe(2)
  expect(tab.message).toContain('tabs cannot be used for indentation')

  const marker = refusal('---\nsources: {}')
  expect(marker.line).toBe(1)
  expect(marker.message).toContain('multiple YAML documents')

  const duplicate = refusal('executor: 1\npolicy: 2\nexecutor: 3')
  expect(duplicate.line).toBe(3)
  expect(duplicate.message).toContain('duplicate key "executor"')

  const anchor = refusal('executor:\n  prepare: &x make')
  expect(anchor.line).toBe(2)
  expect(anchor.message).toContain('anchors')

  const alias = refusal('executor:\n  prepare: *x')
  expect(alias.line).toBe(2)
  expect(alias.message).toContain('anchors')

  const merge = refusal('<<: { executor: {} }')
  expect(merge.line).toBe(1)
  expect(merge.message).toContain('merge keys')

  const indent = refusal('executor: 1\n  prepare: make')
  expect(indent.line).toBe(2)
  expect(indent.message).toContain('unexpected indentation')

  const quote = refusal('executor:\n  prepare: "make')
  expect(quote.line).toBe(2)
  expect(quote.message).toContain('unterminated')
})

it('reports an empty document as no settings rather than as a failure', () => {
  expect(parseYaml('# nothing here\n\n').value).toBeNull()
})
