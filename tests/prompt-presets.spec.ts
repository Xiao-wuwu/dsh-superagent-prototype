// The style presets for the three team prompt sections: what they must never lose, and what makes one stop being one.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { PROMPT_PRESETS, presetId } from '../src/app/prompt-presets.ts'
import { TEAM_SECTIONS, defaultPrompts } from '../src/app/prompts.ts'
import { promptFile } from '../src/app/skill-files.ts'

const ROOT = join(import.meta.dirname, '..')
// The lines a style layer may not trade away, each one a rule the English defaults already carry.
const MUST_KEEP = ['回到原会话', '不等于已合并', '默认沉默', '不是人', '不伪造', '本段写明的合并命令', '不替审阅人', '不削弱检查', '署名',
  '不声称有 PR', '不要自己写']
const text = (sections: Record<(typeof TEAM_SECTIONS)[number], string>): string => TEAM_SECTIONS.map(name => sections[name]).join('\n')

it('keeps every load-bearing rule in every preset', () => {
  expect(PROMPT_PRESETS.length).toBeGreaterThan(1)
  for (const item of PROMPT_PRESETS) {
    const body = text(item.sections)
    expect(MUST_KEEP.filter(line => !body.includes(line))).toEqual([])
  }
  // A preset is here because the built-in text is too long to edit: say so with the measured difference, not adjectives.
  const defaults = text(defaultPrompts())
  for (const item of PROMPT_PRESETS) expect(text(item.sections).length).toBeLessThan(defaults.length)
})

it('reads every style file it names, and ships no style file it does not name', () => {
  const named = new Set(PROMPT_PRESETS.flatMap(item => TEAM_SECTIONS.map(section => `${item.id}/${section}.md`)))
  const onDisk = readdirSync(join(ROOT, 'prompts', 'presets'), { recursive: true, encoding: 'utf8' })
    .filter(name => name.endsWith('.md')).map(name => name.replaceAll('\\', '/'))
  expect(onDisk.filter(name => !named.has(name))).toEqual([])
  expect([...named].filter(name => !onDisk.includes(name))).toEqual([])
  // Each section's text is the style file plus the shared floor, so nothing is copied into the style files.
  for (const item of PROMPT_PRESETS) for (const section of TEAM_SECTIONS) {
    expect(item.sections[section].startsWith(promptFile(`presets/${item.id}/${section}`))).toBe(true)
    expect(item.sections[section].split('\n\n').length).toBeGreaterThan(1)
  }
})

it('names a preset only while all three sections are exactly its own text', () => {
  for (const item of PROMPT_PRESETS) expect(presetId(item.sections)).toBe(item.id)
  const first = PROMPT_PRESETS[0]!
  expect(presetId({ ...first.sections, delivery: `${first.sections.delivery}\n` })).toBeUndefined()
  expect(presetId({ ...first.sections, communication: first.sections.scope })).toBeUndefined()
  expect(presetId(defaultPrompts())).toBeUndefined()
  // Two presets never collide.
  const ids = PROMPT_PRESETS.map(item => presetId(item.sections))
  expect(new Set(ids).size).toBe(PROMPT_PRESETS.length)
})
