// @vitest-environment jsdom
// The guide page: the panel opens on it, it explains the pages, and it links both repositories.
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { usePanel, mount, all, tab, click, text } from './fixtures/panel.tsx'

const openGuide = async () => { await mount(); await click(tab(zh['tab.about'])) }

usePanel()
it('explains what the panel is for and what each page does', async () => {
  await openGuide()
  expect(tab(zh['tab.about']).getAttribute('aria-selected')).toBe('true')
  expect(all('[role="tab"]').map(item => item.textContent)).toEqual(['介绍', '概览', '来源', '触发', '评估', '执行', '设置'])
  const titles = all('.dt-section-title').map(item => item.textContent)
  expect(titles).toEqual([zh.aboutWhatTitle, zh.aboutPagesTitle, zh.aboutStartTitle, zh.aboutNotesTitle, zh.aboutTitle])
  // The five panel pages are named in the guide, and the first steps are there too.
  for (const key of ['tab.source', 'tab.trigger', 'tab.eval', 'tab.execution', 'tab.settings'] as const) expect(text()).toContain(zh[key])
  expect(text()).toContain(zh.aboutStepConnect)
  expect(text()).toContain(zh.aboutStepWatch)
})

it('links the upstream repository and the Windows build repository', async () => {
  await openGuide()
  const hrefs = all('a').map(anchor => anchor.getAttribute('href'))
  expect(hrefs).toContain('https://github.com/deepseek-ai/dsh-superagent-prototype')
  expect(hrefs).toContain('https://github.com/ReSerendipity/dsh-superagent')
  expect(hrefs).toContain('https://github.com/ReSerendipity/dsh-superagent/blob/main/docs/WINDOWS-DELTA.md')
})

it('leaves the guide for the overview when the reader clicks it', async () => {
  await openGuide()
  await click(tab(zh['tab.overview']))
  expect(tab(zh['tab.overview']).getAttribute('aria-selected')).toBe('true')
  expect(all('.dt-section-title').map(item => item.textContent)).toContain(zh.pendingTickets + '2')
})
