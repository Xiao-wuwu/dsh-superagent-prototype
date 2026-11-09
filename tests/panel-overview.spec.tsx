// @vitest-environment jsdom
// The overview.
import { expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { usePanel, mount, remount, all, find, tab, click, text, field, type } from './fixtures/panel.tsx'
import { verdictOf } from '../src/client/overview.tsx'
import { ONBOARD_KEY } from '../src/client/onboard.ts'
import { server, droppedReply, threadSummary } from './fixtures/panel-server.ts'

usePanel()
it('leads the overview with the pending Tickets, then problems, the last day and the Executor, each linking to its stage', async () => {
  await mount()
  expect(tab(zh['tab.overview']).getAttribute('aria-selected')).toBe('true')
  expect(all('[role="tab"]').map(tab => tab.textContent)).toEqual(['介绍', '概览', '来源', '触发', '评估', '执行', '设置'])
  expect(all('.dt-section-title').map(title => title.textContent)).toEqual(['这个面板是什么', '派一张工单', '待处理工单2', '系统问题2', '过去 24 小时详情 ›', '执行器详情 ›', '关于这个构建'])
  expect(all('.dt-cards .dt-ticket-stage').map(item => item.textContent)).toEqual(['待回答', '待处理失败'])
  expect(all('.dt-cards .dt-att-what').map(item => item.textContent)).toEqual(['飞书 来源异常', '评估未完成：这个文案好奇怪'])
  // Actions sit below the title and Threads, apart from the stage, each with its icon.
  expect(all('.dt-ticket').every(row => row.querySelector('.dt-ticket-stage button, .dt-ticket-stage a') === null
    && [...row.querySelectorAll('.dt-ticket-actions button, .dt-ticket-actions a')].every(action => action.querySelector('svg')))).toBe(true)
  expect(text()).toContain('来源会在每次轮询时自动重试')
  expect(text()).toContain('需要确认按钮颜色')
  expect(all('.dt-stat').map(stat => stat.textContent)).toEqual(['到达12', '被过滤2', '已评估5', '接单或续做1', '执行中2 / 3', '排队0', '等待新触发1'])
  expect(all('.dt-chip').map(chip => chip.textContent)[0]).toBe('GitHub#42CI 失败1')
  expect(document.querySelector('.dt-chip-problem')?.textContent).toBe('CI 失败1')
  expect(document.querySelector<HTMLAnchorElement>('a.dt-chip-link')?.href).toBe('https://github.com/acme/widgets/pull/42')
  await click(all('.dt-more-link').at(-1)!)
  expect(tab(zh['tab.execution']).getAttribute('aria-selected')).toBe('true')
})

it('re-evaluates or dismisses an unjudged Eval from the problem list', async () => {
  await mount()
  await click(zh.requeue)
  expect(server.requests.some(request => request.path === 'triggers/e3/requeue' && request.method === 'POST')).toBe(true)
  await click(zh.dismiss)
  expect(server.requests.some(request => request.path === 'decisions/u1/dismiss' && request.method === 'POST')).toBe(true)
  expect(server.requests.filter(request => request.path === 'overview').length).toBeGreaterThan(2)
})

it('opens the Thread of an unjudged Eval at its Trigger from the problem list', async () => {
  await mount()
  await click('评估未完成：这个文案好奇怪')
  expect(server.requests.some(request => request.path.startsWith('threads/feishu:oc_1:om_root'))).toBe(true)
  expect(document.querySelector('.dt-highlight')?.textContent).toContain('message e3')
})

it('follows the last day\'s counts to the status of each stage', async () => {
  await mount()
  // Arrived Triggers include filtered ones, which have no Thread, so no list has that count to link to.
  expect(all('.dt-stat button').map(button => button.textContent)).toEqual(['2', '1'])
  await click(all('.dt-stat button')[0]!)
  expect(tab(zh['tab.source']).getAttribute('aria-selected')).toBe('true')
  await click(zh.sourceFilteredTitle)
  expect(text()).toContain('looks wrong')
  expect(text()).toContain(zh['reason.source_disabled'])
})

it('offers each Ticket that needs a person its actions on the overview: answer in its Channel, retry or open a failed worker, and stop',
  async () => {
  await mount()
  expect(all('.dt-ticket-actions a').map(link => [link.textContent, link.getAttribute('href')])).toEqual([['去飞书回答',
    'https://applink.feishu.cn/client/chat/open?openChatId=oc_1']])
  expect(all('.dt-ticket-note').map(note => note.textContent)).toContain('LlmError: no adapter registered for provider "provider-a"')
  await click(zh.retry)
  await click(zh.confirm)
  expect(server.requests.some(request => request.path === 'tickets/t4/retry' && request.method === 'POST')).toBe(true)
  await click(all('.dt-ticket-actions button').find(button => button.textContent === '打开 Session')!)
  expect(server.opened).toEqual(['worker-t4'])
  await click(all('.dt-ticket-actions button').filter(button => button.textContent === '停止').at(-1)!)
  await click(zh.confirm)
  expect(server.requests.some(request => request.path === 'tickets/t4/stop' && request.method === 'POST')).toBe(true)
  expect(text()).not.toContain('截图工具')
})

it('shows paused processing as a system problem with its resume action, and says so on the Policy records', async () => {
  server.settings = { ...server.settings, paused: true }
  await mount()
  expect(text()).toContain(zh.problemPaused)
  await click(zh['tab.eval'])
  expect(text()).toContain(zh.evalRecordsPaused)
  await click(zh.resumeWhere)
  expect(tab(zh['tab.execution']).getAttribute('aria-selected')).toBe('true')
  await click(zh['tab.overview'])
  await click(find(zh.resumeProcessing, '.dt-att button'))
  await click(zh.confirm)
  expect(server.requests.find(request => request.path === 'executor/pause')).toMatchObject({ method: 'POST', body: { paused: false } })
})

it('offers the step that fixes a settings problem as a button on the overview', async () => {
  server.settings = { ...server.settings, policy: { ...server.settings.policy, sources: { feishu: { allowed: [], admission: {} },
    github: { allowed: [], admission: {} } } } }
  await mount()
  expect(text()).toContain(zh.problemNoAllowed)
  await click(zh.actionAddAllowed)
  expect(tab(zh['tab.settings']).getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['term.eval'])
})

it('counts the messages not sent in the last day, linking to the Source status, and shows nothing when there are none', async () => {
  await mount()
  expect(all('.dt-stat-label').map(label => label.textContent)).not.toContain(zh.flowDroppedLabel)
  server.dropped = [droppedReply('m2', 1, 'feishu', 'channelGone'), droppedReply('m1', 2, 'github', 'channelIgnored'), droppedReply('m0',
    30, 'feishu', 'channelGone')]
  await remount()
  const stat = all('.dt-stat').find(item => item.querySelector('.dt-stat-label')?.textContent === zh.flowDroppedLabel)!
  expect(stat.textContent).toBe(`${zh.flowDroppedLabel}2`)
  await click(stat.querySelector('button')!)
  expect(tab(zh['tab.source'])?.getAttribute('aria-selected')).toBe('true')
})

it('names a failing part of dsh-superagent itself by its label', async () => {
  server.health = { launch: { state: 'error', detail: 'spawn failed' }, relay: { state: 'ready', detail: 'Nothing waiting' } }
  await mount()
  expect(all('.dt-cards .dt-att-what').map(item => item.textContent)).toContain(zh.problemRuntime.replace('{name}', zh['health.launch']))
  expect(text()).toContain('spawn failed')
})

it('words a refused retry in the interface language by its code', async () => {
  await mount()
  // Simulate another user retrying the ticket after the overview loaded.
  server.person = server.person.map(ticket => ticket.id === 't4' ? { ...ticket, actions: { ...ticket.actions, retry: false } } : ticket)
  await click(find(zh.retry, '.dt-ticket-actions button'))
  await click(zh.confirm)
  expect(document.querySelector('.dt-toast')?.textContent).toBe(zh['userError.notRetryable'])
  expect(text()).not.toContain('Only an open ticket can be retried, and only when its worker last reported failed or blocked and no person has sent a message since, or when delivering an Input to its worker failed')
})

it('shows the overview in English', async () => {
  await mount(en)
  expect(all('.dt-section-title').map(title => title.textContent)).toEqual([en.aboutWhatTitle, en.dispatchTitle, `${en.pendingTickets}2`, `${en.problems}2`,
    `${en.lastDay}${en.details}`, `${en['term.executor']}${en.details}`, en.aboutTitle])
  expect(all('.dt-cards .dt-ticket-stage').map(item => item.textContent)).toEqual([en['stage.answer'], en['stage.failed']])
  expect(all('.dt-stat-label').map(label => label.textContent)).toEqual([en.flowReceivedLabel, en.flowFilteredLabel, en.flowJudgedLabel,
    en.flowAcceptedLabel, en.executingLabel, en.queuedLabel, en.idleLabel])
})

it('lists the unavailable Evals one by one, without the health entry that counts them as a failure of dsh-superagent', async () => {
  server.health.evals = { state: 'error', detail: '1 Eval(s) unavailable in the last hour without a later judgement' }
  await mount()
  expect(all('.dt-cards .dt-att-what').map(item => item.textContent)).toEqual(['飞书 来源异常', '评估未完成：这个文案好奇怪'])
  expect(text()).not.toContain(zh['health.evals'])
})

it('says when no Source is on, an Eval is past its deadline or a message keeps failing, each with the way to it', async () => {
  for (const kind of ['feishu', 'github']) server.settings.sources[kind] = { ...server.settings.sources[kind]!, enabled: false }
  server.threads = [threadSummary({ key: 'github:9', title: '#9 迟迟未决', stage: 'evaluating',
    evaluating: { id: 'v9', triggers: 1, strength: 'inferred', startedAt: '2026-08-31T23:58:00Z', deadline: '2026-09-01T00:00:00Z' } })]
  server.failing = [{ id: 'm1', channel: { source: 'github', thread: 'github:42', address: { number: '42' } },
    text: '已修复', attempts: 4,
    error: 'HTTP 502 from GitHub' }]
  await mount()
  const titles = () => all('.dt-cards .dt-att-what').map(item => item.textContent)
  // The Feishu Source is off, so its error is no problem any more.
  expect(titles()).toEqual([zh.problemNoSource, '评估超时未决定：#9 迟迟未决', '评估未完成：这个文案好奇怪', 'GitHub 回复发送失败（已重试 4 次）'])
  expect(text()).toContain('HTTP 502 from GitHub')
  await click(zh.actionOpenSources)
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['settingsGroup.source'])
  await click(tab(zh['tab.overview']))
  await click('评估超时未决定：#9 迟迟未决')
  expect(server.requests.some(request => request.path.startsWith('threads/github:9'))).toBe(true)
})

