/** Settings group for the chat chief of staff: which tools a main chat keeps, and whether work must be dispatched. */
import type { ChatRouterSettings } from '../chat-router/config.ts'
import { CUSTOM_TOOL_GROUPS } from '../chat-router/tool-groups.ts'
import { InfoTip, Input, SegmentedControl, Switch } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { usePanel } from './provider.tsx'
import { Field, Fields, useBlockDraft, useSettings } from './settings-kit.tsx'
import { Hint, Section } from './widgets.tsx'

export function ChatRouterSettingsPage() {
  const { t } = usePanel()
  const block = useSettings().settings.blocks.chatRouter
  const draft = useBlockDraft<ChatRouterSettings>('chatRouter', block.value, block.revision)
  const value = draft.value
  const edit = (next: Partial<ChatRouterSettings>) => draft.edit({ ...value, ...next })
  const toggleTool = (name: string, on: boolean) => edit({ tools: { ...value.tools,
    allow: on ? [...new Set([...value.tools.allow, name])] : value.tools.allow.filter(item => item !== name) } })

  return <form className="dt-form dt-block" onSubmit={event => { void draft.submit(event) }}>
    <Fields disabled={draft.busy}>
      <h2 className="dt-block-title">{t('chatRouterTitle')}<InfoTip text={t('chatRouterIntro')} /></h2>
      <div className="dt-switch-row">
        <div className="dt-field-head">{t('chatRouterEnabled')}<InfoTip text={t('chatRouterEnabledHint')} /></div>
        <Switch checked={value.enabled} onChange={enabled => edit({ enabled })} label={t('chatRouterEnabled')} />
      </div>
      <Section title={t('chatRouterPreset')} hint={t('chatRouterPresetHint')}>
        <SegmentedControl className="dt-segmented" label={t('chatRouterPreset')} value={value.tools.preset}
          onChange={preset => edit({ tools: { ...value.tools, preset } })}
          options={(['strict', 'standard', 'custom'] as const).map(preset => ({ value: preset,
            label: t(`chatRouterPreset.${preset}`), title: t(`chatRouterPreset.${preset}Hint`) }))} />
      </Section>
      {value.tools.preset === 'custom' && <Section title={t('chatRouterCustomTools')} hint={t('chatRouterCustomToolsHint')}>
        {CUSTOM_TOOL_GROUPS.map(group => <div key={group.id} className="dt-field">
          <span className="dt-field-head">{group.label.zh}</span>
          <div>
            {group.tools.map(tool => <label key={tool} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 12 }}>
              <input type="checkbox" checked={value.tools.allow.includes(tool)}
                onChange={event => toggleTool(tool, event.target.checked)} /><code>{tool}</code>
            </label>)}
          </div>
        </div>)}
      </Section>}
      <div className="dt-switch-row">
        <div className="dt-field-head">{t('chatRouterForceDispatch')}<InfoTip text={t('chatRouterForceDispatchHint')} /></div>
        <Switch checked={value.forceDispatch} onChange={forceDispatch => edit({ forceDispatch })} label={t('chatRouterForceDispatch')} />
      </div>
      <Section title={t('chatRouterReply')} hint={t('chatRouterReplyHint')}>
        <SegmentedControl className="dt-segmented" label={t('chatRouterReply')} value={value.reply.mode}
          onChange={mode => edit({ reply: { ...value.reply, mode } })}
          options={(['brief', 'none'] as const).map(mode => ({ value: mode, label: t(`chatRouterReply.${mode}`) }))} />
      </Section>
      <Field label={t('chatRouterMaxParallel')} hint={t('chatRouterMaxParallelHint')}>
        <Input type="number" min={1} max={8} value={value.worker.maxParallel}
          onChange={event => edit({ worker: { ...value.worker, maxParallel: Number(event.target.value) } })} />
      </Field>
      <Hint>{t('chatRouterNote')}</Hint>
    </Fields>
    <SaveBar {...draft} onDiscard={draft.discard} />
  </form>
}
