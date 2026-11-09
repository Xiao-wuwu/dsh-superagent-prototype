/**
 * One Source's policy as a person reads it: who may originate work here, which messages open work by themselves, and
 * which only leave a record. These groups and the cell-by-cell matrix below write the same `admission` table through
 * the helpers in `../admission.ts`, so a value read here is always the value the matrix would have saved.
 */
import { useState } from 'react'
import { ADMISSION_CELLS, ADMISSION_OPTIONS, admissionOf, cellAdmission, plainOf, plainOptions, plainQuestions, withCellAdmission,
  type Admission, type AdmissionCell, type AdmissionTable, type PlainChoice, type PlainQuestion } from '../admission.ts'
import type { AdmissionRowView } from '../sources/kind.ts'
import type { SourceView } from './api.ts'
import type { DshSuperagentKey } from './locales.ts'
import { Button, DisclosureRow, Icon, InfoTip, SegmentedControl } from './controls.tsx'
import { useAction, usePanel } from './provider.tsx'
import { SourceField } from './settings-kit.tsx'
import { localized, valueLabel, when } from './text.ts'
import { Hint, LabelValue, Section } from './widgets.tsx'

const CELL_QUESTION: Record<AdmissionCell, DshSuperagentKey> = {
  listedUnaddressed: 'plainCell.listedNoMention',
  unlistedAddressed: 'plainCell.outsiderAddressed',
  unlistedUnaddressed: 'plainCell.outsiderNoMention',
}

function Question({ cell, label, note, value, onPick }: {
  cell: AdmissionCell; label: string; note?: string | undefined; value: PlainChoice; onPick: (next: PlainChoice) => void
}) {
  const { t } = usePanel()
  const key = (name: string) => t(name as DshSuperagentKey)
  return <div className="dt-plain-item">
    <span className="dt-plain-label">{label}{note && <small>{note}</small>}</span>
    <span className="dt-plain-control">
      <SegmentedControl className="dt-segmented dt-field-segmented" label={label} value={value} onChange={onPick}
        options={plainOptions(cell).map(choice => ({ value: choice, label: key(`plainChoice.${choice}`), title: key(`plainChoiceHint.${choice}`) }))} />
      <span className="dt-admission-slot">{value === 'auto' && <InfoTip text={t('admissionAnyoneWarning')} icon="alert" warn />}</span>
    </span>
  </div>
}