it('folds setup problems and live component errors into the verdict the CLI encodes as exit codes', async () => {
  await mount()
  expect(text()).toContain('运行判读：部件报错')
  expect(verdictOf(true, [])).toBe('setup')
  expect(verdictOf(false, [{ kind: 'source-error' }])).toBe('broken')
  expect(verdictOf(false, [{ kind: 'executor-paused' }])).toBe('paused')
  expect(verdictOf(false, [{ kind: 'eval-unjudged' }])).toBe('ok')
})

it('dispatches a ticket from the panel by writing an inbox file, and says where it went', async () => {
  await mount()
  await type(field<HTMLInputElement>(zh.dispatchTitlePlaceholder), '把登录页主按钮改成蓝色')
  await type(field<HTMLTextAreaElement>(zh.dispatchBodyPlaceholder), '只改颜色，不动布局')
  await click(zh.dispatchSend)
  expect(server.requests.some(request => request.method === 'POST' && request.path === 'tickets')).toBe(true)
  expect(text()).toContain('已写入 面板工单.md')
})

it('shows the first-run card only until it is dismissed for good, and never as a dialog', async () => {
  localStorage.removeItem(ONBOARD_KEY)
  await mount()
  expect(all('.dt-onboard')).toHaveLength(1)
  // A card, not a modal: the page below stays reachable and the real controls are still there.
  expect(all('[role="dialog"]')).toHaveLength(0)
  expect(field<HTMLInputElement>(zh.dispatchTitlePlaceholder)).toBeTruthy()
  expect(all('.dt-onboard-step').map(step => step.querySelector('b')?.textContent)).toEqual(['接上一个来源', '派一张工单', '看回信'])
  // Nothing in the fake deployment reports a receiving Source, so step one must not claim one.
  expect(text()).toContain(zh.onboardStep1Off)
  await click(zh.onboardStep2Action)
  expect(document.activeElement).toBe(field<HTMLInputElement>(zh.dispatchTitlePlaceholder))
  await click(zh.onboardLater)
  expect(all('.dt-onboard')).toHaveLength(0)
  // Later is not a dismissal: nothing is remembered, and the card returns next time the panel opens.
  expect(localStorage.getItem(ONBOARD_KEY)).toBeNull()
  await remount()
  expect(all('.dt-onboard')).toHaveLength(1)
  await click(zh.onboardDismiss)
  expect(localStorage.getItem(ONBOARD_KEY)).toBe('seen')
  await remount()
  expect(all('.dt-onboard')).toHaveLength(0)
  // The mark is per installation, not per language: switching tongues does not bring the card back.
  await remount(en)
  expect(all('.dt-onboard')).toHaveLength(0)
})

