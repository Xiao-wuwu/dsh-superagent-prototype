/** Overview page: pending Tickets requiring human action, active system problems, 24-hour flow counts, and Executor load. */
import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { usePoll, type Problem } from './api.ts'
import { Button, Icon } from './controls.tsx'
import { useAction, usePanel, usePanelData } from './provider.tsx'
import { onboardSeen, markOnboardSeen } from './onboard.ts'
import { setupPage, settingsRoute, type Route } from './route.ts'
import { TicketLine } from './rows.tsx'
import { healthText, localized, reasonLabel, valueLabel, readableMarkers } from './text.ts'
import { CheckSetupButton, ConfirmButton, Hint, LoadState, Section, SetupMessage } from './widgets.tsx'

/** The four states `scripts/dsh-superagent status` encodes as exit codes, minus "not running": a rendered panel proves the backend runs. */
export type RuntimeVerdict = 'setup' | 'broken' | 'paused' | 'ok'

/** Folds the setup problem and the live problem list into the same verdict the CLI reports as an exit code. */
export function verdictOf(setupProblem: boolean, problems: readonly { kind: string }[]): RuntimeVerdict {
  if (setupProblem) return 'setup'
  const kinds = new Set(problems.map(problem => problem.kind))
  if (kinds.has('runtime-error') || kinds.has('source-error')) return 'broken'
  if (kinds.has('executor-paused')) return 'paused'
  return 'ok'
}

function ProblemLine({ problem, onChanged }: { problem: Problem; onChanged: () => Promise<void> }) {
  const { t, call, navigate } = usePanel()
  const post = useAction((request: () => Promise<unknown>) => request(), { reload: onChanged })
  const row = (title: string, detail: ReactNode, route: Route | undefined, hint?: string, actions?: ReactNode) => <li
    className="dt-row dt-link dt-att dt-att-error">
    <div className="dt-row-main">
      <div className="dt-att-what">{route ? <button type="button" className="dt-open dt-open-wrap"
        onClick={() => navigate(route)}>{title}</button> : title}</div>
      {detail}{hint && <Hint>{hint}</Hint>}{actions && <div className="dt-row-meta dt-row-buttons">{actions}</div>}
    </div>
  </li>
  const go = (label: string, route: Route) => <Button variant="outline" size="sm" icon={<Icon name="settings"
    size={14} />} onClick={() => navigate(route)}>{label}</Button>
  const raw = (text: string | undefined) => text && <p className="dt-error dt-clamp dt-mono">{text}</p>
  const worded = (text: string) => <p className="dt-error">{text}</p>
  switch (problem.kind) {
    // A failed Feishu bot check pauses only the Feishu Source; other setup problems halt the entire service.
    case 'setup': return row(t(problem.place === 'feishu' ? 'problemSetupFeishu' : 'problemSetup'), <p className="dt-error"><SetupMessage
      problem={problem} /></p>,
      setupPage(problem.place), t(`problemSetupFix.${problem.place}`), <CheckSetupButton />)
    case 'no-source': return row(t('problemNoSource'), undefined, settingsRoute('source'), undefined, go(t('actionOpenSources'),
      settingsRoute('source')))
    case 'no-allowed': return row(t('problemNoAllowed'), undefined, settingsRoute('eval'), undefined, go(t('actionAddAllowed'),
      settingsRoute('eval')))
    case 'executor-paused': return row(t('problemPaused'), undefined, { page: 'execution' }, undefined,
      <ConfirmButton variant="outline" icon="play" label={t('resumeProcessing')} title={t('resumeProcessing')}
        message={t('resumeProcessingConfirm')}
        onConfirm={async () => { await call('POST executor/pause', { body: { paused: false } }); await onChanged() }} />)
    case 'runtime-error': return row(t('problemRuntime', { name: valueLabel(t, 'health', problem.name) }), raw(problem.detail), undefined)
    case 'source-error': {
      const health = problem.source.health
      return row(t('sourceError', { source: localized(t, problem.source.title) }), health.code ? worded(healthText(t, health))
        : raw(health.detail), { page: 'source' }, t('sourceErrorHint'))
    }
    case 'eval-overdue': return row(t('problemEvalOverdue', { thread: readableMarkers(t, problem.thread.title) }), undefined, { page: 'trigger',
      id: problem.thread.key })
    case 'eval-unavailable': return row(t('problemEvalUnavailable', { thread: readableMarkers(t, problem.thread.title) }), raw(reasonLabel(t,
      problem.reason)),
      { page: 'trigger', id: problem.thread.key, query: { trigger: problem.triggerId } }, undefined, <>
        <Button variant="outline" size="sm" icon={<Icon name="refresh" size={14} />} disabled={post.busy}
          onClick={() => { void post.run(() => call('POST triggers/:id/requeue', { id: problem.triggerId })) }}>{t('requeue')}</Button>
        <Button variant="outline" size="sm" icon={<Icon name="dismiss" size={14} />} disabled={post.busy}
          onClick={() => { void post.run(() => call('POST decisions/:id/dismiss', { id: problem.decisionId })) }}>{t('dismiss')}</Button>
      </>)
    case 'outgoing': return row(t('problemReply', { source: valueLabel(t, 'source', problem.outgoing.channel.source),
      attempts: problem.outgoing.attempts }),
      raw(problem.outgoing.error), undefined)
  }
}

