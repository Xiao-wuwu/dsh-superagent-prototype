// Regenerate schema/declarative-settings.schema.json from SettingsSchema.
// Run after adding or changing a settings field: `node scripts/export-settings-schema.ts`.
// tests/config-schema.spec.ts fails when the committed file and a fresh generation disagree, so forgetting this
// step turns the test red instead of shipping a stale schema to editors.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { declarativeJsonSchema } from '../src/app/config-schema.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'schema', 'declarative-settings.schema.json')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, JSON.stringify(declarativeJsonSchema(), null, 2) + '\n', 'utf8')
console.log('wrote ' + target)
