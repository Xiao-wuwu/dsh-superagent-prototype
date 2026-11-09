/** Guide page: what this panel is for, what each page does, and the first steps to take. Shown on open. */
import { Button, Icon } from './controls.tsx'
import { usePanel } from './provider.tsx'
import { settingsRoute, type Route } from './route.ts'
import { Hint, Section } from './widgets.tsx'

const REPOSITORY = {
  upstream: 'https://github.com/deepseek-ai/dsh-superagent-prototype',
  build: 'https://github.com/ReSerendipity/dsh-superagent',
  delta: 'https://github.com/ReSerendipity/dsh-superagent/blob/main/docs/WINDOWS-DELTA.md',
  issues: 'https://github.com/ReSerendipity/dsh-superagent/issues',
}

function Step({ index, title, body }: { index: number; title: string; body: string }) {
  return <li className="dt-row"><div className="dt-row-main">
    <div className="dt-att-what">{index}. {title}</div>
    <p className="dt-row-meta">{body}</p>
  </div></li>
}

const external = (href: string, label: string) => <a href={href} target="_blank" rel="noreferrer noopener">{label}</a>

export function AboutPage() {
  const { t, navigate } = usePanel()
  const go = (label: string, route: Route) => <Button variant="outline" size="sm" icon={<Icon name="settings" size={14} />}
    onClick={() => navigate(route)}>{label}</Button>
  return <>
    <Section title={t('aboutWhatTitle')}>
      <Hint>{t('aboutWhat')}</Hint>
      <Hint>{t('aboutFlow')}</Hint>
    </Section>

    <Section title={t('aboutPagesTitle')}>
      <ul className="dt-list">
        <Step index={1} title={t('tab.source')} body={t('aboutPageSource')} />
        <Step index={2} title={t('tab.trigger')} body={t('aboutPageTrigger')} />
        <Step index={3} title={t('tab.eval')} body={t('aboutPageEval')} />
        <Step index={4} title={t('tab.execution')} body={t('aboutPageExecution')} />
        <Step index={5} title={t('tab.settings')} body={t('aboutPageSettings')} />
      </ul>
    </Section>

    <Section title={t('aboutStartTitle')}>
      <ul className="dt-list">
        <Step index={1} title={t('aboutStepConnect')} body={t('aboutStepConnectBody')} />
        <Step index={2} title={t('aboutStepAllow')} body={t('aboutStepAllowBody')} />
        <Step index={3} title={t('aboutStepJudge')} body={t('aboutStepJudgeBody')} />
        <Step index={4} title={t('aboutStepWatch')} body={t('aboutStepWatchBody')} />
      </ul>
      <div className="dt-row-meta dt-row-buttons">
        {go(t('actionOpenSources'), settingsRoute('source'))}
        {go(t('tab.eval'), settingsRoute('eval'))}
        {go(t('tab.execution'), settingsRoute('execution'))}
      </div>
    </Section>

    <Section title={t('aboutNotesTitle')}>
      <Hint>{t('aboutNoteNoSession')}</Hint>
      <Hint>{t('aboutNotePause')}</Hint>
      <Hint>{t('aboutNoteRestart')}</Hint>
    </Section>

    <Section title={t('aboutTitle')}>
      <Hint>{t('aboutIntro')}</Hint>
      <ul className="dt-list">
        <li className="dt-row"><div className="dt-row-main"><div className="dt-att-what">{t('aboutUpstream')}</div>
          <p className="dt-row-meta">{external(REPOSITORY.upstream, 'github.com/deepseek-ai/dsh-superagent-prototype')}</p></div></li>
        <li className="dt-row"><div className="dt-row-main"><div className="dt-att-what">{t('aboutBuild')}</div>
          <p className="dt-row-meta">{external(REPOSITORY.build, 'github.com/ReSerendipity/dsh-superagent')}</p></div></li>
        <li className="dt-row"><div className="dt-row-main"><div className="dt-att-what">{t('aboutDelta')}</div>
          <p className="dt-row-meta">{external(REPOSITORY.delta, 'WINDOWS-DELTA.md')}</p></div></li>
        <li className="dt-row"><div className="dt-row-main"><div className="dt-att-what">{t('aboutIssues')}</div>
          <p className="dt-row-meta">{external(REPOSITORY.issues, 'github.com/ReSerendipity/dsh-superagent/issues')}</p></div></li>
      </ul>
    </Section>
  </>
}