/**
 * The in-app way to ask for work: the panel writes an ordinary inbox file, so a person who never leaves
 * DeepSeek Harness still dispatches through the same Source path as a dropped .md.
 */
function DispatchCard({ inputRef }: { inputRef?: RefObject<HTMLInputElement> }) {
  const { t, call } = usePanel()
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [sent, setSent] = useState('')
  const { run, busy } = useAction(async () => {
    const created = await call('POST tickets', { body: { title, body: detail } }) as { file: string }
    setSent(created.file)
    setTitle('')
    setDetail('')
  })
  return <div className="dt-dispatch">
    <input className="dt-input" ref={inputRef} value={title} maxLength={200} aria-label={t('dispatchTitlePlaceholder')}
      placeholder={t('dispatchTitlePlaceholder')} onChange={event => setTitle(event.target.value)} />
    <textarea className="dt-textarea" rows={2} maxLength={20_000} spellCheck={false} value={detail}
      aria-label={t('dispatchBodyPlaceholder')} placeholder={t('dispatchBodyPlaceholder')}
      onChange={event => setDetail(event.target.value)} />
    <div className="dt-row-meta dt-row-buttons">
      <Button variant="primary" size="sm" disabled={!title.trim() || busy}
        onClick={() => { void run() }}>{t('dispatchSend')}</Button>
      {sent && <Hint>{t('dispatchSent', { file: sent })}</Hint>}
    </div>
  </div>
}

/**
 * The three moves that make a fresh installation do something. It is a card, not a dialog, so it can never trap the
 * reader: 不再显示 closes it for good in this browser, 稍后再看 closes it for the session only.
 */
function FirstRunCard({ receiving, onFocusDispatch, onDismiss }: { receiving: boolean; onFocusDispatch: () => void; onDismiss: (seen: boolean) => void }) {
  const { t, navigate } = usePanel()
  const step = (index: number, title: string, body: string, action: ReactNode) => <li className="dt-onboard-step">
    <span className="dt-onboard-num">{index}</span>
    <div className="dt-onboard-body"><b>{title}</b><p>{body}</p>{action}</div>
  </li>
  const link = (label: string, go: () => void) => <Button variant="ghost" size="sm" onClick={go}>{label}</Button>
  return <section className="dt-onboard">
    <h2 className="dt-section-title">{t('onboardTitle')}</h2>
    <ol className="dt-onboard-list">
      {step(1, t('onboardStep1'), receiving ? t('onboardStep1On') : t('onboardStep1Off'),
        link(t('onboardStep1Action'), () => navigate(settingsRoute('source'))))}
      {step(2, t('onboardStep2'), t('onboardStep2Hint'), link(t('onboardStep2Action'), onFocusDispatch))}
      {step(3, t('onboardStep3'), t('onboardStep3Hint'), link(t('onboardStep3Action'), () => navigate({ page: 'execution' })))}
    </ol>
    <Hint>{t('onboardNote')}</Hint>
    <div className="dt-row-meta dt-row-buttons">
      <Button variant="outline" size="sm" onClick={() => onDismiss(true)}>{t('onboardDismiss')}</Button>
      <Button variant="ghost" size="sm" onClick={() => onDismiss(false)}>{t('onboardLater')}</Button>
    </div>
  </section>
}

