/**
 * A JSON Schema for the declarative settings file, so an editor completes block names and flags a typo before the
 * runtime ever reads the file.
 *
 * The schema is **generated from `SettingsSchema`**, never maintained by hand. A hand-written copy drifts the first
 * time a field is added, and a stale copy is worse than no copy: it marks a valid field as an error and teaches the
 * team to ignore the squiggles. `tests/config-schema.spec.ts` therefore compares the committed file against a fresh
 * generation, so "the file exists" and "the file is current" cannot be confused.
 */
import { z } from 'zod'
import { SettingsSchema } from '../policy.ts'

/** The blocks a declarative file may declare. `$prune` is the only `$` directive the loader reads before validation. */
export const DECLARATIVE_BLOCK_NAMES = ['paused', 'sources', 'policy', 'eval', 'executor', 'chatRouter'] as const
export const DECLARATIVE_SCHEMA_ID = 'https://github.com/ReSerendipity/dsh-superagent/schema/declarative-settings.schema.json'

/**
 * Build the schema document. Every block is optional (a partial file is a safe overlay), unknown top-level keys are
 * rejected (a typo must fail loudly at the editor rather than silently keep the stored block), and `$prune` is
 * added by hand because it is read before validation and therefore is not part of `SettingsSchema`.
 */
export function declarativeJsonSchema(): Record<string, unknown> {
  const settings = z.toJSONSchema(SettingsSchema.partial(), { target: 'draft-2020-12', io: 'input' }) as {
    properties?: Record<string, unknown>
    $defs?: Record<string, unknown>
  }
  const properties = settings.properties ?? {}
  const missing = DECLARATIVE_BLOCK_NAMES.filter(name => !(name in properties))
  if (missing.length) throw new Error('SettingsSchema no longer offers blocks a declarative file may name: ' + missing.join(', '))
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: DECLARATIVE_SCHEMA_ID,
    title: 'DSH-Superagent declarative settings',
    description:
      'A settings file the runtime overlays on the stored settings at startup (and again on every save). ' +
      'Every block is optional: an omitted block keeps what the panel stored, so a file may declare only the part ' +
      'a team owns. `sources` and `policy` merge key by key; other blocks replace whole.',
    type: 'object',
    properties: {
      ...properties,
      $prune: {
        type: 'object',
        description:
          'Names stored items the file must delete before the declared blocks merge. Without it a file could only ' +
          'add and override, so a Source an earlier file declared could never be removed.',
        properties: {
          sources: {
            type: 'array',
            description: 'Source ids to delete before merging; an undeclared id fails validation.',
            items: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
          },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
    ...(settings.$defs ? { $defs: settings.$defs } : {}),
  }
}
