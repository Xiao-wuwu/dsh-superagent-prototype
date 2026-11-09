// Source instances may name their kind, so one kind can have several instances. The default keeps old configs identical.
import { expect, it } from 'vitest'
import { SettingsSchema, instancesOf, sourceKindOf } from '../src/policy.ts'

const settings = (sources: Record<string, unknown>) => SettingsSchema.parse({ sources })

it('defaults an instance kind to its id, so an existing configuration means the same thing', () => {
  expect(sourceKindOf('github')).toBe('github')
  expect(sourceKindOf('github', {})).toBe('github')
  expect(sourceKindOf('acme', { kind: 'github' })).toBe('github')
})

it('accepts a second instance of one kind and selects instances by kind', () => {
  const value = settings({
    github: { enabled: true, config: {} },
    acme: { kind: 'github', enabled: true, config: {} },
    feishu: { enabled: false, config: {} },
  })
  // Ids are returned sorted, so callers get a stable order for setup checks and health.
  expect(instancesOf(value, 'github')).toEqual(['acme', 'github'])
  expect(instancesOf(value, 'feishu')).toEqual(['feishu'])
  expect(instancesOf(value, 'nope')).toEqual([])
})

it('rejects a kind that is not a valid instance id', () => {
  expect(() => settings({ acme: { kind: 'GitHub', config: {} } })).toThrow()
  expect(() => settings({ acme: { kind: 'github_2', config: {} } })).toThrow()
})