it('says a Source is connected only when its own health reports ready', async () => {
  localStorage.removeItem(ONBOARD_KEY)
  server.health = { github: { state: 'error', detail: '3 consecutive failed polls' } }
  await mount()
  expect(text()).toContain(zh.onboardStep1Off)
  server.health = { github: { state: 'ready', detail: '0 notifications' } }
  await remount()
  expect(text()).toContain(zh.onboardStep1On)
  expect(text()).not.toContain(zh.onboardStep1Off)
  await click(find(zh.onboardStep1Action))
  expect(document.querySelector('.dt-settings-link[aria-current="page"]')?.textContent).toBe(zh['settingsGroup.source'])
})

it('shows no first-run card when the browser refuses storage, and the page still works', async () => {
  const original = Object.getOwnPropertyDescriptor(window, 'localStorage')!
  let reads = 0
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { reads++; throw new DOMException('storage denied', 'SecurityError') } })
  try {
    await mount()
    // The guide must have actually asked, or this test would pass by never running the code it guards.
    expect(reads).toBeGreaterThan(0)
    expect(all('.dt-onboard')).toHaveLength(0)
    expect(field<HTMLInputElement>(zh.dispatchTitlePlaceholder)).toBeTruthy()
    expect(text()).toContain(zh.verdictLabel)
  } finally {
    Object.defineProperty(window, 'localStorage', original)
  }
})
