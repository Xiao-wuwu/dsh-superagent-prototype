/**
 * A-9 checker: every `<!-- msg:X -->` marker in an inbox reply file must have a row in the
 * `outbox` table. A marker without a row means content entered the durable delivery record
 * without going through the Channel, so that ticket's evidence is not proven.
 * Usage: node scripts/a9-check.js [stateDir] [fileFilter]
 * `fileFilter` limits the scan to reply files whose name contains it - use it after a fix, because
 * historical orphans in other files keep the whole-directory run red.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const stateDir = process.argv[2] ?? join(process.env.USERPROFILE ?? '', '.dsh', 'state', 'superagent')
const filter = process.argv[3] ?? ''
const doneDir = join(stateDir, 'inbox', 'done')
const dbPath = join(stateDir, 'orchestrator.sqlite')
if (!existsSync(doneDir)) { console.error(`FAIL  no inbox archive at ${doneDir}`); process.exit(1) }
if (!existsSync(dbPath)) { console.error(`FAIL  no database at ${dbPath}`); process.exit(1) }

const db = new DatabaseSync(dbPath, { readOnly: true })
const known = new Set(db.prepare('select id from outbox').all().map(r => r.id))
db.close()

let files = 0
let markers = 0
const orphans = []
for (const name of readdirSync(doneDir)) {
  if (!name.endsWith('.reply.md') || !name.includes(filter)) continue
  files++
  const text = readFileSync(join(doneDir, name), 'utf8')
  for (const match of text.matchAll(/<!-- msg:([0-9a-f]{32}) -->/g)) {
    markers++
    if (!known.has(match[1])) orphans.push({ file: name, id: match[1] })
  }
}

console.log(`outbox rows: ${known.size}`)
console.log(`reply files scanned: ${files}${filter ? ` (filter: ${filter})` : ''}`)
console.log(`msg markers found: ${markers}`)
if (files === 0 || markers === 0) {
  console.log('FAIL  nothing matched, so this run checked nothing - not a pass')
  process.exit(1)
}
for (const orphan of orphans) console.log(`ORPHAN ${orphan.file} :: ${orphan.id}`)
if (orphans.length > 0) {
  console.log(`FAIL  ${orphans.length} marker(s) have no outbox row - delivery record written outside the Channel`)
  process.exit(1)
}
console.log('PASS  every marker corresponds to a delivered message')