export function OverviewPage() {
  const { t, call, navigate } = usePanel()
  const { setup, state } = usePanelData()
  const { data, error, reload } = usePoll(() => call('GET overview'), [])
  const dispatch = useRef<HTMLInputElement>(null)
  const [guide, setGuide] = useState(() => !onboardSeen())
  if (!data) return <LoadState error={error} loading />
  const dismiss = (seen: boolean) => { if (seen) markOnboardSeen(); setGuide(false) }
  // A Source that reports ready is one that is actually polling, which is the only honest answer to "is anything connected".
  const receiving = ['github', 'inbox', 'feishu'].some(name => state?.health[name]?.state === 'ready')
  const stat = (label: string, value: ReactNode, route?: Route) => <span className="dt-stat">
    <span className="dt-stat-label">{label}</span>
    {route ? <button type="button" className="dt-textlink dt-stat-value" onClick={() => navigate(route)}>{value}</button> : <span
      className="dt-stat-value">{value}</span>}
  </span>
  const more = (route: Route) => <button type="button" className="dt-textlink dt-more-link"
    onClick={() => navigate(route)}>{t('details')}</button>
  const verdict = verdictOf(Boolean(setup?.problem), data.problems)
  const verdictKey = { setup: 'verdictSetup', broken: 'verdictBroken', paused: 'verdictPaused', ok: 'verdictOk' } as const
  return <>
    {error && <LoadState error={error} loading={false} />}
    {guide && <FirstRunCard receiving={receiving} onDismiss={dismiss}
      onFocusDispatch={() => { dispatch.current?.scrollIntoView?.({ block: 'center' }); dispatch.current?.focus() }} />}
    <Section title={t('aboutWhatTitle')}>
      <Hint>{t('aboutWhat')}</Hint>
      {/* The one line an operator would otherwise have to assemble from the problem list and the CLI's exit code. */}
      <Hint><span className="dt-verdict" data-state={verdict}>{t('verdictLabel')}：{t(verdictKey[verdict])}</span> {t('verdictNotRunning')}</Hint>
      <div className="dt-row-meta dt-row-buttons">
        <Button variant="outline" size="sm" icon={<Icon name="settings" size={14} />}
          onClick={() => navigate({ page: 'about' })}>{t('aboutOpenGuide')}</Button>
      </div>
    </Section>
    <Section title={t('dispatchTitle')}>
      <Hint>{t('dispatchHint')}</Hint>
      <DispatchCard inputRef={dispatch} />
    </Section>
    <Section title={t('pendingTickets')} count={data.person.length}>
      {data.person.length ? <ul className="dt-list dt-cards">{data.person.map(ticket => <TicketLine key={ticket.id} ticket={ticket} question
        onChanged={reload} />)}</ul>
        : <Hint>{t('needsYouNone')}</Hint>}
    </Section>
    {data.problems.length > 0 && <Section title={t('problems')} count={data.problems.length}>
      <ul className="dt-list dt-cards">{data.problems.map((problem, index) => <ProblemLine key={index} problem={problem}
        onChanged={reload} />)}</ul>
    </Section>}
    <Section title={t('lastDay')} action={more({ page: 'trigger', query: { filter: 'recent' } })}>
      {/* Received and evaluated counts operate on Triggers rather than Threads or Decisions, so they do not link to filtered views. */}
      <div className="dt-stats">
        {stat(t('flowReceivedLabel'), data.flow.received)}
        {stat(t('flowFilteredLabel'), data.flow.filtered, data.flow.filtered ? { page: 'source' } : undefined)}
        {stat(t('flowJudgedLabel'), data.flow.judged)}
        {stat(t('flowAcceptedLabel'), data.flow.accepted, { page: 'eval', query: { window: '24h' } })}
        {data.flow.dropped > 0 && stat(t('flowDroppedLabel'), data.flow.dropped, { page: 'source' })}
      </div>
    </Section>
    <Section title={t('term.executor')} action={more({ page: 'execution' })}>
      {/* Pauses surface in `problems` above, so Executor counts render the same in both states; while setup waits, nothing runs. */}
      {setup?.problem ? <Hint>{t('executorWaitingSetup')}</Hint> : <div className="dt-stats">
        {stat(t('executingLabel'), `${data.executor.running} / ${data.executor.maxWorkers}`)}
        {stat(t('queuedLabel'), data.executor.queued)}
        {stat(t('idleLabel'), data.executor.idle)}
      </div>}
    </Section>
    <Section title={t('aboutTitle')}>
      <Hint>{t('aboutIntro')}</Hint>
      <ul className="dt-list">
        <li className="dt-row"><div className="dt-row-main"><div className="dt-att-what">{t('aboutUpstream')}</div>
          <p className="dt-row-meta"><a href="https://github.com/deepseek-ai/dsh-superagent-prototype" target="_blank" rel="noreferrer noopener">github.com/deepseek-ai/dsh-superagent-prototype</a></p></div></li>
        <li className="dt-row"><div className="dt-row-main"><div className="dt-att-what">{t('aboutBuild')}</div>
          <p className="dt-row-meta"><a href="https://github.com/ReSerendipity/dsh-superagent" target="_blank" rel="noreferrer noopener">github.com/ReSerendipity/dsh-superagent</a></p></div></li>
        <li className="dt-row"><div className="dt-row-main"><div className="dt-att-what">{t('aboutDelta')}</div>
          <p className="dt-row-meta"><a href="https://github.com/ReSerendipity/dsh-superagent/blob/main/docs/WINDOWS-DELTA.md" target="_blank" rel="noreferrer noopener">WINDOWS-DELTA.md</a></p></div></li>
        <li className="dt-row"><div className="dt-row-main"><div className="dt-att-what">{t('aboutIssues')}</div>
          <p className="dt-row-meta"><a href="https://github.com/ReSerendipity/dsh-superagent/issues" target="_blank" rel="noreferrer noopener">github.com/ReSerendipity/dsh-superagent/issues</a></p></div></li>
      </ul>
    </Section>
  </>
}
