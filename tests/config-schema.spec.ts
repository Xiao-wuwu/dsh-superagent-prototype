// The declarative settings file has a JSON Schema an editor can use, and that schema is generated, not maintained.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { SettingsSchema } from '../src/policy.ts'
import { DECLARATIVE_BLOCK_NAMES, declarativeJsonSchema } from '../src/app/config-schema.ts'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const committed = (): string => readFileSync(join(root, 'schema', 'declarative-settings.schema.json'), 'utf8')
const example = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(root, 'schema', 'declarative-settings.example.json'), 'utf8')) as Record<string, unknown>

it('declares exactly the blocks a declarative file may name, plus $prune', () => {
  const schema = declarativeJsonSchema() as { properties: Record<string, unknown> }
  expect(Object.keys(schema.properties).sort()).toEqual([...DECLARATIVE_BLOCK_NAMES, '$prune'].sort())
  expect(Object.keys(schema.properties).sort()).toEqual([...Object.keys(SettingsSchema.shape), '$prune'].sort())
})

it('is a partial document: nothing is required, and an unknown top-level key is rejected', () => {
  const schema = declarativeJsonSchema() as { required?: unknown; additionalProperties?: unknown }
  // A partial file must be legal, otherwise declaring one block would demand the other four.
  expect(schema.required).toBeUndefined()
  // A typo (`policies` for `policy`) has to fail at the editor rather than silently keep the stored block.
  expect(schema.additionalProperties).toBe(false)
  const prune = (schema as unknown as { properties: Record<string, { additionalProperties?: unknown } | undefined> }).properties.$prune!
  expect(prune.additionalProperties).toBe(false)
})

it('matches the committed file, so the published schema cannot drift from SettingsSchema', () => {
  const fresh = JSON.stringify(declarativeJsonSchema(), null, 2) + '\n'
  expect(committed()).toBe(fresh)
  // Negative control: a schema missing one block must be reported as drift, proving the comparison is not vacuous.
  const mutated = declarativeJsonSchema() as { properties: Record<string, unknown> }
  delete mutated.properties.paused
  expect(JSON.stringify(mutated, null, 2) + '\n').not.toBe(fresh)
})

it('keeps the shipped example inside the schema, block by block', () => {
  const declared = example()
  const unknown = Object.keys(declared).filter(name => !(DECLARATIVE_BLOCK_NAMES as readonly string[]).includes(name))
  expect(unknown).toEqual([])
  // The example is the one file a new team copies first, so it must survive the same parse the loader applies.
  expect(SettingsSchema.partial().safeParse(declared).success).toBe(true)
})
