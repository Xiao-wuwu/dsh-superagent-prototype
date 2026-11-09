// The client module id must be the package name. A host composes client modules by package name: DSH's
// desktop build (0.2.2-rc.1) rejected 0.1.2's bare `id: "dsh-superagent"` with "duplicate factory
// registration" and "1 entry did not activate", while the CLI host (0.2.1) tolerated it. This reads the
// built file an install serves, so the id cannot drift from `package.json` again.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '..')
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

it('registers the client module under the package name', () => {
  const pkg = JSON.parse(read('package.json')) as { name: string }
  const client = read('lib/client.js')
  const registered = /window\.__ModuleLoader__\.load\(\{\s*id:\s*"([^"]+)"/.exec(client)?.[1]
  expect(registered, 'lib/client.js has no __ModuleLoader__ registration: rebuild before committing').toBe(pkg.name)
})