/** One Source's part of the Policy as the form sees it: the roster fields, `admission`, and whatever a kind adds. */
export type PolicyPart = Record<string, unknown>
export function SourcePart({ source, part, saved, dirty, evalMode, onChange, reload }: {
  source: SourceView; part: PolicyPart; saved: PolicyPart; dirty: boolean; evalMode: 'off' | 'observe' | 'auto'
  onChange: (next: PolicyPart) => void; reload: () => Promise<void>
}) {
  const { t, call, notify } = usePanel()
  const policy = source.policy!
  const [advanced, setAdvanced] = useState(false)
  const sync = policy.sync
  const run = useAction(() => call('POST policy-sync/:id', { id: source.id }), { reload })
  // Syncing saves the Policy block, so require unsaved edits to be saved or discarded first.
  const syncNow = () => { if (dirty) notify(t('syncNeedsSave')); else void run.run() }
  const table = (part.admission ?? {}) as AdmissionTable
  const rows = policy.rows ?? []
  const questions = plainQuestions(rows)
  const nameOf = (row: AdmissionRowView) => source.labels[row.id] ?? localized(t, row.label)
  const edit = (next: AdmissionTable) => onChange({ ...part, admission: next })
  const ask = (question: PlainQuestion) => {
    const row = rows.find(item => item.id === question.row)!
    return <Question key={`${question.row}:${question.cell}`} cell={question.cell} value={plainOf(cellAdmission(table, question.row, question.cell))}
      label={`${nameOf(row)} · ${t(CELL_QUESTION[question.cell])}`} note={localized(t, row.note) || undefined}
      onPick={choice => edit(withCellAdmission(table, question.row, question.cell, admissionOf(choice)))} />
  }
  const people = (part.allowed as readonly unknown[] | undefined)?.length ?? 0
  const bots = (part.bots as readonly unknown[] | undefined)?.length ?? 0
  const on = (questions: PlainQuestion[], choice: PlainChoice) => questions.filter(item => plainOf(cellAdmission(table, item.row, item.cell)) === choice).length
  return <div className="dt-part">
    <Section title={t('plainWho')} hint={t('plainWhoHint')} count={people}>
      {policy.fields.map(field => <SourceField key={field.key} field={field} value={part[field.key]} saved={saved[field.key]} fact={undefined}
        labels={source.labels}
        onChange={next => onChange({ ...part, [field.key]: next })} />)}
      {sync && <div className="dt-row-buttons">
        <Button variant="outline" size="sm" icon={<Icon name="refresh" />} disabled={run.busy || !sync.ready} onClick={syncNow}>{localized(t,
          sync.label)}</Button>
        {sync.health?.state === 'ready' && sync.health.at && <LabelValue label={t('syncDone')} value={when(sync.health.at, t('lang'))} />}
        {sync.health?.state === 'error' && <span className="dt-error dt-clamp">{sync.health.detail}</span>}
      </div>}
      {bots > 0 && <p className="dt-flow"><LabelValue label={t('plainBots')} value={String(bots)} /><InfoTip text={t('plainBotsHint')} /></p>}
    </Section>
    {policy.rows ? <>
      <Section title={t('plainAuto')} hint={t('plainAutoHint')} count={on(questions.auto, 'auto')}>
        <div className="dt-plain-item">
          <span className="dt-plain-label">{t('plainAlways')}</span>
          <span className="dt-plain-fixed">{t('plainChoice.auto')}</span>
        </div>
        {questions.auto.length ? questions.auto.map(ask) : <Hint>{t('plainAutoNone')}</Hint>}
        <Hint>{localized(t, policy.explicit)}</Hint>
      </Section>
      <Section title={t('plainRecord')} hint={t('plainRecordHint')} count={on(questions.record, 'record')}>
        {questions.record.map(ask)}
        <Hint>{t('plainRecordMode', { mode: valueLabel(t, 'mode', evalMode) })}</Hint>
      </Section>
      <DisclosureRow icon={<Icon name="settings" />} title={t('admissionAdvanced')} open={advanced} onToggle={() => setAdvanced(!advanced)}>
        <div className="dt-disclosure-body">
          <AdmissionTable rows={rows} labels={source.labels} table={table} onChange={edit} />
        </div>
      </DisclosureRow>
    </> : <div className="dt-field"><span className="dt-field-head">{t('explicitRequest')}</span><span>{localized(t,
      policy.explicit)}</span></div>}
  </div>
}

export function AdmissionTable({ rows, labels, table, onChange }: {
  rows: AdmissionRowView[]; labels: Record<string, string>; table: AdmissionTable; onChange: (table: AdmissionTable) => void
}) {
  const { t } = usePanel()
  const name = (row: AdmissionRowView) => labels[row.id] ?? localized(t, row.label)
  const select = (row: AdmissionRowView, cell: AdmissionCell) => {
    const admission = cellAdmission(table, row.id, cell)
    // Reserve a fixed-width slot for the warning icon so selecting a value never shifts column widths.
    return <td key={cell}><span className="dt-admission-cell">
      <select className="dt-select" aria-label={`${name(row)} · ${t(`admissionCell.${cell}`)}`} value={admission} onChange={event => onChange(
        withCellAdmission(table, row.id, cell, event.target.value as Admission))}>
        {(ADMISSION_OPTIONS[cell] as readonly Admission[]).map(option => <option key={option} value={option}>{t(`admissionValue.${option}`)}</option>)}
      </select>
      <span className="dt-admission-slot">{cell === 'unlistedAddressed' && admission === 'explicit' && <InfoTip
        text={t('admissionAnyoneWarning')} icon="alert" warn />}</span>
    </span></td>
  }
  return <Section title={t('admission')} hint={t('admissionHint')}>
    <table className="dt-table dt-admission">
      <thead>
        <tr><th rowSpan={2}>{t('admissionScope')}</th><th>{t('admissionListed')}</th><th colSpan={2}>{t('admissionUnlisted')}</th></tr>
        <tr><th>{t('admissionUnaddressed')}</th><th>{t('admissionAddressed')}</th><th>{t('admissionUnaddressed')}</th></tr>
      </thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <td className="dt-admission-scope">{name(row)}<small>{localized(t, row.note)}</small></td>
        {ADMISSION_CELLS.map(cell => row.cells[cell] ? select(row, cell) : <td key={cell} className="dt-admission-na"
          aria-label={t('admissionNotReceived')}>—</td>)}
      </tr>)}</tbody>
    </table>
    <Hint>{t('admissionFootnote')}</Hint>
  </Section>
}
